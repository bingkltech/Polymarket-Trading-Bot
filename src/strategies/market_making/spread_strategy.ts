import { BaseStrategy, StrategyContext } from '../strategy_interface';
import { Signal, OrderRequest, MarketData } from '../../types';
import { logger } from '../../reporting/logs';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Market Making Strategy — Enhanced
   ─────────────────────────────────────────────────────────────
   Quotes both sides of the market with:
   • Inventory tracking & skew-adjusted quotes
   • Dynamic volatility-based spread widening
   • Position limits per market & total
   • Adverse selection protection (skip after spikes)
   • Mean-reversion fade for inventory management
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

interface Inventory {
  yesShares: number;
  noShares: number;
  totalCost: number;
}

interface PriceSnapshot {
  price: number;
  timestamp: number;
}

/**

 * ## Detailed Decision Flow Diagram
 * 
 * ```mermaid
 * flowchart TD
 *     A([Start Tick]) --> B[Fetch Market Mid-Price]
 *     B --> C[Fetch Current Wallet Inventory (YES/NO Exposure)]
 *     C --> D[Calculate Inventory Skew]
 *     D --> E{Is Inventory heavily skewed?}
 *     E -- Yes --> F[Shift Asks down to incentivize selling]
 *     E -- No --> G[Keep Bids/Asks symmetrical around mid]
 *     F --> H[Calculate New Ladder (Levels & Spreads)]
 *     G --> H
 *     H --> I{Are existing active orders > 2% away from new target?}
 *     I -- No --> Z([Do Nothing, wait])
 *     I -- Yes --> J[Cancel Old Orders]
 *     J --> K{Risk Engine: MM Spam Check (Max 500/min)?}
 *     K -- No --> Y([Throttle / Pause])
 *     K -- Yes --> L[Dispatch New Maker Limit Orders]
 *     L --> M([Update Resting Book])
 * ```
 */
export class SpreadStrategy extends BaseStrategy {
  readonly name = 'market_making';

  /* ── Inventory per market ── */
  private inventory = new Map<string, Inventory>();

  /* ── Price history for volatility calc ── */
  private priceHistory = new Map<string, PriceSnapshot[]>();

  /* ── Configuration ── */
  private minVolume = 1_500;
  private minLiquidity = 300;
  private minSpread = 0.004;        // 40 bps minimum spread to be profitable
  private maxInventoryPerMarket = 60; // max shares per side per market
  private maxTotalMarkets = 2;        // max number of markets to quote (aligned with $10 sub-wallet budget)
  private inventorySkewFactor = 0.3;  // how much to skew quotes with inventory
  private volSpreadMultiplier = 2.0;  // widen spread with volatility

  protected override cooldownMs = 30_000; // 30s cooldown — market makers need to refresh frequently

  override initialize(context: StrategyContext): void {
    super.initialize(context);
    const cfg = context.config as Record<string, number>;
    if (cfg.minVolume) this.minVolume = cfg.minVolume;
    if (cfg.minLiquidity) this.minLiquidity = cfg.minLiquidity;
    if (cfg.maxInventoryPerMarket) this.maxInventoryPerMarket = cfg.maxInventoryPerMarket;
    if (cfg.maxTotalMarkets) this.maxTotalMarkets = cfg.maxTotalMarkets;
    logger.info({ strategy: this.name }, 'Market making strategy initialised');
  }

  override onMarketUpdate(data: MarketData): void {
    super.onMarketUpdate(data);
    const hist = this.priceHistory.get(data.marketId) ?? [];
    hist.push({ price: data.midPrice, timestamp: data.timestamp });
    if (hist.length > 120) hist.shift(); // ~30 min of data
    this.priceHistory.set(data.marketId, hist);
  }

  generateSignals(): Signal[] {
    const signals: Signal[] = [];
    let quotedMarkets = 0;

    /* Sort markets by spread (widest first = most profitable) */
    const sorted = [...this.markets.entries()]
      .filter(([, m]) => m.volume24h >= this.minVolume && m.liquidity >= this.minLiquidity)
      .sort(([, a], [, b]) => (b.ask - b.bid) - (a.ask - a.bid));

    for (const [, market] of sorted) {
      if (quotedMarkets >= this.maxTotalMarkets) break;

      // 0. Single-Position Rule: Skip markets where we already hold an open position
      if (this.isMarketPositionHeld(market.marketId, market)) continue;

      // 0a. Exclude dynamic / high-fee crypto short-term markets (e.g. 15m, 1h, up-down)
      const q = (market.question || '').toLowerCase();
      const s = (market.slug || '').toLowerCase();
      const isHighFeeCrypto = q.includes('15m') || q.includes('15 min') || q.includes('1 hour') || q.includes('up or down') || s.includes('updown') || s.includes('15m') || s.includes('1h');
      if (isHighFeeCrypto) continue;

      // 0b. 7-Day Resolution Horizon: Exclude events resolving further than 7 days out
      if (!market.endDate) continue;
      const daysLeft = (new Date(market.endDate).getTime() - Date.now()) / 86_400_000;
      if (daysLeft <= 0 || daysLeft > 7) continue;

      const yesPrice = market.outcomePrices[0] ?? 0.50;
      const leadingProb = Math.max(yesPrice, 1 - yesPrice);
      // Safe probability band (50% - 75% to prevent steamroller)
      if (leadingProb < 0.50 || leadingProb > 0.75) continue;

      const spread = market.ask - market.bid;
      if (spread < this.minSpread) continue;

      /* Adverse selection check: skip if recent price moved sharply */
      if (this.hasRecentSpike(market.marketId)) continue;

      /* Compute dynamic spread based on volatility */
      const vol = this.computeVolatility(market.marketId);
      const dynamicMinSpread = Math.max(this.minSpread, vol * this.volSpreadMultiplier);
      if (spread < dynamicMinSpread) continue;

      /* Inventory-adjusted edge */
      const inv = this.inventory.get(market.marketId) ?? { yesShares: 0, noShares: 0, totalCost: 0 };
      const netInventory = inv.yesShares - inv.noShares; // positive = long YES
      const halfSpread = spread / 2;

      // Skew: if we're long YES, make YES-buy less aggressive and YES-sell more aggressive
      const skew = netInventory * this.inventorySkewFactor * 0.001;
      const buyEdge = halfSpread * 0.6 - skew;   // reduce buy edge when long
      const sellEdge = halfSpread * 0.6 + skew;   // increase sell edge when long

      const available = this.context?.wallet.availableBalance ?? 0;
      const canBuy = available >= 2.00;

      /* Only quote buy side if wallet has capital, not maxed out on inventory, and not already held */
      if (canBuy && inv.yesShares < this.maxInventoryPerMarket && buyEdge > 0.001) {
        signals.push({
          marketId: market.marketId,
          outcome: 'YES',
          side: 'BUY',
          confidence: Math.min(0.6, 0.3 + spread * 5),
          edge: buyEdge,
        });
      }

      /* Only quote sell side if we actually hold YES shares to sell */
      if (inv.yesShares >= 5 && sellEdge > 0.001) {
        signals.push({
          marketId: market.marketId,
          outcome: 'YES',
          side: 'SELL',
          confidence: Math.min(0.6, 0.3 + spread * 5),
          edge: sellEdge,  // positive edge — override handles pricing
        });
      }

      quotedMarkets++;
    }

    return signals;
  }

  /** Override to use real bid/ask for pricing with inventory skew */
  override sizePositions(signals: Signal[]): OrderRequest[] {
    const orders = super.sizePositions(signals);
    const capital = this.context?.wallet.availableBalance ?? this.context?.wallet.capitalAllocated ?? 0;
    if (capital <= 0) return [];

    return orders.map((order) => {
      const market = this.markets.get(order.marketId);
      if (!market) return null as any;

      // Single-Position Rule for BUY
      if (order.side === 'BUY' && this.isMarketPositionHeld(order.marketId, market)) {
        return null as any;
      }

      const inv = this.inventory.get(order.marketId) ?? { yesShares: 0, noShares: 0, totalCost: 0 };
      const netInventory = inv.yesShares - inv.noShares;
      const skew = netInventory * this.inventorySkewFactor * 0.001;

      const offset = Math.max(0.001, (market.ask - market.bid) * 0.3);
      let rawPrice: number;

      if (order.side === 'BUY') {
        rawPrice = market.bid + offset - skew; // bid less when long
      } else {
        rawPrice = market.ask - offset - skew; // ask less when long (attract sellers)
      }

      const safePrice = Number((Math.round(rawPrice * 100) / 100).toFixed(2));
      const price = Math.max(0.01, Math.min(0.75, safePrice)); // Anti-steamroller ceiling <= 0.75
      if (safePrice > 0.75) {
        return null as any;
      }

      // Enforce strictly 5 shares (Polymarket CLOB minimum size)
      const size = 5;
      if (order.side === 'BUY' && size * price > capital) {
        return null as any;
      }
      if (order.side === 'SELL' && inv.yesShares < size) {
        return null as any; // Never place naked SELL
      }

      return { ...order, price, size };
    }).filter((o): o is OrderRequest => Boolean(o));
  }

  /** Seed existing positions from live wallet/on-chain sync */
  override seedPositions(positions: import('../../types').Position[]): void {
    const valid = positions.filter((p) => p.size > 0);
    const newInventory = new Map<string, { yesShares: number; noShares: number; totalCost: number }>();
    for (const pos of valid) {
      const inv = newInventory.get(pos.marketId) ?? { yesShares: 0, noShares: 0, totalCost: 0 };
      if (pos.outcome === 'YES') {
        inv.yesShares = pos.size;
        inv.totalCost = pos.avgPrice * pos.size;
      } else {
        inv.noShares = pos.size;
        inv.totalCost = pos.avgPrice * pos.size;
      }
      newInventory.set(pos.marketId, inv);
    }
    this.inventory = newInventory;
  }

  /** Track inventory on fill via engine callback */
  override notifyFill(order: OrderRequest): void {
    if (order.strategy !== this.name) return;
    const inv = this.inventory.get(order.marketId) ?? { yesShares: 0, noShares: 0, totalCost: 0 };
    if (order.side === 'BUY' && order.outcome === 'YES') {
      inv.yesShares += order.size;
      inv.totalCost += order.price * order.size;
    } else if (order.side === 'SELL' && order.outcome === 'YES') {
      const sellSize = Math.min(order.size, inv.yesShares);
      if (sellSize <= 0) return;
      inv.yesShares -= sellSize;
      inv.totalCost -= (inv.totalCost / Math.max(inv.yesShares + sellSize, 1)) * sellSize;
    } else if (order.side === 'BUY' && order.outcome === 'NO') {
      inv.noShares += order.size;
      inv.totalCost += order.price * order.size;
    } else {
      const sellSize = Math.min(order.size, inv.noShares);
      if (sellSize <= 0) return;
      inv.noShares -= sellSize;
      inv.totalCost -= (inv.totalCost / Math.max(inv.noShares + sellSize, 1)) * sellSize;
    }
    this.inventory.set(order.marketId, inv);
  }

  /** Legacy — inventory tracking now handled by notifyFill */
  override submitOrders(_orders: OrderRequest[]): void {
    return;
  }

  /** Manage: liquidate inventory when spread collapses, market near resolution, stop-loss hit, or take-profit reached */
  override managePositions(): void {
    const walletId = this.context?.wallet.walletId ?? 'unknown';

    // Synchronize inventory strictly with actual live wallet open positions
    if (this.context?.wallet.openPositions) {
      const openPosMap = new Map<string, number>();
      for (const pos of this.context.wallet.openPositions) {
        if (pos.size > 0 && pos.outcome === 'YES') {
          openPosMap.set(pos.marketId.toLowerCase(), pos.size);
          const inv = this.inventory.get(pos.marketId) ?? { yesShares: 0, noShares: 0, totalCost: 0 };
          inv.yesShares = pos.size;
          inv.totalCost = pos.avgPrice * pos.size;
          this.inventory.set(pos.marketId, inv);
        }
      }
      // Purge phantom inventory keys that are not held on-chain
      for (const marketId of this.inventory.keys()) {
        if (!openPosMap.has(marketId.toLowerCase())) {
          this.inventory.delete(marketId);
        }
      }
    }

    for (const [marketId, inv] of this.inventory.entries()) {
      const market = this.markets.get(marketId);
      if (!market) continue;

      const netYes = inv.yesShares;  // shares we actually hold
      if (netYes <= 0) continue;     // nothing to unwind

      const spread = market.ask - market.bid;
      const yesPrice = market.outcomePrices[0] ?? market.midPrice ?? 0.5;
      const currentBid = market.bid > 0 ? market.bid : (yesPrice - 0.01);
      const currentAsk = market.ask > 0 ? market.ask : (yesPrice + 0.01);
      const avgCost = inv.totalCost / Math.max(netYes, 1);

      let exitReason: string | undefined;
      let exitSize = 0;
      let exitPrice = currentAsk; // Default to maker price near ask

      // 1. Quant Tier 1: Pre-Resolution De-Risking (>= 92c Ceiling)
      // Unwind inventory via maker limit near 93c-94c to capture 90%+ profits and free capital
      if (yesPrice >= 0.92 || currentBid >= 0.92) {
        exitReason = 'ALPHA_HARVEST_CEILING (>=92c)';
        exitSize = netYes;
        exitPrice = Math.min(0.96, Math.max(currentBid, 0.93));
      }

      // 2. Severe adverse collapse (< 5c or 20% loss): Unwind residual inventory
      if (!exitReason && yesPrice < 0.05) {
        exitReason = 'SEVERE_COLLAPSE (<5c)';
        exitSize = netYes;
        exitPrice = currentBid;
      }

      // 3. Take Profit: if current price gained >= 3% above entry price, post passive ask to harvest spread
      if (!exitReason && netYes > 0 && yesPrice >= avgCost * 1.03) {
        exitReason = 'TAKE_PROFIT_SPREAD_HARVEST';
        exitSize = netYes;
        exitPrice = Math.max(currentAsk, avgCost + 0.02);
      }

      // 4. Inventory exceeds max → trim excess via maker limit near mid/ask
      if (!exitReason && netYes > this.maxInventoryPerMarket) {
        exitReason = 'INVENTORY_OVERFLOW_TRIM';
        exitSize = netYes - this.maxInventoryPerMarket;
        exitPrice = Math.max(currentBid + 0.01, yesPrice);
      }

      // 5. True Stop-Loss (15% adverse price drop from entry): Exit at bid
      if (!exitReason && netYes > 0 && avgCost > 0 && yesPrice <= avgCost * 0.85) {
        exitReason = 'STOP_LOSS_ADVERSE_DROP (15%)';
        exitSize = netYes;
        exitPrice = currentBid;
      }

      if (exitReason && exitSize > 0) {
        logger.info(
          { strategy: this.name, marketId, reason: exitReason, size: exitSize, inventory: netYes, yesPrice, exitPrice },
          `MM: exiting inventory — ${exitReason}`,
        );

        const safeExitPrice = Number(Math.max(0.01, Math.min(0.99, Math.round(exitPrice * 100) / 100)).toFixed(2));

        this.pendingExits.push({
          walletId,
          marketId,
          outcome: 'YES',
          side: 'SELL',
          price: safeExitPrice,
          size: exitSize,
          strategy: this.name,
        });

        // Set local inventory to 0 so we don't spam duplicate exits before the fill is processed
        inv.yesShares = Math.max(0, inv.yesShares - exitSize);
        inv.totalCost = Math.max(0, inv.totalCost - (inv.totalCost / Math.max(netYes, 1)) * exitSize);
      }
    }
  }

  /* ━━━━━━ Helpers ━━━━━━ */

  private computeVolatility(marketId: string): number {
    const hist = this.priceHistory.get(marketId) ?? [];
    if (hist.length < 5) return 0.01;
    const prices = hist.map(h => h.price);
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / Math.max(0.001, prices[i - 1]));
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }

  private hasRecentSpike(marketId: string): boolean {
    const hist = this.priceHistory.get(marketId) ?? [];
    if (hist.length < 5) return false;
    const recent = hist.slice(-5);
    const oldest = recent[0].price;
    const newest = recent[recent.length - 1].price;
    const change = Math.abs(newest - oldest) / Math.max(0.001, oldest);
    return change > 0.03; // 3% move in last 5 updates = adverse selection risk
  }
}
