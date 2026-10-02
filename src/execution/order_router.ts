import { OrderRequest } from '../types';
import { WalletManager } from '../wallets/wallet_manager';
import { RiskEngine } from '../risk/risk_engine';
import { TradeExecutor } from './trade_executor';
import { logger } from '../reporting/logs';
import { consoleLog } from '../reporting/console_log';

export class OrderRouter {
  private orderCooldowns = new Map<string, number>();

  constructor(
    private readonly walletManager: WalletManager,
    private readonly riskEngine: RiskEngine,
    private readonly tradeExecutor: TradeExecutor,
  ) {}

  async route(order: OrderRequest): Promise<boolean> {
    const cooldownKey = `${order.walletId}:${order.marketId}:${order.outcome}:${order.side}`;
    const lastAttempt = this.orderCooldowns.get(cooldownKey) ?? 0;
    const now = Date.now();
    
    // Enforce 10-second cooldown on BUY orders to prevent spamming failed bids
    if (order.side === 'BUY' && now - lastAttempt < 10000) {
      return false; // Silently drop to prevent spam
    }
    this.orderCooldowns.set(cooldownKey, now);

    const wallet = this.walletManager.getWallet(order.walletId);
    if (!wallet) {
      logger.warn({ walletId: order.walletId }, 'Wallet not found');
      consoleLog.warn('ORDER', `Wallet ${order.walletId} not found — order dropped`, {
        walletId: order.walletId,
        marketId: order.marketId,
      });
      return false;
    }

    const state = wallet.getState();
    const risk = this.riskEngine.check(order, state);
    if (!risk.ok) {
      logger.warn({ walletId: order.walletId, reason: risk.reason }, 'Risk check failed');
      consoleLog.warn('RISK', `Risk rejected: ${risk.reason} [${order.walletId}] ${order.side} ${order.outcome} ×${order.size}`, {
        walletId: order.walletId,
        marketId: order.marketId,
        reason: risk.reason,
        side: order.side,
        outcome: order.outcome,
        price: order.price,
        size: order.size,
      });
      return false;
    }

    await this.tradeExecutor.execute(order, wallet);
    return true;
  }
}
