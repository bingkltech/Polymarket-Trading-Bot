import { OrderRequest, WalletState } from '../types';
import { KillSwitch } from './kill_switch';
import { consoleLog } from '../reporting/console_log';
import { MarketPenaltyBox } from '../learning/penalty_box';

export class RiskEngine {
  private readonly killSwitch: KillSwitch;

  /** Rolling order timestamps per wallet for rate limiting */
  private orderTimestamps = new Map<string, number[]>();

  /** Cancel counts per wallet (rolling window) */
  private cancelCounts = new Map<string, number[]>();

  /** Total MLE (max loss at resolution) per wallet */
  private walletMle = new Map<string, number>();

  constructor(killSwitch: KillSwitch) {
    this.killSwitch = killSwitch;
  }

  check(order: OrderRequest, wallet: WalletState): { ok: boolean; reason?: string } {
    if (this.killSwitch.isActive()) {
      consoleLog.error('RISK', `KILL SWITCH active — all orders blocked [${order.walletId}]`, {
        walletId: order.walletId,
      });
      return { ok: false, reason: 'Global kill switch active' };
    }

    /* ── BUY-Specific Risk Guardrails (Never block SELL / Exit orders) ── */
    if (order.side === 'BUY') {
      // 0. Asset Penalty Box Veto: Never re-enter an asset that delivered negative profit
      const penalty = MarketPenaltyBox.getInstance().isPenalized(order.marketId);
      if (penalty.penalized) {
        return { ok: false, reason: `Asset Penalty Box: Market quarantined (${penalty.reason})` };
      }

      // Single-Position Per Market Veto: NEVER buy into a market if we already hold an active position
      const hasExistingPosition = wallet.openPositions.some(
        (p) => p.marketId === order.marketId && p.size > 0
      );
      if (hasExistingPosition) {
        return { ok: false, reason: `Single-Position Rule: Wallet already has an open position in market ${order.marketId}` };
      }

      // Single-Transaction / Fixed-Size Rule: Strictly max 5 shares per trade
      if (order.size > 5) {
        return { ok: false, reason: `Size Rule Veto: Order size ${order.size} exceeds maximum 5 shares` };
      }

      // 1. Anti-Steamroller Guardrail: Prohibit buying contracts at or above 85¢ (toxic asymmetric risk/reward traps)
      if (order.price >= 0.85) {
        return { ok: false, reason: `Anti-Steamroller Guardrail: Price $${order.price.toFixed(2)} exceeds 84¢ entry ceiling (EV protection)` };
      }

      const orderCost = order.price * order.size;
      if (orderCost > wallet.availableBalance) {
        return { ok: false, reason: `Insufficient balance: need $${orderCost.toFixed(2)}, have $${wallet.availableBalance.toFixed(2)}` };
      }

      const absSize = Math.abs(order.size);
      if (absSize > wallet.riskLimits.maxPositionSize) {
        return { ok: false, reason: 'Max position size exceeded' };
      }

      if (wallet.openPositions.length >= wallet.riskLimits.maxOpenTrades) {
        return { ok: false, reason: 'Max open trades exceeded' };
      }

      if (wallet.realizedPnl <= -wallet.riskLimits.maxDailyLoss) {
        return { ok: false, reason: 'Max daily loss breached' };
      }

      // 2. Minimum Notional Check ($1.00 for Polymarket CLOB in Live mode)
      if (wallet.mode === 'LIVE' && orderCost < 1.00) {
        return { ok: false, reason: `Polymarket Min Notional Veto: Order cost $${orderCost.toFixed(2)} < $1.00 minimum` };
      }

      // 3. Dust Limit Quarantine (Polymarket requires orders >= $0.10)
      if (orderCost < 0.10 && wallet.mode === 'PAPER') {
        return { ok: false, reason: 'Dust Limit Veto: Order size under $0.10 threshold' };
      }

      // 4. Double-Bet / In-Flight Veto (Avoid overlapping resting limit orders)
      const hasDuplicateOpen = ((wallet as any).openOrders || []).some(
        (o: any) => o.marketId === order.marketId && o.outcome === order.outcome && o.side === order.side
      );
      if (hasDuplicateOpen) {
        return { ok: false, reason: 'Double-Bet Quarantine: Resting order already exists for this outcome' };
      }

      // 3. Drawdown check: based on true cumulative loss, not deployed cash
      const netLoss = Math.max(0, -wallet.realizedPnl);
      const drawdownPct = wallet.capitalAllocated > 0 ? (netLoss / wallet.capitalAllocated) : 0;
      if (drawdownPct > wallet.riskLimits.maxDrawdown) {
        return { ok: false, reason: `Drawdown ${(drawdownPct * 100).toFixed(1)}% exceeds limit ${(wallet.riskLimits.maxDrawdown * 100).toFixed(1)}%` };
      }

      // 4. Per-market exposure check
      const existingExposure = wallet.openPositions
        .filter((p) => p.marketId === order.marketId)
        .reduce((s, p) => s + Math.abs(p.avgPrice * p.size), 0);
      if (existingExposure + orderCost > wallet.riskLimits.maxExposurePerMarket) {
        return { ok: false, reason: 'Max exposure per market exceeded' };
      }
    }

    // 5. Fake Confidence / Penalty Box check
    const cancelRate = this.getCancelRate(wallet.walletId);
    const recentOrders = (this.orderTimestamps.get(wallet.walletId) ?? []).filter((t) => Date.now() - t < 300_000);
    if (cancelRate > 0.95 && recentOrders.length > 20) {
      return { ok: false, reason: 'Toxic Cancellation Veto: High fake-confidence spam detected. Halting.' };
    }

    /* ── Rate limiting: max orders per minute per wallet ── */
    const rateLimit = wallet.mode === 'PAPER' ? 120 : 20;
    const now = Date.now();
    const stamps = this.orderTimestamps.get(wallet.walletId) ?? [];
    const recentStamps = stamps.filter((t) => now - t < 60_000);
    if (recentStamps.length >= rateLimit) {
      return { ok: false, reason: `Order rate limit (${rateLimit}/min) exceeded` };
    }
    recentStamps.push(now);
    this.orderTimestamps.set(wallet.walletId, recentStamps);

    return { ok: true };
  }

  /** Record a cancel event for rate tracking */
  recordCancel(walletId: string): void {
    const now = Date.now();
    const cancels = this.cancelCounts.get(walletId) ?? [];
    cancels.push(now);
    this.cancelCounts.set(walletId, cancels.filter((t) => now - t < 300_000));
  }

  /** Get the cancel rate over the last 5 minutes */
  getCancelRate(walletId: string): number {
    const now = Date.now();
    const cancels = (this.cancelCounts.get(walletId) ?? []).filter((t) => now - t < 300_000);
    const orders = (this.orderTimestamps.get(walletId) ?? []).filter((t) => now - t < 300_000);
    if (orders.length === 0) return 0;
    return cancels.length / orders.length;
  }
}
