import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PolymarketWallet } from '../src/wallets/polymarket_wallet';
import { PaperWallet } from '../src/wallets/paper_wallet';
import { WalletManager } from '../src/wallets/wallet_manager';
import { Engine } from '../src/core/engine';
import { OrderRouter } from '../src/execution/order_router';
import { AppConfig, GroundTruthResult, OpenOrder } from '../src/types';

describe('Ground Truth Synchronization System', () => {
  const sampleConfig: AppConfig = {
    environment: { enableLiveTrading: false },
    wallets: [
      {
        id: 'test_paper_1',
        mode: 'PAPER',
        strategy: 'market_making',
        capital: 500,
      },
    ],
    strategyConfig: {
      market_making: {},
    },
    polymarket: {
      gammaApi: 'https://gamma-api.polymarket.com',
      clobApi: 'https://clob.polymarket.com',
    },
  };

  it('PaperWallet implements syncGroundTruth and getOpenOrders', async () => {
    const paper = new PaperWallet(
      {
        id: 'test_paper',
        mode: 'PAPER',
        strategy: 'market_making',
        capital: 500,
      },
      'market_making'
    );

    const openOrders = paper.getOpenOrders();
    expect(Array.isArray(openOrders)).toBe(true);
    expect(openOrders.length).toBe(0);

    const truth = await paper.syncGroundTruth();
    expect(truth.walletId).toBe('test_paper');
    expect(truth.mode).toBe('PAPER');
    expect(truth.balanceUSDC).toBe(500);
    expect(truth.openOrdersCount).toBe(0);
  });

  it('WalletManager syncAllGroundTruth collects ground truth from all registered wallets', async () => {
    const wm = new WalletManager();
    wm.registerWallet(
      {
        id: 'w1',
        mode: 'PAPER',
        strategy: 'market_making',
        capital: 500,
      },
      'market_making',
      false
    );

    const results = await wm.syncAllGroundTruth();
    expect(results.length).toBe(1);
    expect(results[0].walletId).toBe('w1');
    expect(results[0].balanceUSDC).toBe(500);

    const ordersMap = wm.getAllOpenOrders();
    expect(ordersMap.has('w1')).toBe(true);
    expect(ordersMap.get('w1')?.length).toBe(0);
  });

  it('Engine syncAllGroundTruth orchestrates wallet synchronization', async () => {
    const wm = new WalletManager();
    wm.registerWallet(
      {
        id: 'test_paper_1',
        mode: 'PAPER',
        strategy: 'market_making',
        capital: 500,
      },
      'market_making',
      false
    );
    const router = new OrderRouter(wm);
    const engine = new Engine(sampleConfig, wm, router);

    await engine.initialize();
    const syncResults = await engine.syncAllGroundTruth();
    expect(Array.isArray(syncResults)).toBe(true);
    expect(syncResults.length).toBe(1);
    expect(syncResults[0].walletId).toBe('test_paper_1');
  });

  it('buildDashboardPayload calculates accurate non-inflated cash, engaged capital, and portfolio value for shared wallets', async () => {
    const { buildDashboardPayload } = await import('../src/reporting/dashboard_api');

    const liveWallets = [
      {
        walletId: 'MIspricing-Live',
        mode: 'LIVE' as const,
        assignedStrategy: 'mispricing_arbitrage',
        capitalAllocated: 10,
        availableBalance: 36.66,
        openPositions: [
          {
            marketId: 'ufc_market',
            outcome: 'YES' as const,
            size: 5,
            avgPrice: 0.52,
            realizedPnl: 0,
            curPrice: 0.515,
            currentValue: 2.575,
          },
        ],
        realizedPnl: 0,
        riskLimits: {
          maxPositionSize: 5,
          maxExposurePerMarket: 10,
          maxDailyLoss: 6.5,
          maxOpenTrades: 5,
          maxDrawdown: 0.65,
        },
      },
      {
        walletId: 'market making',
        mode: 'LIVE' as const,
        assignedStrategy: 'market_making',
        capitalAllocated: 10,
        availableBalance: 36.66,
        openPositions: [],
        realizedPnl: 0,
        riskLimits: {
          maxPositionSize: 5,
          maxExposurePerMarket: 10,
          maxDailyLoss: 6.5,
          maxOpenTrades: 5,
          maxDrawdown: 0.65,
        },
      },
      {
        walletId: 'Copy trade - live',
        mode: 'LIVE' as const,
        assignedStrategy: 'copy_trade',
        capitalAllocated: 15,
        availableBalance: 36.66,
        openPositions: [],
        realizedPnl: 0,
        riskLimits: {
          maxPositionSize: 5,
          maxExposurePerMarket: 10,
          maxDailyLoss: 9.75,
          maxOpenTrades: 5,
          maxDrawdown: 0.65,
        },
      },
    ];

    const tradesMap = new Map();
    const payload = buildDashboardPayload(liveWallets, tradesMap);

    // Free liquid cash on Polymarket must be $36.66 (not 36.66 * 3)
    expect(payload.polymarketCash).toBe(36.66);
    // Total strategy budget ceiling must be $35 ($10 + $10 + $15)
    expect(payload.totalBudget).toBe(35);
    // Engaged capital in positions must be $2.60 (5 * 0.52)
    expect(payload.engagedCapital).toBe(2.6);
    // Total portfolio value = Cash ($36.66) + Position Value ($2.575) ≈ $39.235 -> $39.235 or rounded
    expect(payload.portfolioValue).toBeCloseTo(39.235, 2);
    // Active positions in primary wallet must be exactly 1
    expect(payload.wallets[0].openPositions.length).toBe(1);
    expect(payload.wallets[1].openPositions.length).toBe(0);
    expect(payload.wallets[2].openPositions.length).toBe(0);
  });
});
