import { BaseStrategy } from '../strategy_interface';
import { Signal, MarketData, OrderRequest } from '../../types';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Mispricing Arbitrage Strategy – Combat Hardened
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Statistical Mispricing & Fair-Value Convergence Strategy:
   1. Tracks rolling price snapshots to compute real volume-weighted average price (VWAP)
   2. Computes rolling mean and standard deviation (Z-Score)
   3. Detects volume-price divergence (surging volume on stable price)
   4. Enforces strict dislocation gates before entry to cover transaction friction
   5. Taker execution at top of book with tick-size rounding
   6. Spread-aware position management with grace periods to avoid immediate stop-outs
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const MIN_VOLUME = 2500;
const MIN_LIQUIDITY = 1000;
const STALE_MS = 300_000; // 5 minutes (avoids dropping active live books)
const MIN_DISLOCATION = 0.03; // Minimum 3 cents edge required
const MAX_CONFIDENCE = 0.95;
const MAX_POSITIONS = 2; // Maximum 2 concurrent high-probability bets

/** Rolling price snapshot for VWAP estimation */
interface PriceSnapshot {
  price: number;
  volume: number;
  timestamp: number;
}

/** Tracked mispricing position */
interface MispricingPosition {
  marketId: string;
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  entryPrice: number;
  size: number;
  entryTime: number;
  mispricingScore: number;
  peakBps: number;
}

export class MispricingArbitrageStrategy extends BaseStrategy {
  readonly name = 'mispricing_arbitrage';
  protected override cooldownMs = 180_000; // 3 min patient cooldown

  private positions: MispricingPosition[] = [];
  private priceSnapshots = new Map<string, PriceSnapshot[]>();
  private volumeHistory = new Map<string, number[]>();

  /* ── Market update ──────────────────────────────────────────── */
  override onMarketUpdate(data: MarketData): void {
    super.onMarketUpdate(data);

    // Track rolling price snapshots
    const snaps = this.priceSnapshots.get(data.marketId) ?? [];
    snaps.push({
      price: data.midPrice,
      volume: data.volume24h,
      timestamp: data.timestamp,
    });
    if (snaps.length > 40) snaps.shift();
    this.priceSnapshots.set(data.marketId, snaps);

    // Track volume history
    const vols = this.volumeHistory.get(data.marketId) ?? [];
    vols.push(data.volume24h);
    if (vols.length > 20) vols.shift();
    this.volumeHistory.set(data.marketId, vols);
  }

  /* ── Signal generation ──────────────────────────────────────── */
  generateSignals(): Signal[] {
    const signals: Signal[] = [];
    if (this.positions.length >= MAX_POSITIONS) return signals;

    const now = Date.now();
    const eventGroups = this.groupByEvent();

    for (const [marketId, market] of this.markets) {
      if (!this.passesFilters(market, now)) continue;

      const score = this.computeMispricingScore(marketId, market, eventGroups);
      if (score.total < 0.65) continue; // Require high statistical confidence

      const snaps = this.priceSnapshots.get(marketId) ?? [];
      const vwap = this.computeVWAP(snaps);
      const yesPrice = market.outcomePrices[0];

      // Determine trade direction purely based on VWAP fair-value dislocation
      let direction: 'YES' | 'NO';
      let side: 'BUY' = 'BUY';
      let edge = 0;

      if (vwap > 0 && Math.abs(yesPrice - vwap) >= MIN_DISLOCATION) {
        if (yesPrice < vwap) {
          // Underpriced YES relative to VWAP fair value -> BUY YES
          direction = 'YES';
          edge = vwap - yesPrice;
        } else {
          // Overpriced YES (underpriced NO) relative to VWAP -> BUY NO
          direction = 'NO';
          edge = yesPrice - vwap;
        }
      } else if (score.meanRev > 0.75) {
        // Statistical mean-reversion opportunity
        const prices = snaps.map((s) => s.price);
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        if (yesPrice < avg - MIN_DISLOCATION) {
          direction = 'YES';
          edge = avg - yesPrice;
        } else if (yesPrice > avg + MIN_DISLOCATION) {
          direction = 'NO';
          edge = yesPrice - avg;
        } else {
          continue;
        }
      } else {
        // No statistically significant edge; skip to protect capital
        continue;
      }

      // Boost edge with volume-price divergence
      const volDivergence = this.volumePriceDivergence(marketId);
      if (volDivergence > 0.5) {
        edge *= (1 + volDivergence * 0.2);
      }

      // Net Edge Calculation: deduct estimated exchange fees (100 bps / ~1.0% round-trip)
      const roundTripFee = 0.01;
      const netEdge = edge - roundTripFee;
      if (netEdge <= 0.01) continue; // Require at least 1c net edge after fees

      const confidence = Math.min(MAX_CONFIDENCE, score.total * 1.1);

      signals.push({
        marketId,
        outcome: direction,
        side,
        confidence,
        edge: Math.min(netEdge, 0.10),
      });
    }

    // Sort by expected edge value
    signals.sort((a, b) => b.confidence * b.edge - a.confidence * a.edge);
    return signals.slice(0, MAX_POSITIONS - this.positions.length);
  }

  /* ── Sizing: risk-adjusted with strict contract constraints ── */
  override sizePositions(signals: Signal[]): OrderRequest[] {
    const capital = this.context?.wallet.availableBalance ?? 20;
    const walletId = this.context?.wallet.walletId ?? 'unknown';
    const maxSizeLimit = this.context?.wallet.riskLimits.maxPositionSize ?? 5;
    const now = Date.now();

    return signals
      .filter((s) => {
        const key = `${s.marketId}:${s.outcome}:${s.side}`;
        const last = (this as any).tradeCooldowns?.get(key) ?? 0;
        return now - last > this.cooldownMs;
      })
      .map((signal) => {
        const market = this.markets.get(signal.marketId);

        // Taker price calculation with tick size alignment (2 decimals)
        let price: number;
        if (signal.outcome === 'YES') {
          price = market?.ask ?? (market?.outcomePrices[0] ?? 0.50);
        } else {
          price = market ? (1 - market.bid) : 0.50;
        }

        const safePrice = Number((Math.round(price * 100) / 100).toFixed(2));
        const boundedPrice = Math.max(0.01, Math.min(0.99, safePrice));

        // Enforce strictly 1 to 2 shares max per trade, satisfying $1.00 min notional
        const minShares = Math.ceil(1.00 / boundedPrice);
        let size = Math.min(2, Math.max(1, minShares));
        if (size * boundedPrice < 1.00) {
          size = Math.min(2, Math.ceil(1.00 / boundedPrice));
        }
        if (size * boundedPrice < 1.00 || size > 2) {
          return null as any;
        }

        return {
          walletId,
          marketId: signal.marketId,
          outcome: signal.outcome,
          side: signal.side,
          price: boundedPrice,
          size,
          strategy: this.name,
        };
      })
      .filter((o): o is OrderRequest => Boolean(o));
  }

  /* ── Position tracking via engine callback ──────────────────── */
  override notifyFill(order: OrderRequest): void {
    if (order.strategy !== this.name) return;
    this.positions.push({
      marketId: order.marketId,
      outcome: order.outcome,
      side: order.side,
      entryPrice: order.price,
      size: order.size,
      entryTime: Date.now(),
      mispricingScore: 0,
      peakBps: 0,
    });
  }

  override submitOrders(_orders: OrderRequest[]): void {
    return;
  }

  /* ── Manage positions with spread-aware tolerance ───────────── */
  override managePositions(): void {
    const toRemove: number[] = [];

    for (let i = 0; i < this.positions.length; i++) {
      const pos = this.positions[i];
      const market = this.markets.get(pos.marketId);
      if (!market) continue;

      // Sell YES at YES bid, Sell NO at NO bid
      const currentBid = pos.outcome === 'YES'
        ? (market.bid ?? market.outcomePrices[0])
        : (1 - (market.ask ?? (1 - market.outcomePrices[1])));

      const grossEdgeBps = pos.side === 'BUY'
        ? (currentBid - pos.entryPrice) * 10_000
        : (pos.entryPrice - currentBid) * 10_000;

      // Deduct estimated 100 bps (1%) round-trip exchange fees from net profit tracking
      const roundTripFeeBps = 100;
      const netEdgeBps = grossEdgeBps - roundTripFeeBps;

      pos.peakBps = Math.max(pos.peakBps, netEdgeBps);
      const holdingMin = (Date.now() - pos.entryTime) / 60_000;

      let exitReason: string | undefined;

      // 1. Take profit: +150 bps net profit (+1.5c net after all fees)
      if (netEdgeBps >= 150) { 
        exitReason = 'TAKE_PROFIT'; 
      }

      // 2. Trailing stop: locked in 100+ bps net profit, dropped 40 from peak
      if (!exitReason && pos.peakBps >= 100 && netEdgeBps < pos.peakBps - 40) {
        exitReason = 'TRAILING_STOP';
      }

      // 3. Stop-loss: adverse move of -250 bps after at least 1 min holding
      if (!exitReason && netEdgeBps <= -250 && holdingMin >= 1.0) { 
        exitReason = 'STOP_LOSS'; 
      }

      // 4. Time exit: close after 20 minutes
      if (!exitReason && holdingMin >= 20.0) { 
        exitReason = 'TIME_EXIT'; 
      }

      if (exitReason) {
        toRemove.push(i);

        const exitSide: 'BUY' | 'SELL' = pos.side === 'BUY' ? 'SELL' : 'BUY';
        const exitPrice = Number((Math.round(currentBid * 100) / 100).toFixed(2));

        this.pendingExits.push({
          walletId: this.context?.wallet.walletId ?? 'unknown',
          marketId: pos.marketId,
          outcome: pos.outcome,
          side: exitSide,
          price: Math.max(0.01, Math.min(0.99, exitPrice)),
          size: pos.size,
          strategy: this.name,
        });
      }
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.positions.splice(toRemove[i], 1);
    }
  }

  /* ── Multi-factor mispricing score ──────────────────────────── */
  private computeMispricingScore(
    marketId: string,
    market: MarketData,
    eventGroups: Map<string, MarketData[]>,
  ): { total: number; spread: number; vwapDev: number; volDiv: number; meanRev: number; crossMkt: number } {
    // Factor 1: Spread tightness (tighter spread = safer execution)
    const spreadPct = market.spread / Math.max(market.midPrice, 0.01);
    const spreadScore = Math.max(0, 1 - (spreadPct / 0.08));

    // Factor 2: VWAP deviation
    const snaps = this.priceSnapshots.get(marketId) ?? [];
    const vwap = this.computeVWAP(snaps);
    const vwapDev = vwap > 0 ? Math.abs(market.midPrice - vwap) / Math.max(vwap, 0.01) : 0;
    const vwapScore = Math.min(1, vwapDev / 0.04);

    // Factor 3: Volume-price divergence
    const volDiv = this.volumePriceDivergence(marketId);
    const volDivScore = Math.min(1, volDiv);

    // Factor 4: Mean reversion potential
    const meanRevScore = this.meanReversionScore(marketId);

    // Factor 5: Cross-market validation
    const crossMktScore = this.crossMarketScore(market, eventGroups);

    const total =
      spreadScore * 0.20 +
      vwapScore * 0.30 +
      volDivScore * 0.15 +
      meanRevScore * 0.25 +
      crossMktScore * 0.10;

    return { total, spread: spreadScore, vwapDev: vwapScore, volDiv: volDivScore, meanRev: meanRevScore, crossMkt: crossMktScore };
  }

  /* ── Helpers ────────────────────────────────────────────────── */

  private computeVWAP(snapshots: PriceSnapshot[]): number {
    if (snapshots.length < 3) return 0;
    let sumPriceVol = 0;
    let sumVol = 0;
    for (let i = 1; i < snapshots.length; i++) {
      const volDelta = Math.max(1, snapshots[i].volume - snapshots[i - 1].volume);
      sumPriceVol += snapshots[i].price * volDelta;
      sumVol += volDelta;
    }
    return sumVol > 0 ? sumPriceVol / sumVol : 0;
  }

  private volumePriceDivergence(marketId: string): number {
    const snaps = this.priceSnapshots.get(marketId) ?? [];
    if (snaps.length < 5) return 0;

    const recent = snaps.slice(-10);
    const priceChange = Math.abs(recent[recent.length - 1].price - recent[0].price);
    const volumeChange = recent.length > 1
      ? Math.abs(recent[recent.length - 1].volume - recent[0].volume) / Math.max(recent[0].volume, 1)
      : 0;

    if (priceChange < 0.005 && volumeChange > 0.1) {
      return Math.min(1, volumeChange * 3);
    }
    return 0;
  }

  private meanReversionScore(marketId: string): number {
    const snaps = this.priceSnapshots.get(marketId) ?? [];
    if (snaps.length < 10) return 0;

    const prices = snaps.map((s) => s.price);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const current = prices[prices.length - 1];
    const deviation = Math.abs(current - avg);

    const variance = prices.reduce((sum, p) => sum + (p - avg) ** 2, 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;
    const zScore = deviation / stdDev;
    return Math.min(1, Math.max(0, (zScore - 1) / 2));
  }

  private crossMarketScore(market: MarketData, eventGroups: Map<string, MarketData[]>): number {
    if (!market.eventId) return 0;
    const group = eventGroups.get(market.eventId);
    if (!group || group.length < 2) return 0;

    const spreads = group.map((m) => m.spread / Math.max(m.midPrice, 0.01));
    const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    const thisSpread = market.spread / Math.max(market.midPrice, 0.01);

    if (thisSpread > avgSpread * 1.5) {
      return Math.min(1, (thisSpread - avgSpread) / avgSpread);
    }
    return 0;
  }

  private isAdverseSpike(marketId: string): boolean {
    const snaps = this.priceSnapshots.get(marketId) ?? [];
    if (snaps.length < 4) return false;
    const oldest = snaps[Math.max(0, snaps.length - 5)].price;
    const current = snaps[snaps.length - 1].price;
    return Math.abs(current - oldest) >= 0.05; // 5c violent price shock
  }

  private passesFilters(market: MarketData, now: number): boolean {
    if (market.volume24h < MIN_VOLUME) return false;
    if (market.liquidity < MIN_LIQUIDITY) return false;
    if (now - market.timestamp > STALE_MS) return false;

    const yesPrice = market.outcomePrices[0] ?? 0.5;
    const leadingProb = Math.max(yesPrice, 1 - yesPrice);
    
    // Strictly High-Probability: Only bet when leading probability is 75% - 96%
    if (leadingProb < 0.75 || leadingProb > 0.96) return false;

    // Reject markets experiencing violent 5c price spikes (adverse selection)
    if (this.isAdverseSpike(market.marketId)) return false;

    return true;
  }

  private groupByEvent(): Map<string, MarketData[]> {
    const groups = new Map<string, MarketData[]>();
    for (const [, market] of this.markets) {
      const eventId = market.eventId;
      if (!eventId) continue;
      const group = groups.get(eventId) ?? [];
      group.push(market);
      groups.set(eventId, group);
    }
    return groups;
  }
}
