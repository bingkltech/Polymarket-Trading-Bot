import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Engine } from '../src/core/engine';
import { WalletManager } from '../src/wallets/wallet_manager';
import { OrderRouter } from '../src/execution/order_router';
import { PolymarketWallet } from '../src/wallets/polymarket_wallet';
import { PaperWallet } from '../src/wallets/paper_wallet';
import { DashboardServer } from '../src/reporting/dashboard_server';
import { AppConfig } from '../src/types';
import http from 'http';

describe('Pocket Cockpit & Armed/Disarmed Engine Controls', () => {
  let mockConfig: AppConfig;
  let walletManager: WalletManager;
  let orderRouter: OrderRouter;
  let engine: Engine;

  beforeEach(() => {
    mockConfig = {
      polymarket: {
        clobApi: 'http://localhost:9999',
        gammaApi: 'http://localhost:9999',
        wsUrl: 'ws://localhost:9999',
      },
      wallets: [
        {
          id: 'paper-test',
          capital: 100,
          strategy: 'mispricing',
          mode: 'PAPER',
        },
      ],
      strategyConfig: {
        mispricing: {},
      },
    };

    walletManager = new WalletManager();
    walletManager.registerWallet(mockConfig.wallets[0], 'mispricing', false);
    orderRouter = new OrderRouter(walletManager, { maxExecutionSlippage: 0.05, minOrderSize: 5 });
    engine = new Engine(mockConfig, walletManager, orderRouter);
  });

  it('engine initializes with isArmed = true by default', () => {
    expect(engine.getIsArmed()).toBe(true);
  });

  it('engine can be disarmed and armed properly', () => {
    engine.disarm();
    expect(engine.getIsArmed()).toBe(false);

    engine.arm();
    expect(engine.getIsArmed()).toBe(true);
  });

  it('panicHalt disarms engine and cancels all orders', async () => {
    const cancelSpy = vi.spyOn(walletManager, 'cancelAllOrders').mockResolvedValue(3);
    const result = await engine.panicHalt();

    expect(engine.getIsArmed()).toBe(false);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(result.cancelledOrders).toBe(3);
  });

  it('PaperWallet supports cancelOrder and cancelAllOrders without errors', async () => {
    const wallet = new PaperWallet(mockConfig.wallets[0], 'mispricing');
    const cancelled = await wallet.cancelOrder('order-123');
    expect(cancelled).toBe(true);

    const count = await wallet.cancelAllOrders();
    expect(count).toBe(0);
  });

  it('PolymarketWallet supports cancelOrder and cancelAllOrders in simulated offline mode', async () => {
    const wallet = new PolymarketWallet(
      { id: 'live-test', capital: 50, strategy: 'mispricing', mode: 'PAPER' },
      'mispricing'
    );
    const cancelled = await wallet.cancelOrder('fake-order');
    expect(typeof cancelled).toBe('boolean');

    const allCount = await wallet.cancelAllOrders();
    expect(typeof allCount).toBe('number');
  });

  it('DashboardServer serves /widget and /pocket-cockpit HTML', async () => {
    const server = new DashboardServer(walletManager, 3999, engine);
    server.start();

    try {
      const fetchWidget = await fetch('http://localhost:3999/widget');
      expect(fetchWidget.status).toBe(200);
      const htmlWidget = await fetchWidget.text();
      expect(htmlWidget).toContain('Pocket Cockpit');
      expect(htmlWidget).toContain('ALPHA HARVESTER');
      expect(htmlWidget).toContain('btnArm');
      expect(htmlWidget).toContain('btnDisarm');
      expect(htmlWidget).toContain('btnPanic');

      const fetchCockpit = await fetch('http://localhost:3999/pocket-cockpit');
      expect(fetchCockpit.status).toBe(200);
      const htmlCockpit = await fetchCockpit.text();
      expect(htmlCockpit).toContain('Pocket Cockpit');

      const fetchStatus = await fetch('http://localhost:3999/api/bot/status');
      expect(fetchStatus.status).toBe(200);
      const statusData = await fetchStatus.json();
      expect(statusData.ok).toBe(true);
      expect(statusData.isArmed).toBe(true);

      const disarmRes = await fetch('http://localhost:3999/api/bot/disarm', { method: 'POST' });
      const disarmJson = await disarmRes.json();
      expect(disarmJson.ok).toBe(true);
      expect(disarmJson.isArmed).toBe(false);
      expect(engine.getIsArmed()).toBe(false);

      const armRes = await fetch('http://localhost:3999/api/bot/arm', { method: 'POST' });
      const armJson = await armRes.json();
      expect(armJson.ok).toBe(true);
      expect(armJson.isArmed).toBe(true);
      expect(engine.getIsArmed()).toBe(true);

      const panicRes = await fetch('http://localhost:3999/api/bot/panic', { method: 'POST' });
      const panicJson = await panicRes.json();
      expect(panicJson.ok).toBe(true);
      expect(panicJson.isArmed).toBe(false);
      expect(engine.getIsArmed()).toBe(false);
    } finally {
      server.stop();
    }
  });
});
