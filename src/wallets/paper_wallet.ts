import { WalletConfig, WalletState, Position, TradeRecord, RiskLimits, OpenOrder, GroundTruthResult } from '../types';
import { FillSimulator } from '../paper_trading/fill_simulator';
import { PnlTracker } from '../paper_trading/pnl_tracker';
import { logger } from '../reporting/logs';
import { consoleLog } from '../reporting/console_log';
import { OrderbookStream } from '../data/orderbook_stream';
import { ClobFetcher } from '../data/clob_fetcher';
import { MarketPenaltyBox } from '../learning/penalty_box';
import { analyzeLoss } from '../learning/loss_analysis';

import * as fs from 'fs';
import * as path from 'path';

const PERSISTENCE_FILE = '.runtime/paper_wallets.json';

export class PaperWallet {
  private state: WalletState;
  private readonly fillSimulator: FillSimulator;
  private readonly pnlTracker = new PnlTracker();
  private readonly trades: TradeRecord[] = [];
  private displayName: string = '';
  private stream?: OrderbookStream;

    static loadPersistedState(walletId: string): any {
    try {
      if (fs.existsSync(PERSISTENCE_FILE)) {
        const data = JSON.parse(fs.readFileSync(PERSISTENCE_FILE, 'utf8'));
        return data[walletId];
      }
    } catch (e) {}
    return null;
  }

  static deletePersistedState(walletId: string) {
    try {
      if (fs.existsSync(PERSISTENCE_FILE)) {
        const data = JSON.parse(fs.readFileSync(PERSISTENCE_FILE, 'utf8'));
        delete data[walletId];
        fs.writeFileSync(PERSISTENCE_FILE, JSON.stringify(data, null, 2));
      }
    } catch (e) {}
  }

  private saveState() {
    try {
      let data: any = {};
      if (fs.existsSync(PERSISTENCE_FILE)) {
        data = JSON.parse(fs.readFileSync(PERSISTENCE_FILE, 'utf8'));
      }
      data[this.state.walletId] = {
        state: this.state,
        displayName: this.displayName,
        trades: this.trades
      };
      fs.mkdirSync(path.dirname(PERSISTENCE_FILE), { recursive: true });
      fs.writeFileSync(PERSISTENCE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {}
  }

  constructor(
    config: WalletConfig,
    assignedStrategy: string,
    stream?: OrderbookStream,
    clobFetcher?: ClobFetcher
  ) {
    this.stream = stream;
    this.displayName = config.id;
    this.fillSimulator = new FillSimulator(stream, clobFetcher);
    this.state = {
      walletId: config.id,
      mode: 'PAPER',
      assignedStrategy,
      capitalAllocated: config.capital,
      availableBalance: config.capital,
      openPositions: [],
      realizedPnl: 0,
      riskLimits: {
        maxPositionSize: config.riskLimits?.maxPositionSize ?? 100,
        maxExposurePerMarket: config.riskLimits?.maxExposurePerMarket ?? 200,
        maxDailyLoss: config.riskLimits?.maxDailyLoss ?? 100,
        maxOpenTrades: config.riskLimits?.maxOpenTrades ?? 5,
        maxDrawdown: config.riskLimits?.maxDrawdown ?? 0.2,
      },
    };
    const saved = PaperWallet.loadPersistedState(config.id);
    if (saved && saved.state) {
      this.state = saved.state;
      this.state.assignedStrategy = assignedStrategy;
      this.state.capitalAllocated = config.capital;
      this.displayName = saved.displayName || config.id;
      if (saved.trades) this.trades.push(...saved.trades);
    }
  }

  setDependencies(stream: OrderbookStream, clobFetcher: ClobFetcher): void {
    this.stream = stream;
    // Re-instantiate the FillSimulator with real L2 data
    (this as any).fillSimulator = new FillSimulator(stream, clobFetcher);
    logger.info({ walletId: this.state.walletId }, 'PaperWallet dependencies injected — VWAP enabled');
  }

  getState(): WalletState {
    return { ...this.state, openPositions: [...this.state.openPositions] };
  }

  getTradeHistory(): TradeRecord[] {
    return [...this.trades];
  }

  updateBalance(delta: number): void {
    this.state.availableBalance += delta;
    this.saveState();
  }

  getDisplayName(): string {
    return this.displayName;
  }

  setDisplayName(name: string): void {
    this.displayName = name.trim() || this.state.walletId;
    this.saveState();
  }

  updateRiskLimits(limits: Partial<RiskLimits>): void {
    if (limits.maxPositionSize !== undefined) this.state.riskLimits.maxPositionSize = limits.maxPositionSize;
    if (limits.maxExposurePerMarket !== undefined) this.state.riskLimits.maxExposurePerMarket = limits.maxExposurePerMarket;
    if (limits.maxDailyLoss !== undefined) this.state.riskLimits.maxDailyLoss = limits.maxDailyLoss;
    if (limits.maxOpenTrades !== undefined) this.state.riskLimits.maxOpenTrades = limits.maxOpenTrades;
    if (limits.maxDrawdown !== undefined) this.state.riskLimits.maxDrawdown = limits.maxDrawdown;
    logger.info({ walletId: this.state.walletId, riskLimits: this.state.riskLimits }, "Risk limits updated");
    this.saveState();
  }

  async placeOrder(request: {
    marketId: string;
    outcome: 'YES' | 'NO';
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
  }): Promise<void> {
    // Strict Single-Position Per Market Guardrail: NEVER buy if we already have an open position in this market
    if (request.side === 'BUY') {
      const market = this.stream?.getMarket(request.marketId);
      const alreadyHeld = this.state.openPositions.some((p) => {
        if (p.size <= 0) return false;
        if (p.marketId === request.marketId) return true;
        if (market) {
          const target = p.marketId.toLowerCase();
          if (market.marketId && market.marketId.toLowerCase() === target) return true;
          if (market.conditionId && market.conditionId.toLowerCase() === target) return true;
          if (market.slug && market.slug.toLowerCase() === target) return true;
          if (market.clobTokenIds && market.clobTokenIds.some((t: string) => t.toLowerCase() === target)) return true;
        }
        return false;
      });
      if (alreadyHeld) {
        logger.warn({ marketId: request.marketId }, 'Single-Position Veto: Paper wallet already holds a position in this market. Aborting BUY.');
        return;
      }
    }

    const fill = await this.fillSimulator.simulate(request);

    // Capture entry price BEFORE applyFill mutates the position
    // (on full close, applyFill resets avgPrice to 0)
    const existingPos = this.state.openPositions.find(
      (p) => p.marketId === fill.marketId && p.outcome === fill.outcome,
    );
    // For an existing position, use cost basis. For a naked SELL (no prior BUY),
    // entryPrice = 0 so the full proceeds count as realized profit.
    const entryPrice = existingPos ? existingPos.avgPrice : 0;

    // Deduct gas fees for EVERY order, even rejected ones
    if ('gasFee' in fill && typeof fill.gasFee === 'number') {
      this.state.availableBalance -= fill.gasFee;
      this.state.realizedPnl -= fill.gasFee; // Treat gas as realized loss
    }

    if ((fill as any).rejected) {
      return; // Stop processing, no actual size was traded
    }

    const position = this.applyFill(fill);
    const pnl = this.pnlTracker.recordFill(fill, position, entryPrice);
    this.state.realizedPnl += pnl.realized;
    const cost = fill.price * fill.size * (fill.side === 'BUY' ? 1 : -1);
    this.state.availableBalance -= cost;

    // Deduct exact USDC execution fees
    if (fill.feeAsset === 'USDC' && fill.fee > 0) {
      this.state.availableBalance -= fill.fee;
      this.state.realizedPnl -= fill.fee; // Deduct from realized PnL too
    }

    this.trades.push({
      orderId: fill.orderId,
      walletId: this.state.walletId,
      marketId: fill.marketId,
      outcome: fill.outcome,
      side: fill.side,
      price: fill.price,
      size: fill.size,
      cost: Math.abs(cost),
      fee: fill.fee,
      feeAsset: fill.feeAsset,
      realizedPnl: pnl.realized,
      cumulativePnl: this.state.realizedPnl,
      balanceAfter: this.state.availableBalance,
      timestamp: fill.timestamp,
    });

    if (fill.side === 'SELL') {
      const pnlCents = pnl.realized * 100;
      let lossTag: any = null;
      if (pnl.realized < 0) {
        lossTag = analyzeLoss({
          strategy: this.state.assignedStrategy,
          marketId: fill.marketId,
          outcome: fill.outcome,
          entryPrice,
          exitPrice: fill.price,
          intendedExitPrice: request.price,
          holdDurationMs: 60_000,
          exitReason: 'SELL_EXIT',
          pnlCents,
        });

        MarketPenaltyBox.getInstance().penalize(
          fill.marketId,
          Math.abs(pnl.realized),
          `Exit loss of -$${Math.abs(pnl.realized).toFixed(2)} [${lossTag}]`
        );
      }
    }

    const MAX_TRADES = 1000;
    if (this.trades.length > MAX_TRADES) {
      this.trades.splice(0, this.trades.length - MAX_TRADES);
    }

    logger.info(
      {
        walletId: this.state.walletId,
        marketId: fill.marketId,
        price: fill.price,
        size: fill.size,
        fee: fill.fee,
        feeAsset: fill.feeAsset
      },
      `${this.state.walletId} PAPER fill ${fill.side} ${fill.outcome} market=${fill.marketId} price=${fill.price} size=${fill.size} fee=${fill.fee} ${fill.feeAsset}`,
    );

    consoleLog.success(
      'FILL',
      `[${this.state.walletId}] ${fill.side} ${fill.outcome} ×${fill.size} @ $${fill.price} (Fee: ${fill.fee.toFixed(4)} ${fill.feeAsset}) → PnL $${pnl.realized.toFixed(2)} | Bal $${this.state.availableBalance.toFixed(2)}`,
      {
        walletId: this.state.walletId,
        strategy: this.state.assignedStrategy,
        orderId: fill.orderId,
        marketId: fill.marketId,
        outcome: fill.outcome,
        side: fill.side,
        price: fill.price,
        size: fill.size,
        cost: Math.abs(cost),
        fee: fill.fee,
        feeAsset: fill.feeAsset,
        realizedPnl: Number(pnl.realized.toFixed(4)),
        cumulativePnl: Number(this.state.realizedPnl.toFixed(4)),
        balanceAfter: Number(this.state.availableBalance.toFixed(2)),
        openPositions: this.state.openPositions.length,
      }
    );
  }

  private applyFill(fill: {
    marketId: string;
    outcome: 'YES' | 'NO';
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    fee: number;
    feeAsset: 'USDC' | 'SHARES';
  }): Position {
    const existing = this.state.openPositions.find(
      (pos) => pos.marketId === fill.marketId && pos.outcome === fill.outcome,
    );
    if (!existing) {
      if (fill.side === 'SELL') {
        // Selling without a position — return a phantom position, don't add to state
        return {
          marketId: fill.marketId,
          outcome: fill.outcome,
          size: 0,
          avgPrice: fill.price,
          realizedPnl: 0,
        };
      }

      // If opening a new BUY position, deduct the share fee from the acquired size
      let acquiredSize = fill.size;
      if (fill.feeAsset === 'SHARES' && fill.fee > 0) {
        acquiredSize -= fill.fee;
      }

      const position: Position = {
        marketId: fill.marketId,
        outcome: fill.outcome,
        size: acquiredSize,
        avgPrice: fill.price,
        realizedPnl: 0,
      };
      this.state.openPositions.push(position);
      return position;
    }

    if (fill.side === 'BUY') {
      // Adding to position — deduct fee from Acquired Size, update cost basis with weighted average
      let acquiredSize = fill.size;
      if (fill.feeAsset === 'SHARES' && fill.fee > 0) {
        acquiredSize -= fill.fee;
      }

      const newSize = existing.size + acquiredSize;

      // We calculate avgPrice using the gross fill.price and gross fill.size because 
      // the user still "paid" for the total fill amount in USDC. The lost shares are the fee.
      existing.avgPrice =
        (existing.avgPrice * existing.size + fill.price * fill.size) / newSize;
      existing.size = newSize;
    } else {
      // Reducing / closing position — keep avgPrice (cost basis) unchanged
      const reduceQty = Math.min(fill.size, existing.size);
      existing.size -= reduceQty;
      // If fully closed, reset avgPrice
      if (existing.size <= 0) {
        existing.size = 0;
        existing.avgPrice = 0;
      }
      // avgPrice stays the same for partial closes — this is critical for
      // correct realized PnL: (fillPrice − entryPrice) × qty
    }

    // Clean up zero-size positions
    this.state.openPositions = this.state.openPositions.filter(
      (p) => p.size > 0,
    );

    return existing;
  }

  getOpenOrders(): OpenOrder[] {
    return [];
  }

  async cancelOrder(_orderId: string): Promise<boolean> {
    return true;
  }

  async cancelAllOrders(): Promise<number> {
    return 0;
  }

  async syncGroundTruth(): Promise<GroundTruthResult> {
    return {
      walletId: this.state.walletId,
      mode: this.state.mode,
      timestamp: Date.now(),
      balanceUSDC: this.state.availableBalance,
      capitalAllocated: this.state.capitalAllocated,
      positionsCount: this.state.openPositions.length,
      openOrdersCount: 0,
      tradesCount: this.trades.length,
      positions: [...this.state.openPositions],
      openOrders: [],
      recentTrades: this.trades.slice(-20),
    };
  }
}

