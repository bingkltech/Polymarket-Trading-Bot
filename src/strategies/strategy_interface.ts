import { MarketData, OrderRequest, Signal, WalletState } from '../types';
import { ModelCritic } from '../learning/critic';
import { logger } from '../reporting/logs';

export interface StrategyContext {
  wallet: WalletState;
  config: Record<string, unknown>;
}

export interface StrategyInterface {
  readonly name: string;
  initialize(context: StrategyContext): Promise<void> | void;
  onMarketUpdate(data: MarketData): Promise<void> | void;
  syncActiveMarkets?(activeMarkets: MarketData[]): void;
  onTimer(): Promise<void> | void;
  generateSignals(): Promise<Signal[]> | Signal[];
  sizePositions(signals: Signal[]): Promise<OrderRequest[]> | OrderRequest[];
  submitOrders(orders: OrderRequest[]): Promise<void> | void;
  notifyFill(order: OrderRequest): void;
  seedPositions?(positions: import('../types').Position[]): void;
  managePositions(): Promise<void> | void;
  drainExitOrders(): OrderRequest[];
  shutdown(): Promise<void> | void;
}

export abstract class BaseStrategy implements StrategyInterface {
  abstract readonly name: string;
  protected context?: StrategyContext;

  /** Live market cache populated by onMarketUpdate() */
  protected markets = new Map<string, MarketData>();

  /**
   * Exit orders queued by managePositions() — the engine drains and
   * routes these through the wallet after each tick.
   */
  protected pendingExits: OrderRequest[] = [];

  /**
   * Per-market cooldown: prevents trading the same market more than once
   * within a cooldown window (default 60 seconds).
   */
  protected tradeCooldowns = new Map<string, number>();
  protected cooldownMs = 60_000;

  initialize(context: StrategyContext): void {
    this.context = context;
  }

  onMarketUpdate(data: MarketData): void {
    this.markets.set(data.marketId, data);
  }

  /**
   * Synchronise active market universe: retains only markets present in active snapshot,
   * deleting any dropped/stale markets and purging expired trade cooldowns.
   */
  syncActiveMarkets(activeMarkets: MarketData[]): void {
    const activeIds = new Set(activeMarkets.map((m) => m.marketId));

    // Prune stale markets
    for (const id of this.markets.keys()) {
      if (!activeIds.has(id)) {
        this.markets.delete(id);
      }
    }

    // Update active market data
    for (const m of activeMarkets) {
      this.markets.set(m.marketId, m);
    }

    // Prune expired cooldowns
    const now = Date.now();
    for (const [key, ts] of this.tradeCooldowns.entries()) {
      if (now - ts > this.cooldownMs * 2) {
        this.tradeCooldowns.delete(key);
      }
    }
  }

  onTimer(): void {
    return;
  }

  /** Check whether a market is already held in the wallet across any identifier */
  protected isMarketPositionHeld(marketId: string, market?: MarketData): boolean {
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

    return (this.context?.wallet.openPositions ?? []).some((p) => checkPos(p.marketId, p.size));
  }

  abstract generateSignals(): Signal[];

  /** Filter signals through cooldown, then size them with Incubation Override */
  sizePositions(signals: Signal[]): OrderRequest[] {
    const now = Date.now();
    const walletId = this.context?.wallet.walletId ?? 'unknown';

    // Filter out signals for markets still in cooldown or already held in wallet
    const filtered = signals.filter((s) => {
      if (this.isMarketPositionHeld(s.marketId)) {
        return false;
      }
      const key = `${s.marketId}:${s.outcome}:${s.side}`;
      const lastTrade = this.tradeCooldowns.get(key) ?? 0;
      return now - lastTrade > this.cooldownMs;
    });

    // ── DEERFLOW INCUBATION OVERRIDE ──────────────────────────
    // Mirrors KalshiMarketMaker/core/avellaneda.py get_effective_max_position()
    const weights = ModelCritic.readWeights();
    const strategyWeight = weights[this.name] ?? 1.0;

    let incubationMode = false;
    if (strategyWeight <= 0.1) {
      incubationMode = true;
      logger.warn(
        { strategy: this.name, weight: strategyWeight },
        '[INCUBATION] Strategy is in the Penalty Box. Forcing micro-lot (1 share).',
      );
    } else if (strategyWeight >= 2.0) {
      logger.info(
        { strategy: this.name, weight: strategyWeight },
        '[GRADUATED] Strategy is a star performer. Boosting sizing.',
      );
    }
    // ──────────────────────────────────────────────────────────

    return filtered.map((signal) => {
      // Record cooldown
      const key = `${signal.marketId}:${signal.outcome}:${signal.side}`;
      this.tradeCooldowns.set(key, now);

      // Use actual market price when available, fall back to 0.5 + edge
      const market = this.markets.get(signal.marketId);
      let price: number;
      if (market) {
        price = signal.outcome === 'YES'
          ? market.outcomePrices[0]
          : (market.outcomePrices[1] ?? 1 - market.outcomePrices[0]);
      } else {
        price = Number((0.5 + signal.edge).toFixed(4));
      }

      // Strictly 5 shares per trade (Polymarket CLOB minimum allowable order size)
      const size = 5;

      return {
        walletId,
        marketId: signal.marketId,
        outcome: signal.outcome,
        side: signal.side,
        price: Number(Math.max(0.01, Math.min(0.99, price)).toFixed(4)),
        size,
        strategy: this.name,
      };
    });
  }

  submitOrders(_orders: OrderRequest[]): void {
    return;
  }

  /**
   * Called by the engine after a successful fill.
   * Override in subclasses to track positions.
   */
  notifyFill(_order: OrderRequest): void {
    return;
  }

  /**
   * Seed reconciled positions from on-chain/wallet state.
   */
  seedPositions(_positions: import('../types').Position[]): void {
    return;
  }

  managePositions(): void {
    return;
  }

  /** Return and clear any exit orders queued during managePositions() */
  drainExitOrders(): OrderRequest[] {
    const exits = this.pendingExits;
    this.pendingExits = [];
    return exits;
  }

  shutdown(): void {
    return;
  }
}
