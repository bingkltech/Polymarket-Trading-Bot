import { Scheduler } from './scheduler';
import { OrderbookStream } from '../data/orderbook_stream';
import { ClobFetcher } from '../data/clob_fetcher';
import { WalletManager } from '../wallets/wallet_manager';
import { OrderRouter } from '../execution/order_router';
import { StrategyInterface } from '../strategies/strategy_interface';
import { STRATEGY_REGISTRY } from '../strategies/registry';
import { AppConfig, MarketData, GroundTruthResult } from '../types';
import { logger } from '../reporting/logs';
import { consoleLog } from '../reporting/console_log';
import { QuantCouncilEngine } from './quant_council';

interface StrategyRunner {
  strategy: StrategyInterface;
  walletId: string;
  config: Record<string, unknown>;
}

export class Engine {
  private readonly scheduler = new Scheduler();
  private readonly stream: OrderbookStream;
  private readonly clobFetcher: ClobFetcher;
  private readonly runners: StrategyRunner[] = [];
  private readonly pausedWallets = new Set<string>();
  private readonly quantCouncil = QuantCouncilEngine.getInstance();
  private isArmed = true;

  constructor(
    private readonly config: AppConfig,
    private readonly walletManager: WalletManager,
    private readonly orderRouter: OrderRouter,
  ) {
    // Pass Gamma API URL from config to the OrderbookStream
    this.stream = new OrderbookStream(config.polymarket.gammaApi);
    this.clobFetcher = new ClobFetcher(config.polymarket.clobApi);
    this.walletManager.setPaperDependencies(this.stream, this.clobFetcher);
  }

  async initialize(): Promise<void> {
    for (const wallet of this.config.wallets) {
      const StrategyCtor = STRATEGY_REGISTRY[wallet.strategy];
      if (!StrategyCtor) {
        logger.warn({ strategy: wallet.strategy }, 'Unknown strategy; skipping');
        consoleLog.warn('ENGINE', `Unknown strategy "${wallet.strategy}" — skipping wallet ${wallet.id}`);
        continue;
      }
      const walletState = this.walletManager.getWallet(wallet.id)?.getState();
      if (!walletState) {
        continue;
      }
      const strategy = new StrategyCtor();
      strategy.initialize({
        wallet: walletState,
        config: this.config.strategyConfig[wallet.strategy] ?? {},
      });
      this.runners.push({
        strategy,
        walletId: wallet.id,
        config: this.config.strategyConfig[wallet.strategy] ?? {},
      });
      consoleLog.info('STRATEGY', `Initialized "${wallet.strategy}" for wallet ${wallet.id}`, {
        walletId: wallet.id,
        strategy: wallet.strategy,
        capital: walletState.capitalAllocated,
        mode: walletState.mode,
      });
    }

    this.stream.on('update', (data) => this.handleMarketUpdate(data));
    this.stream.on('snapshot', (markets: MarketData[]) => {
      for (const runner of this.runners) {
        if (typeof runner.strategy.syncActiveMarkets === 'function') {
          runner.strategy.syncActiveMarkets(markets);
        }
      }
    });
  }

  private antifreeze: any = null;

  async start(): Promise<void> {
    if (!this.antifreeze) {
      // Import and start AntiFreeze dynamically to avoid top-level circular deps if any
      const { AntiFreeze } = await import('./antifreeze');
      this.antifreeze = new AntiFreeze(2500);
      this.antifreeze.start();
    }

    // PRE-TRADE RECONCILIATION: Check on-chain positions and orderbook on network boot
    consoleLog.info('SYSTEM', 'Initiating Pre-Trade Orderbook & Position Reconciliation...');
    logger.info('Engine: Fetching open orders and positions to prevent duplicate entries.');

    // 1. Await all wallets to be ready
    for (const runner of this.runners) {
      try {
        const wallet = this.walletManager.getWallet(runner.walletId);
        if (wallet && typeof (wallet as any).ready === 'function') {
          await (wallet as any).ready();
        }
      } catch (e) {
        logger.error({ err: e, walletId: runner.walletId }, `Failed to ready wallet ${runner.walletId}`);
      }
    }

    // 2. Perform ground truth partition across all wallets and seed positions
    try {
      await this.syncAllGroundTruth();
    } catch (e) {
      logger.error({ err: e }, 'Failed to sync ground truth on engine start');
    }

    // 3. Reset strategy memory for live wallets if needed
    for (const runner of this.runners) {
      const wallet = this.walletManager.getWallet(runner.walletId);
      if (wallet && runner.walletId.includes('live') && (wallet as any).mode === 'LIVE') {
        consoleLog.debug('SYSTEM', `Reconciled open state for live wallet ${runner.walletId}`);
        this.antifreeze?.resetStrategyMemory(runner.strategy.name);
      }
    }

    this.stream.start();
    this.scheduler.start(() => this.tick());
    logger.info({ wallets: this.runners.length }, 'Engine started with LIVE Polymarket data');
    consoleLog.success('ENGINE', `Engine started — ${this.runners.length} strategy runners active`, {
      runners: this.runners.length,
      strategies: [...new Set(this.runners.map((r) => r.strategy.name))],
    });
  }

  stop(): void {
    if (this.antifreeze) {
      this.antifreeze.stop();
      this.antifreeze = null;
    }
    this.scheduler.stop();
    this.stream.stop();
    logger.info('Engine stopped');
    consoleLog.warn('ENGINE', 'Engine stopped');
  }

  /** Expose the stream so the dashboard can query live market data */
  getStream(): OrderbookStream {
    return this.stream;
  }

  /* ━━━━━━━━━━━━━━ Runtime runner management ━━━━━━━━━━━━━━ */

  /**
   * Add a strategy runner for a wallet that was created at runtime
   * (e.g. via the dashboard).  The runner immediately receives all
   * cached market data so the strategy has context for its first tick.
   */
  addRunner(walletId: string, strategyKey: string): boolean {
    // Prevent duplicate runners for the same wallet
    if (this.runners.some((r) => r.walletId === walletId)) {
      logger.warn({ walletId }, 'Runner already exists for wallet');
      return false;
    }

    const StrategyCtor = STRATEGY_REGISTRY[strategyKey];
    if (!StrategyCtor) {
      logger.warn({ walletId, strategy: strategyKey }, 'Unknown strategy; cannot add runner');
      return false;
    }

    const walletState = this.walletManager.getWallet(walletId)?.getState();
    if (!walletState) {
      logger.warn({ walletId }, 'Wallet not found in WalletManager');
      return false;
    }

    const strategy = new StrategyCtor();
    const cfg = this.config.strategyConfig[strategyKey] ?? {};
    strategy.initialize({ wallet: walletState, config: cfg });

    this.runners.push({ strategy, walletId, config: cfg });

    if (walletState.openPositions && walletState.openPositions.length > 0 && typeof (strategy as any).seedPositions === 'function') {
      (strategy as any).seedPositions(walletState.openPositions);
    }

    // Back-fill cached market data so the strategy can evaluate immediately
    for (const market of this.stream.getAllMarkets()) {
      strategy.onMarketUpdate(market);
    }

    logger.info(
      { walletId, strategy: strategyKey, cachedMarkets: this.stream.getAllMarkets().length },
      `Runtime runner added for wallet ${walletId} (${strategyKey})`,
    );
    consoleLog.success('WALLET', `Runtime runner added: ${walletId} → ${strategyKey}`, {
      walletId,
      strategy: strategyKey,
      cachedMarkets: this.stream.getAllMarkets().length,
    });
    return true;
  }

  /**
   * Remove the strategy runner for a wallet (e.g. on wallet deletion).
   */
  removeRunner(walletId: string): boolean {
    const idx = this.runners.findIndex((r) => r.walletId === walletId);
    if (idx === -1) return false;

    const runner = this.runners[idx];
    runner.strategy.shutdown();
    this.runners.splice(idx, 1);
    logger.info({ walletId }, `Runtime runner removed for wallet ${walletId}`);
    consoleLog.warn('WALLET', `Runner removed: ${walletId} (${runner.strategy.name})`, {
      walletId,
      strategy: runner.strategy.name,
      remainingRunners: this.runners.length,
    });
    return true;
  }

  /** Number of active strategy runners (for dashboard display). */
  getRunnerCount(): number {
    return this.runners.length;
  }

  /** Get all strategy instances that match a given strategy name (for runtime config). */
  getStrategiesByName(strategyName: string): StrategyInterface[] {
    return this.runners
      .filter((r) => r.config === this.config.strategyConfig[strategyName] || r.strategy.name === strategyName)
      .map((r) => r.strategy);
  }

  /* ━━━━━━━━━━━━━━ Pause / Resume ━━━━━━━━━━━━━━ */

  /**
   * Pause a wallet's strategy runner.  The runner stays in the list
   * (and still receives market updates to stay in-sync) but will not
   * generate signals, size positions, or place orders.
   */
  pauseRunner(walletId: string): boolean {
    if (!this.runners.some((r) => r.walletId === walletId)) return false;
    this.pausedWallets.add(walletId);
    consoleLog.warn('ENGINE', `Runner paused: ${walletId}`, { walletId });
    return true;
  }

  /**
   * Resume a previously paused wallet runner.
   */
  resumeRunner(walletId: string): boolean {
    if (!this.pausedWallets.has(walletId)) return false;
    this.pausedWallets.delete(walletId);
    consoleLog.success('ENGINE', `Runner resumed: ${walletId}`, { walletId });
    return true;
  }

  /** Check whether a specific wallet runner is paused. */
  isRunnerPaused(walletId: string): boolean {
    return this.pausedWallets.has(walletId);
  }

  /** Return the set of all currently paused wallet IDs. */
  getPausedWallets(): Set<string> {
    return new Set(this.pausedWallets);
  }

  /** Get Quant Council Engine instance */
  getQuantCouncil(): QuantCouncilEngine {
    return this.quantCouncil;
  }

  /** Get overall armed state of the bot */
  getIsArmed(): boolean {
    return this.isArmed;
  }

  /** Arm the bot to execute live signals and orders */
  arm(): void {
    this.isArmed = true;
    logger.info('Bot engine ARMED');
    consoleLog.success('ENGINE', '🟢 Bot ARMED — Live signal scanning & automated order execution ACTIVE');
  }

  /** Disarm the bot into standby / safe mode (no new buy orders) */
  disarm(): void {
    this.isArmed = false;
    logger.info('Bot engine DISARMED');
    consoleLog.warn('ENGINE', '🟡 Bot DISARMED — Standby / Safe mode active (No new orders will be placed)');
  }

  /** Emergency Panic: Cancel all open orders and disarm the bot immediately */
  async panicHalt(): Promise<{ cancelledOrders: number }> {
    this.isArmed = false;
    logger.warn('EMERGENCY PANIC HALT invoked on engine');
    consoleLog.error('ENGINE', '🔴 EMERGENCY PANIC TRIGGERED! Disarming bot and cancelling all resting open orders...');
    const cancelledOrders = await this.walletManager.cancelAllOrders();
    consoleLog.warn('ENGINE', `Panic sweep completed: ${cancelledOrders} order(s) cancelled`);
    return { cancelledOrders };
  }

  /** Force immediate ground truth synchronization across all wallets */
  async syncAllGroundTruth(): Promise<GroundTruthResult[]> {
    logger.info('Engine: Executing full Ground Truth synchronization across all wallets...');
    consoleLog.info('SYSTEM', '🔄 Syncing Ground Truth with Polymarket (Balances, Positions, Open Orders, Trades)...');

    const results = await this.walletManager.syncAllGroundTruth();

    // Re-seed strategies with updated live positions if needed
    for (const runner of this.runners) {
      const wallet = this.walletManager.getWallet(runner.walletId);
      if (wallet) {
        const positions = wallet.getState().openPositions;
        if (positions && typeof (runner.strategy as any).seedPositions === 'function') {
          (runner.strategy as any).seedPositions(positions);
        }
      }
    }

    return results;
  }

  private tickCount = 0;
  private marketUpdateCount = 0;
  private lastScanLog = 0;

  private async tick(): Promise<void> {
    this.tickCount++;

    // Periodic ground truth sync and memory health every 12 ticks (~60 s at 5 s interval)
    if (this.tickCount % 12 === 0) {
      const mem = process.memoryUsage();
      const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
      const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
      consoleLog.debug('ENGINE', `Tick #${this.tickCount} — ${this.runners.length} runners, ${this.stream.getAllMarkets().length} active markets | Mem: ${heapMb}MB Heap, ${rssMb}MB RSS`);
      this.marketUpdateCount = 0;

      // Background ground truth sync (non-blocking)
      this.syncAllGroundTruth().catch((err) => {
        logger.warn({ err }, 'Background ground truth sync error');
      });

      // Optional garbage collection if exposed
      if (this.tickCount % 60 === 0 && typeof (global as any).gc === 'function') {
        (global as any).gc();
      }
    }

    for (const runner of this.runners) {
      if (this.pausedWallets.has(runner.walletId)) continue;  // skip paused
      runner.strategy.onTimer();
      await this.processSignals(runner);
    }
  }


  private handleMarketUpdate(data: MarketData): void {
    this.marketUpdateCount++;

    // Throttle per-market update logs to at most once every 30 s
    const now = Date.now();
    if (now - this.lastScanLog > 30_000) {
      consoleLog.debug('SCAN', `Market update: ${data.marketId?.slice(0, 12)}… — ${data.outcomes?.length ?? 0} outcomes`, {
        marketId: data.marketId,
        question: data.question?.slice(0, 80),
      });
      this.lastScanLog = now;
    }

    for (const runner of this.runners) {
      runner.strategy.onMarketUpdate(data);
    }
  }

  private lastInsufficientLog = new Map<string, number>();

  private async processSignals(runner: StrategyRunner): Promise<void> {
    // If bot is DISARMED, skip signal generation and order placement (safe standby mode)
    if (!this.isArmed) {
      return;
    }

    const wallet = this.walletManager.getWallet(runner.walletId);
    const currentState = wallet?.getState();
    const available = currentState?.availableBalance ?? 0;

    // Keep strategy context strictly synchronized with real-time wallet state
    if (currentState && runner.strategy.context) {
      runner.strategy.context.wallet = currentState;
    }

    // Resource & Capital Optimizer: If wallet has insufficient funds (< $2.00) to place a minimum 5-share order,
    // gracefully halt buy-signal scanning to conserve CPU/RAM and prevent redundant risk rejections.
    // Asset management (exits, take-profit, trailing stop, and harvest) runs continuously via onTimer().
    if (available < 2.00) {
      const now = Date.now();
      const last = this.lastInsufficientLog.get(runner.walletId) ?? 0;
      if (now - last > 300_000) { // Log once every 5 minutes
        logger.info(
          { walletId: runner.walletId, strategy: runner.strategy.name, availableBalance: available },
          `Capital Optimizer: Available balance ($${available.toFixed(2)}) < $2.00 minimum lot. Pausing buy scanning to conserve resources; focusing 100% on asset management & exits.`
        );
        this.lastInsufficientLog.set(runner.walletId, now);
      }
      return;
    }

    const signals = await runner.strategy.generateSignals();
    if (signals.length > 0) {
      consoleLog.info('SIGNAL', `[${runner.strategy.name}] Generated ${signals.length} signal(s) for wallet ${runner.walletId}`, {
        walletId: runner.walletId,
        strategy: runner.strategy.name,
        signals: signals.map((s) => ({
          market: s.marketId.slice(0, 12) + '…',
          outcome: s.outcome,
          side: s.side,
          confidence: Number((s.confidence ?? 0).toFixed(3)),
          edge: Number((s.edge ?? 0).toFixed(4)),
        })),
      });
    }

    const orders = await runner.strategy.sizePositions(signals);
    if (orders.length > 0) {
      consoleLog.info('ORDER', `[${runner.strategy.name}] Sized ${orders.length} order(s) for wallet ${runner.walletId}`, {
        walletId: runner.walletId,
        strategy: runner.strategy.name,
        orders: orders.map((o) => ({
          market: o.marketId.slice(0, 12) + '…',
          outcome: o.outcome,
          side: o.side,
          price: o.price,
          size: o.size,
        })),
      });
    }

    for (const order of orders) {
      // Global Cross-Wallet Single-Position Veto:
      // Ensure that across ALL wallets in the platform, we never exceed 1 position (5 shares) per market
      if (order.side === 'BUY') {
        // Universal Anti-Steamroller Engine Guard:
        // Strictly prohibit ANY BUY order with price >= $0.85 across all strategies
        if (order.price >= 0.85) {
          logger.warn(
            { walletId: order.walletId, marketId: order.marketId, price: order.price, strategy: order.strategy },
            'Global Anti-Steamroller Veto: BUY price >= $0.85 is strictly prohibited (toxic asymmetric risk).'
          );
          consoleLog.warn('ORDER', `Global Veto: Aborted BUY @ $${order.price.toFixed(2)} on ${order.marketId} — price >= $0.85 violates Anti-Steamroller Rule.`);
          continue;
        }

        // Quant Council Deliberation Pass:
        const market = this.stream?.getMarket(order.marketId);
        if (market) {
          const deliberation = this.quantCouncil.deliberate(market);
          if (deliberation.consensus.verdict === 'VETOED') {
            logger.warn(
              { walletId: order.walletId, marketId: order.marketId, strategy: order.strategy, reasons: deliberation.consensus.vetoReasons },
              'Quant Council VETO: Market setup rejected by council deliberation.'
            );
            consoleLog.warn('COUNCIL', `[VETOED] ${order.marketId.slice(0, 10)}…: ${deliberation.consensus.vetoReasons.join(', ')}`);
            continue;
          }
        }

        const allPositions = this.walletManager.listWallets().flatMap((w) => w.getState().openPositions);
        const isGloballyHeld = allPositions.some((p) => {
          if (p.size <= 0) return false;
          if (p.marketId === order.marketId) return true;
          const m = this.stream?.getMarket(order.marketId);
          if (m) {
            const target = p.marketId.toLowerCase();
            if (m.marketId && m.marketId.toLowerCase() === target) return true;
            if (m.conditionId && m.conditionId.toLowerCase() === target) return true;
            if (m.slug && m.slug.toLowerCase() === target) return true;
            if (m.clobTokenIds && m.clobTokenIds.some((t) => t.toLowerCase() === target)) return true;
          }
          return false;
        });
        if (isGloballyHeld) {
          logger.warn(
            { walletId: order.walletId, marketId: order.marketId, strategy: order.strategy },
            'Global Engine Veto: Market is already held by a wallet in the platform. Aborting duplicate BUY.'
          );
          consoleLog.warn('ORDER', `Global Veto: Aborted duplicate BUY for market ${order.marketId} — already held in platform.`);
          continue;
        }
      }

      try {
        const executed = await this.orderRouter.route(order);
        if (executed) {
          runner.strategy.notifyFill(order);
          consoleLog.success('FILL', `[${runner.strategy.name}] Executed ${order.side} ${order.outcome} ×${order.size} @ $${order.price.toFixed(4)}`, {
            walletId: order.walletId,
            strategy: order.strategy,
            marketId: order.marketId,
            outcome: order.outcome,
            side: order.side,
            price: order.price,
            size: order.size,
            cost: Number((order.price * order.size).toFixed(4)),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        consoleLog.error('ORDER', `[${runner.strategy.name}] Order failed: ${msg}`, {
          walletId: order.walletId,
          marketId: order.marketId,
          error: msg,
        });
      }
    }

    await runner.strategy.managePositions();

    /* ── Route exit orders produced by managePositions() ── */
    const exitOrders = runner.strategy.drainExitOrders();
    if (exitOrders.length > 0) {
      consoleLog.info('ORDER', `[${runner.strategy.name}] ${exitOrders.length} exit order(s) for wallet ${runner.walletId}`, {
        walletId: runner.walletId,
        strategy: runner.strategy.name,
        exits: exitOrders.map((o) => ({
          market: o.marketId.slice(0, 12) + '…',
          outcome: o.outcome,
          side: o.side,
          price: o.price,
          size: o.size,
        })),
      });
    }

    for (const exitOrder of exitOrders) {
      try {
        const executed = await this.orderRouter.route(exitOrder);
        if (executed) {
          consoleLog.success('FILL', `[${runner.strategy.name}] Exited ${exitOrder.outcome} ×${exitOrder.size} @ $${exitOrder.price.toFixed(4)}`, {
            walletId: exitOrder.walletId,
            strategy: exitOrder.strategy,
            marketId: exitOrder.marketId,
            outcome: exitOrder.outcome,
            side: exitOrder.side,
            price: exitOrder.price,
            size: exitOrder.size,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        consoleLog.error('ORDER', `[${runner.strategy.name}] Exit order failed: ${msg}`, {
          walletId: exitOrder.walletId,
          marketId: exitOrder.marketId,
          error: msg,
        });
      }
    }
  }
}
