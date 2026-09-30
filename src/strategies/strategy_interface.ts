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
  onTimer(): Promise<void> | void;
  generateSignals(): Promise<Signal[]> | Signal[];
  sizePositions(signals: Signal[]): Promise<OrderRequest[]> | OrderRequest[];
  submitOrders(orders: OrderRequest[]): Promise<void> | void;
  notifyFill(order: OrderRequest): void;
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
  private tradeCooldowns = new Map<string, number>();
  protected cooldownMs = 60_000;

  initialize(context: StrategyContext): void {
    this.context = context;
  }

  onMarketUpdate(data: MarketData): void {
    this.markets.set(data.marketId, data);
  }

  onTimer(): void {
    return;
  }

  abstract generateSignals(): Signal[];

  /** Filter signals through cooldown, then size them with Incubation Override */
  sizePositions(signals: Signal[]): OrderRequest[] {
    const now = Date.now();
    const walletId = this.context?.wallet.walletId ?? 'unknown';

    // Filter out signals for markets still in cooldown
    const filtered = signals.filter((s) => {
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

      // Normal sizing
      let size = Math.max(1, Math.floor(10 * signal.confidence));

      // ── INCUBATION SIZING OVERRIDE ──
      if (incubationMode) {
        size = 1; // Micro-lot: prove yourself with minimum risk
      } else if (strategyWeight >= 2.0) {
        size = Math.floor(size * Math.min(strategyWeight, 2.5)); // Boost winners
      } else if (strategyWeight < 1.0) {
        size = Math.max(1, Math.floor(size * strategyWeight)); // Proportional reduction
      }
      // ────────────────────────────────

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
