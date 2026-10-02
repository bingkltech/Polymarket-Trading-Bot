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
import { WalletState, WalletConfig, TradeRecord } from '../types';
import { logger } from '../reporting/logs';

import { OrderbookStream } from '../data/orderbook_stream';
import { ClobFetcher } from '../data/clob_fetcher';

export interface ExecutionWallet {
  getState(): WalletState;
  getTradeHistory(): TradeRecord[];
  placeOrder(request: {
    marketId: string;
    outcome: 'YES' | 'NO';
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
  }): Promise<void>;
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

  addWallet(wallet: ExecutionWallet): void {
    const state = wallet.getState();
    if (this.wallets.has(state.walletId)) {
      throw new Error(`Wallet ${state.walletId} already registered`);
    }
    this.wallets.set(state.walletId, wallet);
    logger.info(
      { walletId: state.walletId, mode: state.mode, strategy: state.assignedStrategy, capital: state.capitalAllocated },
      `Wallet ${state.walletId} added at runtime (${state.mode}) strategy=${state.assignedStrategy}`,
    );
  }
}
