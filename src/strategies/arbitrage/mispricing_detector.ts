import { BaseStrategy } from '../strategy_interface';
import { Signal, MarketData, OrderRequest } from '../../types';
import { MarketPenaltyBox } from '../../learning/penalty_box';
import { logger } from '../../reporting/logs';

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

const MIN_VOLUME = 5000;
const MIN_LIQUIDITY = 2000;
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

  /**
   * Synchronise active market universe: prune stale price snapshots and volume history.
   */
  override syncActiveMarkets(activeMarkets: MarketData[]): void {
    super.syncActiveMarkets(activeMarkets);
    const activeIds = new Set(activeMarkets.map((m) => m.marketId));

    for (const id of this.priceSnapshots.keys()) {
      if (!activeIds.has(id)) {
        this.priceSnapshots.delete(id);
      }
    }

    for (const id of this.volumeHistory.keys()) {
      if (!activeIds.has(id)) {
        this.volumeHistory.delete(id);
      }
    }
  }

  /**
   * Check whether a market is already held in tracked positions or the wallet
   * across any identifier (marketId, conditionId, slug, or clobTokenIds).
   */
  protected override isMarketPositionHeld(marketId: string, market?: MarketData): boolean {
    const m = market ?? this.markets.get(marketId);
    const checkPos = (posMarketId: string, size: number) => {
      if (size <= 0) return false;
      if (posMarketId === marketId) return true;
      if (m) {
        const target = posMarketId.toLowerCase();
        if (m.marketId && m.marketId.toLowerCase() === target) return true;
        if (m.conditionId && m.conditionId.toLowerCase() === target) return true;
        if (m.slug && m.slug.toLowerCase() === target) return true;
        if (m.clobTokenIds && m.clobTokenIds.some((t) => t.toLowerCase() === target)) return true;
      }
      return false;
    };

    const heldInManaged = this.positions.some((p) => checkPos(p.marketId, p.size));
    const heldInWallet = (this.context?.wallet.openPositions ?? []).some((p) => checkPos(p.marketId, p.size));
    return heldInManaged || heldInWallet;
  }

  /* ── Signal generation ──────────────────────────────────────── */
  generateSignals(): Signal[] {
    const signals: Signal[] = [];
    const available = this.context?.wallet.availableBalance ?? 0;
    if (available < 2.00 || this.positions.length >= MAX_POSITIONS) return signals;

    const now = Date.now();
    const eventGroups = this.groupByEvent();

    for (const [marketId, market] of this.markets) {
      // Single-Position Rule: NEVER buy into a market where a position already exists
      if (this.isMarketPositionHeld(marketId, market)) continue;

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

      // 1. Minimum Edge Gate: Require at least 2c net edge after fees
      if (netEdge < 0.02) continue;

      // 2. Spread-to-Edge Gate: Edge must be at least 2.0x the market spread
      if (edge < 2.0 * Math.max(0.01, market.spread)) continue;

      const confidence = Math.min(MAX_CONFIDENCE, score.total * 1.1);

      signals.push({
        marketId,
        outcome: direction,
        side,
        confidence,
        edge: Math.min(netEdge, 0.10),
      });
    }

    // Sort by expected edge value weighted by market liquidity
    signals.sort((a, b) => {
      const mktA = this.markets.get(a.marketId);
      const mktB = this.markets.get(b.marketId);
      const liqA = mktA ? mktA.liquidity : 1000;
      const liqB = mktB ? mktB.liquidity : 1000;
      const rankA = a.confidence * a.edge * (1 + Math.log10(Math.max(1000, liqA)));
      const rankB = b.confidence * b.edge * (1 + Math.log10(Math.max(1000, liqB)));
      return rankB - rankA;
    });
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
        const market = this.markets.get(s.marketId);
        // Single-Position Rule: NEVER buy into a market where a position already exists
        if (this.isMarketPositionHeld(s.marketId, market)) return false;

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
        const boundedPrice = Math.max(0.01, Math.min(0.75, safePrice));
        if (boundedPrice > 0.75) {
          return null as any;
        }

        // Enforce strictly 5 shares (Polymarket CLOB minimum allowable order size)
        const size = 5;
        if (size * boundedPrice > capital) {
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

  /** Seed existing positions from live wallet/on-chain sync */
  override seedPositions(positions: import('../../types').Position[]): void {
    const valid = positions.filter((p) => p.size > 0);
    this.positions = valid.map((pos) => {
      const existing = this.positions.find((p) => p.marketId === pos.marketId && p.outcome === pos.outcome);
      return {
        marketId: pos.marketId,
        outcome: pos.outcome,
        side: 'BUY',
        entryPrice: pos.avgPrice,
        size: pos.size,
        entryTime: existing?.entryTime ?? Date.now(),
        mispricingScore: existing?.mispricingScore ?? 0,
        peakBps: existing?.peakBps ?? 0,
      };
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
      let market = this.markets.get(pos.marketId);
      if (!market) {
        const target = pos.marketId.toLowerCase();
        for (const [, m] of this.markets) {
          if (
            (m.conditionId && m.conditionId.toLowerCase() === target) ||
            (m.slug && m.slug.toLowerCase() === target) ||
            (m.clobTokenIds && m.clobTokenIds.some((t) => t.toLowerCase() === target))
          ) {
            market = m;
            break;
          }
        }
      }
      if (!market) continue;

      // True fair market price (mid-point) and execution prices
      const currentFairPrice = pos.outcome === 'YES'
        ? (market.midPrice ?? market.outcomePrices[0] ?? 0.5)
        : (1 - (market.midPrice ?? market.outcomePrices[0] ?? 0.5));

      const currentBid = pos.outcome === 'YES'
        ? (market.bid > 0 ? market.bid : currentFairPrice - 0.01)
        : (1 - (market.ask > 0 ? market.ask : (1 - currentFairPrice + 0.01)));

      const currentAsk = pos.outcome === 'YES'
        ? (market.ask > 0 ? market.ask : currentFairPrice + 0.01)
        : (1 - (market.bid > 0 ? market.bid : (1 - currentFairPrice - 0.01)));

      // Realizable edge at current resting bid (for take-profit)
      const bidEdgeBps = pos.side === 'BUY'
        ? (currentBid - pos.entryPrice) * 10_000
        : (pos.entryPrice - currentAsk) * 10_000;

      // Fair-value edge (for stop-loss, to immunize against wide bid-ask spread traps)
      const fairEdgeBps = pos.side === 'BUY'
        ? (currentFairPrice - pos.entryPrice) * 10_000
        : (pos.entryPrice - currentFairPrice) * 10_000;

      pos.peakBps = Math.max(pos.peakBps, bidEdgeBps);
      const holdingMin = (Date.now() - pos.entryTime) / 60_000;
      const holdingHours = holdingMin / 60;

      let exitReason: string | undefined;
      let targetExitPrice = currentBid;

      // 1. Quant Tier 1: Pre-Resolution De-Risking (>= 92c Ceiling)
      // Bank 90%+ of max theoretical payout, eliminate 19:1 tail risk and avoid UMA settlement lockup
      if (currentFairPrice >= 0.92 || currentBid >= 0.92) {
        exitReason = 'ALPHA_HARVEST_CEILING (>=92c)';
        targetExitPrice = Math.min(0.96, Math.max(currentBid, 0.93));
      }

      // 2. Quant Tier 2: Target Alpha Harvest Take-Profit (+300 bps / +3c net gain)
      if (!exitReason && bidEdgeBps >= 300) { 
        exitReason = 'TAKE_PROFIT (+3c Alpha)'; 
        targetExitPrice = Math.max(currentBid, pos.entryPrice + 0.03);
      }

      // 3. Quant Tier 3: Trailing Stop (Locked in +150 bps, dropped 50 bps from peak)
      if (!exitReason && pos.peakBps >= 150 && bidEdgeBps < pos.peakBps - 50) {
        exitReason = 'TRAILING_STOP_PROFIT_LOCK';
        targetExitPrice = currentBid;
      }

      // 4. Quant Tier 4: Fair-Value Midpoint Stop-Loss (-1000 bps / -10c from mid)
      // Evaluated against currentFairPrice (midpoint) to immunize against wide bid-ask spread traps
      if (!exitReason && fairEdgeBps <= -1000 && holdingMin >= 3.0) { 
        exitReason = 'STOP_LOSS (Fair Price Collapse)'; 
        targetExitPrice = currentBid;
      }

      // 5. Quant Tier 5: Stale Holding Time Exit (24h limit or expired market)
      // Free capital rapidly so it can compound into the next active opportunity
      if (!exitReason) {
        const isPastResolution = market.endDate ? new Date(market.endDate).getTime() < Date.now() : false;
        if (isPastResolution || holdingHours >= 24.0) {
          exitReason = isPastResolution ? 'MARKET_EXPIRED_TIME_EXIT' : 'STALE_HOLDING_TIME_EXIT (24h)';
          targetExitPrice = currentBid;
        }
      }

      if (exitReason) {
        toRemove.push(i);

        const exitSide: 'BUY' | 'SELL' = pos.side === 'BUY' ? 'SELL' : 'BUY';
        const exitPrice = Number((Math.round(targetExitPrice * 100) / 100).toFixed(2));

        this.pendingExits.push({
          walletId: this.context?.wallet.walletId ?? 'unknown',
          marketId: pos.marketId,
          outcome: pos.outcome,
          side: exitSide,
          price: Math.max(0.01, Math.min(0.99, exitPrice)),
          size: pos.size,
          strategy: this.name,
        });

        logger.info(
          {
            strategy: this.name,
            marketId: pos.marketId,
            outcome: pos.outcome,
            reason: exitReason,
            entryPrice: pos.entryPrice,
            exitPrice,
            fairPrice: currentFairPrice,
            holdingMin: holdingMin.toFixed(1),
          },
          `Mispricing exit triggered: ${exitReason}`
        );
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
    // 0. Penalty Box check: Skip quarantined assets
    if (MarketPenaltyBox.getInstance().isPenalized(market.marketId).penalized) return false;

    if (market.volume24h < MIN_VOLUME) return false;
    if (market.liquidity < MIN_LIQUIDITY) return false;
    if (now - market.timestamp > STALE_MS) return false;

    // Spread tightness check: Exclude wide spread markets (>4.0% of mid price)
    const spreadPct = market.spread / Math.max(market.midPrice, 0.01);
    if (spreadPct > 0.04) return false;

    const yesPrice = market.outcomePrices[0] ?? 0.5;
    const leadingProb = Math.max(yesPrice, 1 - yesPrice);
    
    // Price Band Gating: High-Confidence Value (0.35 - 0.75) or Deep Asymmetric Value (<= 0.25)
    // Strictly blocks entries > 0.75 to eliminate negative EV 94c steamroller traps
    const isValueMispricing = leadingProb >= 0.35 && leadingProb <= 0.75;
    const isDeepValue = leadingProb <= 0.25;
    if (!isValueMispricing && !isDeepValue) return false;

    const q = (market.question || '').toLowerCase();
    const s = (market.slug || '').toLowerCase();

    // Exclude dynamic / high-fee crypto short-term markets (e.g. 15m, 1h, up-down)
    const isHighFeeCrypto = q.includes('15m') || q.includes('15 min') || q.includes('1 hour') || q.includes('up or down') || s.includes('updown') || s.includes('15m') || s.includes('1h');
    if (isHighFeeCrypto) return false;

    // Category Blacklist: Exclude volatile live esports, low-tier tennis, multi-year politics, and negative EV props
    const isIlliquidEsports = q.includes('lol:') || q.includes('dota') || q.includes('esport') || q.includes('game 4') || q.includes('game 5') || q.includes('map handicap') || s.includes('lol') || s.includes('esports');
    if (isIlliquidEsports) return false;

    const isMinorTennis = q.includes('w15') || q.includes('w25') || q.includes('w35') || q.includes('m15') || q.includes('m25') || q.includes('itf') || s.includes('itf');
    if (isMinorTennis) return false;

    // Exclude multi-year / forward political nominations and elections (> 72h)
    const isLongHorizonPolitics = q.includes('presidential election') || q.includes('mayoral') || q.includes('prime minister') || q.includes('called by') || q.includes('next brazil') || q.includes('2026') || q.includes('2027') || q.includes('2028');
    if (isLongHorizonPolitics) return false;

    // Strict 72-Hour Resolution Horizon Gate: Only trade events resolving within 3 days (high capital velocity)
    if (!market.endDate) return false;
    const daysLeft = (new Date(market.endDate).getTime() - now) / 86_400_000;
    if (daysLeft <= 0 || daysLeft > 3.0) return false;

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
