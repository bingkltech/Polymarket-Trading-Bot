import { describe, it, expect } from 'vitest';
import { RiskEngine } from '../src/risk/risk_engine';
import { KillSwitch } from '../src/risk/kill_switch';
import { OrderRequest, WalletState } from '../src/types';
import { MarketPenaltyBox } from '../src/learning/penalty_box';

const walletState: WalletState = {
  walletId: 'wallet_1',
  mode: 'PAPER',
  assignedStrategy: 'momentum',
  capitalAllocated: 1000,
  availableBalance: 1000,
  openPositions: [],
  realizedPnl: 0,
  riskLimits: {
    maxPositionSize: 100,
    maxExposurePerMarket: 200,
    maxDailyLoss: 50,
    maxOpenTrades: 5,
    maxDrawdown: 0.2,
  },
};

const order: OrderRequest = {
  walletId: 'wallet_1',
  marketId: 'POLY-EXAMPLE',
  outcome: 'YES',
  side: 'BUY',
  price: 0.5,
  size: 5,
  strategy: 'momentum',
};

describe('RiskEngine', () => {
  it('approves orders within limits', () => {
    const engine = new RiskEngine(new KillSwitch());
    const result = engine.check(order, walletState);
    expect(result.ok).toBe(true);
  });

  it('rejects when kill switch active', () => {
    const killSwitch = new KillSwitch();
    killSwitch.activate();
    const engine = new RiskEngine(killSwitch);
    const result = engine.check(order, walletState);
    expect(result.ok).toBe(false);
  });

  it('rejects BUY orders with price >= 0.85 (Anti-Steamroller Guardrail)', () => {
    const engine = new RiskEngine(new KillSwitch());
    const steamrollerOrder: OrderRequest = { ...order, price: 0.85 };
    const result = engine.check(steamrollerOrder, walletState);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Anti-Steamroller Guardrail');

    // Also test that 0.82 is allowed for positive-EV Golden Band trades
    const goldenBandOrder: OrderRequest = { ...order, price: 0.82 };
    const goldenResult = engine.check(goldenBandOrder, walletState);
    expect(goldenResult.ok).toBe(true);
  });

  it('rejects BUY orders with size > 5 shares (Fixed 5 shares rule)', () => {
    const engine = new RiskEngine(new KillSwitch());
    const largeOrder: OrderRequest = { ...order, size: 10 };
    const result = engine.check(largeOrder, walletState);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Size Rule Veto');
  });

  it('rejects BUY orders when wallet already holds an open position (Single-Position Rule)', () => {
    const engine = new RiskEngine(new KillSwitch());
    const stateWithPos: WalletState = {
      ...walletState,
      openPositions: [
        {
          marketId: 'POLY-EXAMPLE',
          outcome: 'YES',
          size: 5,
          avgPrice: 0.50,
          realizedPnl: 0,
        },
      ],
    };
    const result = engine.check(order, stateWithPos);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Single-Position Rule');
  });

  it('allows SELL orders with price > 0.75 (Take Profit / Exit)', () => {
    const engine = new RiskEngine(new KillSwitch());
    const sellExitOrder: OrderRequest = { ...order, side: 'SELL', price: 0.90 };
    const result = engine.check(sellExitOrder, walletState);
    expect(result.ok).toBe(true);
  });

  it('rejects BUY orders on quarantined assets in Penalty Box', () => {
    const engine = new RiskEngine(new KillSwitch());
    const penaltyBox = MarketPenaltyBox.getInstance();
    penaltyBox.penalize('POLY-TOXIC', 3.50, 'Severe loss test');

    const toxicOrder: OrderRequest = { ...order, marketId: 'POLY-TOXIC', price: 0.60, size: 5 };
    const result = engine.check(toxicOrder, walletState);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Asset Penalty Box');

    // Clean up
    penaltyBox.pardon('POLY-TOXIC');
  });
});
