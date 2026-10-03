import { PaperWallet } from './paper_wallet';
import * as fs from 'fs';
import * as path from 'path';
const DELETED_WALLETS_FILE = '.runtime/deleted_wallets.json';
function isWalletDeleted(walletId: string): boolean {
  try {
    if (fs.existsSync(DELETED_WALLETS_FILE)) {
      const deleted = JSON.parse(fs.readFileSync(DELETED_WALLETS_FILE, 'utf8'));
      return deleted.includes(walletId);
    }
  } catch (e) {}
  return false;
}
function markWalletDeleted(walletId: string) {
  try {
    let deleted = [];
    if (fs.existsSync(DELETED_WALLETS_FILE)) {
      deleted = JSON.parse(fs.readFileSync(DELETED_WALLETS_FILE, 'utf8'));
    }
    if (!deleted.includes(walletId)) {
      deleted.push(walletId);
      fs.mkdirSync(path.dirname(DELETED_WALLETS_FILE), { recursive: true });
      fs.writeFileSync(DELETED_WALLETS_FILE, JSON.stringify(deleted, null, 2));
    }
  } catch(e) {}
}

import { PolymarketWallet } from './polymarket_wallet';
import { WalletState, WalletConfig, TradeRecord, Position, OpenOrder, GroundTruthResult } from '../types';
import { logger } from '../reporting/logs';

import { OrderbookStream } from '../data/orderbook_stream';
import { ClobFetcher } from '../data/clob_fetcher';

export interface ExecutionWallet {
  getState(): WalletState;
  getTradeHistory(): TradeRecord[];
  getOpenOrders?(): OpenOrder[];
  syncGroundTruth?(): Promise<GroundTruthResult>;
  syncLivePositions?(): Promise<Position[]>;
  syncLiveBalance?(): Promise<number>;
  syncLiveOpenOrders?(): Promise<OpenOrder[]>;
  syncLiveTradeHistory?(): Promise<TradeRecord[]>;
  placeOrder(request: {
    marketId: string;
    outcome: 'YES' | 'NO';
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
  }): Promise<void>;
  cancelOrder?(orderId: string): Promise<boolean>;
  cancelAllOrders?(): Promise<number>;
  updateBalance(delta: number): void;
  /** Optional display name for the dashboard (defaults to walletId) */
  getDisplayName?(): string;
  setDisplayName?(name: string): void;
  /** Update risk limits at runtime */
  updateRiskLimits?(limits: Partial<import('../types').RiskLimits>): void;
}

export class WalletManager {
  private readonly wallets = new Map<string, ExecutionWallet>();
  private stream?: OrderbookStream;
  private clobFetcher?: ClobFetcher;

  /** Inject real-time dependencies so new PaperWallets can calculate VWAP slippage */
  setPaperDependencies(stream: OrderbookStream, clobFetcher: ClobFetcher): void { this.setDependencies(stream, clobFetcher); }
  setDependencies(stream: OrderbookStream, clobFetcher: ClobFetcher): void {
    this.stream = stream;
    this.clobFetcher = clobFetcher;
    for (const wallet of this.wallets.values()) {
      if ('setDependencies' in wallet) {
        (wallet as any).setDependencies(stream, clobFetcher);
      }
    }
    logger.info('WalletManager configured with live data dependencies for paper trading VWAP');
  }

  registerWallet(config: WalletConfig, assignedStrategy: string, enableLive: boolean): void {
    if (config.mode === 'PAPER' && isWalletDeleted(config.id)) {
      logger.info({ walletId: config.id }, 'Skipping registration of permanently deleted paper wallet');
      return;
    }
    if (this.wallets.has(config.id)) {
      throw new Error(`Wallet ${config.id} already registered`);
    }

    if (config.mode === 'LIVE' && !enableLive) {
      logger.warn(
        { walletId: config.id },
        'LIVE trading requested but ENABLE_LIVE_TRADING is false; refusing LIVE wallet',
      );
      return;
    }

    const wallet =
      config.mode === 'LIVE'
        ? new PolymarketWallet(config, assignedStrategy, this.stream)
        : new PaperWallet(config, assignedStrategy, this.stream, this.clobFetcher);

    this.wallets.set(config.id, wallet);
    const state = wallet.getState();
    logger.info(
      { walletId: state.walletId, mode: state.mode, strategy: state.assignedStrategy, capital: state.capitalAllocated },
      `Registered wallet ${state.walletId} (${state.mode}) strategy=${state.assignedStrategy}`,
    );
  }

  getWallet(walletId: string): ExecutionWallet | undefined {
    return this.wallets.get(walletId);
  }

  listWallets(): WalletState[] {
    return Array.from(this.wallets.values()).map((wallet) => wallet.getState());
  }

  getTradeHistory(walletId: string): TradeRecord[] {
    const wallet = this.wallets.get(walletId);
    if (!wallet) return [];
    return wallet.getTradeHistory();
  }

  getAllTradeHistories(): Map<string, TradeRecord[]> {
    const map = new Map<string, TradeRecord[]>();
    for (const [id, wallet] of this.wallets) {
      map.set(id, wallet.getTradeHistory());
    }
    return map;
  }

  removeWallet(walletId: string): boolean {
    const wallet = this.wallets.get(walletId);
    if (!wallet) return false;
    
    // If it's a paper wallet, mark it as permanently deleted
    if (wallet.getState().mode === 'PAPER') {
      markWalletDeleted(walletId);
    }
    
    this.wallets.delete(walletId);
    logger.info({ walletId }, `Wallet ${walletId} removed`);
    return true;
  }

  registerExternalWallet(walletId: string, wallet: ExecutionWallet): void {
    if (this.wallets.has(walletId)) {
      throw new Error(`Wallet ${walletId} already registered`);
    }
    this.wallets.set(walletId, wallet);
  }

  getAllOpenOrders(): Map<string, OpenOrder[]> {
    const map = new Map<string, OpenOrder[]>();
    for (const [id, wallet] of this.wallets) {
      if (typeof wallet.getOpenOrders === 'function') {
        map.set(id, wallet.getOpenOrders());
      } else {
        map.set(id, []);
      }
    }
    return map;
  }

  async cancelOrder(walletId: string, orderId: string): Promise<boolean> {
    const wallet = this.wallets.get(walletId);
    if (wallet && typeof wallet.cancelOrder === 'function') {
      return await wallet.cancelOrder(orderId);
    }
    return false;
  }

  async cancelAllOrders(): Promise<number> {
    let totalCancelled = 0;
    for (const wallet of this.wallets.values()) {
      if (typeof wallet.cancelAllOrders === 'function') {
        try {
          const count = await wallet.cancelAllOrders();
          totalCancelled += count;
        } catch (err) {
          logger.error({ err, walletId: wallet.getState().walletId }, 'Error in cancelAllOrders for wallet');
        }
      }
    }
    return totalCancelled;
  }

  async syncAllGroundTruth(): Promise<GroundTruthResult[]> {
    const liveWallets = Array.from(this.wallets.values()).filter(
      (w) => w.getState().mode === 'LIVE'
    );

    // If multiple live sub-wallets share the same Polymarket account, coordinate their positions & orders
    if (liveWallets.length > 0) {
      const primaryLive = liveWallets[0];
      if (typeof primaryLive.syncGroundTruth === 'function') {
        try {
          await primaryLive.syncGroundTruth();
        } catch (err) {
          logger.error({ err }, 'Error syncing primary live wallet ground truth');
        }
      }

      const allLivePositions = primaryLive.getState().openPositions;
      const allOpenOrders = typeof primaryLive.getOpenOrders === 'function' ? primaryLive.getOpenOrders() : [];

      // Partition positions and open orders among live wallets
      const assignedPositions = new Map<string, Position[]>();
      const assignedOrders = new Map<string, OpenOrder[]>();
      for (const w of liveWallets) {
        assignedPositions.set(w.getState().walletId, []);
        assignedOrders.set(w.getState().walletId, []);
      }

      // Partition positions by matching trade history
      for (const pos of allLivePositions) {
        let ownerWalletId: string | null = null;
        for (const w of liveWallets) {
          const trades = w.getTradeHistory();
          if (trades.some((t) => t.marketId === pos.marketId)) {
            ownerWalletId = w.getState().walletId;
            break;
          }
        }
        // Unassigned/manual external positions belong exclusively to the primary live wallet
        const targetId = ownerWalletId || primaryLive.getState().walletId;
        assignedPositions.get(targetId)?.push(pos);
      }

      // Partition open resting orders by matching trade/market
      for (const ord of allOpenOrders) {
        let ownerWalletId: string | null = null;
        for (const w of liveWallets) {
          const trades = w.getTradeHistory();
          if (trades.some((t) => t.marketId === ord.marketId)) {
            ownerWalletId = w.getState().walletId;
            break;
          }
        }
        const targetId = ownerWalletId || primaryLive.getState().walletId;
        assignedOrders.get(targetId)?.push(ord);
      }

      // Partition trade history among live wallets
      const allTrades = primaryLive.getTradeHistory();
      const assignedTrades = new Map<string, TradeRecord[]>();
      for (const w of liveWallets) {
        assignedTrades.set(w.getState().walletId, []);
      }
      for (const trade of allTrades) {
        let targetId = trade.walletId;
        if (!assignedTrades.has(targetId)) {
          targetId = primaryLive.getState().walletId;
        }
        assignedTrades.get(targetId)?.push(trade);
      }

      // Apply cleanly partitioned state to each live wallet
      for (const w of liveWallets) {
        const wId = w.getState().walletId;
        const myPositions = assignedPositions.get(wId) ?? [];
        const myOrders = assignedOrders.get(wId) ?? [];
        const myTrades = assignedTrades.get(wId) ?? [];

        if ('state' in w) {
          (w as any).state.openPositions = myPositions;
        }
        if ('openOrders' in w) {
          (w as any).openOrders = myOrders;
        }
        if ('trades' in w && Array.isArray((w as any).trades)) {
          (w as any).trades.length = 0;
          (w as any).trades.push(...myTrades);
        }
      }
    }

    // Now collect clean GroundTruthResult for each wallet
    const results: GroundTruthResult[] = [];
    for (const wallet of this.wallets.values()) {
      if (typeof wallet.syncGroundTruth === 'function') {
        try {
          const state = wallet.getState();
          const openOrders = typeof wallet.getOpenOrders === 'function' ? wallet.getOpenOrders() : [];
          const trades = wallet.getTradeHistory();
          results.push({
            walletId: state.walletId,
            mode: state.mode,
            timestamp: Date.now(),
            balanceUSDC: state.availableBalance,
            capitalAllocated: state.capitalAllocated,
            positionsCount: state.openPositions.length,
            openOrdersCount: openOrders.length,
            tradesCount: trades.length,
            positions: [...state.openPositions],
            openOrders: [...openOrders],
            recentTrades: trades.slice(-20),
          });
        } catch (err) {
          logger.error({ err, walletId: wallet.getState().walletId }, 'Error collecting ground truth for wallet');
        }
      }
    }
    return results;
  }
}

