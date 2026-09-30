/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DEERFLOW Learning System — Memory Bank
   Adapted from: KalshiMarketMaker/kalshi_market_maker/learning/memory_bank.py

   Persistent SQLite trade journal that logs every order, fill, and
   settlement. The bot builds a growing "brain" of its own trade history
   that survives restarts and feeds into the Critic & Loss Analysis.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../reporting/logs';

export interface OrderRecord {
  orderId: string;
  marketId: string;
  strategy: string;
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  status: 'submitted' | 'filled' | 'partial' | 'cancelled' | 'expired';
  createdAt: string;
}

export interface FillRecord {
  fillId: string;
  orderId: string;
  marketId: string;
  strategy: string;
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  intendedPrice: number;
  actualPrice: number;
  size: number;
  slippageBps: number;
  latencyMs: number;
  filledAt: string;
}

export interface SettlementRecord {
  settlementId: string;
  marketId: string;
  strategy: string;
  outcome: 'YES' | 'NO';
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnlCents: number;
  holdDurationMin: number;
  exitReason: string;
  lossTag: string | null;
  settledAt: string;
}

export class TradeMemoryBank {
  private db: Database.Database;

  constructor(dbPath = '.runtime/memory.db') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._initTables();
    logger.info({ dbPath }, 'Memory Bank initialised');
  }

  /* ── Schema ─────────────────────────────────────────────────── */
  private _initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders_log (
        order_id       TEXT PRIMARY KEY,
        market_id      TEXT NOT NULL,
        strategy       TEXT NOT NULL,
        outcome        TEXT NOT NULL,
        side           TEXT NOT NULL,
        price          REAL NOT NULL,
        size           INTEGER NOT NULL,
        status         TEXT NOT NULL DEFAULT 'submitted',
        created_at     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fills_log (
        fill_id        TEXT PRIMARY KEY,
        order_id       TEXT NOT NULL,
        market_id      TEXT NOT NULL,
        strategy       TEXT NOT NULL,
        outcome        TEXT NOT NULL,
        side           TEXT NOT NULL,
        intended_price REAL NOT NULL,
        actual_price   REAL NOT NULL,
        size           INTEGER NOT NULL,
        slippage_bps   REAL NOT NULL DEFAULT 0,
        latency_ms     REAL NOT NULL DEFAULT 0,
        filled_at      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settlements_log (
        settlement_id     TEXT PRIMARY KEY,
        market_id         TEXT NOT NULL,
        strategy          TEXT NOT NULL,
        outcome           TEXT NOT NULL,
        entry_price       REAL NOT NULL,
        exit_price        REAL NOT NULL,
        size              INTEGER NOT NULL,
        pnl_cents         REAL NOT NULL,
        hold_duration_min REAL NOT NULL,
        exit_reason       TEXT NOT NULL,
        loss_tag          TEXT,
        settled_at        TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_strategy ON orders_log(strategy);
      CREATE INDEX IF NOT EXISTS idx_fills_strategy  ON fills_log(strategy);
      CREATE INDEX IF NOT EXISTS idx_settlements_strategy ON settlements_log(strategy);
      CREATE INDEX IF NOT EXISTS idx_settlements_time ON settlements_log(settled_at);
    `);
  }

  /* ── Logging ────────────────────────────────────────────────── */

  logOrder(record: OrderRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO orders_log
      (order_id, market_id, strategy, outcome, side, price, size, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.orderId, record.marketId, record.strategy,
      record.outcome, record.side, record.price, record.size,
      record.status, record.createdAt,
    );
  }

  updateOrderStatus(orderId: string, status: string): void {
    this.db.prepare('UPDATE orders_log SET status = ? WHERE order_id = ?').run(status, orderId);
  }

  logFill(record: FillRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO fills_log
      (fill_id, order_id, market_id, strategy, outcome, side,
       intended_price, actual_price, size, slippage_bps, latency_ms, filled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.fillId, record.orderId, record.marketId, record.strategy,
      record.outcome, record.side, record.intendedPrice, record.actualPrice,
      record.size, record.slippageBps, record.latencyMs, record.filledAt,
    );
  }

  logSettlement(record: SettlementRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO settlements_log
      (settlement_id, market_id, strategy, outcome, entry_price, exit_price,
       size, pnl_cents, hold_duration_min, exit_reason, loss_tag, settled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.settlementId, record.marketId, record.strategy,
      record.outcome, record.entryPrice, record.exitPrice,
      record.size, record.pnlCents, record.holdDurationMin,
      record.exitReason, record.lossTag, record.settledAt,
    );
  }

  /* ── Queries (used by Critic & Loss Analysis) ───────────────── */

  getSettlementsSince(hoursAgo: number): SettlementRecord[] {
    const cutoff = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
    return this.db.prepare(`
      SELECT settlement_id AS settlementId, market_id AS marketId,
             strategy, outcome, entry_price AS entryPrice,
             exit_price AS exitPrice, size, pnl_cents AS pnlCents,
             hold_duration_min AS holdDurationMin,
             exit_reason AS exitReason, loss_tag AS lossTag,
             settled_at AS settledAt
      FROM settlements_log WHERE settled_at >= ?
    `).all(cutoff) as SettlementRecord[];
  }

  getOrdersSince(hoursAgo: number): OrderRecord[] {
    const cutoff = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
    return this.db.prepare(`
      SELECT order_id AS orderId, market_id AS marketId,
             strategy, outcome, side, price, size, status,
             created_at AS createdAt
      FROM orders_log WHERE created_at >= ?
    `).all(cutoff) as OrderRecord[];
  }

  getFillsSince(hoursAgo: number): FillRecord[] {
    const cutoff = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
    return this.db.prepare(`
      SELECT fill_id AS fillId, order_id AS orderId,
             market_id AS marketId, strategy, outcome, side,
             intended_price AS intendedPrice, actual_price AS actualPrice,
             size, slippage_bps AS slippageBps, latency_ms AS latencyMs,
             filled_at AS filledAt
      FROM fills_log WHERE filled_at >= ?
    `).all(cutoff) as FillRecord[];
  }

  getStrategyStats(strategy: string, hoursAgo = 12): {
    totalTrades: number;
    avgPnl: number;
    winRate: number;
    totalPnl: number;
  } {
    const cutoff = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
    const rows = this.db.prepare(`
      SELECT pnl_cents FROM settlements_log
      WHERE strategy = ? AND settled_at >= ?
    `).all(strategy, cutoff) as { pnl_cents: number }[];

    if (rows.length === 0) {
      return { totalTrades: 0, avgPnl: 0, winRate: 0, totalPnl: 0 };
    }

    const wins = rows.filter(r => r.pnl_cents > 0).length;
    const totalPnl = rows.reduce((s, r) => s + r.pnl_cents, 0);

    return {
      totalTrades: rows.length,
      avgPnl: totalPnl / rows.length,
      winRate: wins / rows.length,
      totalPnl,
    };
  }

  getStrategyFillRate(strategy: string, hoursAgo = 12): number {
    const cutoff = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
    const total = (this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM orders_log
      WHERE strategy = ? AND created_at >= ?
    `).get(strategy, cutoff) as { cnt: number }).cnt;

    const filled = (this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM orders_log
      WHERE strategy = ? AND created_at >= ? AND status = 'filled'
    `).get(strategy, cutoff) as { cnt: number }).cnt;

    return total > 0 ? filled / total : 0;
  }

  close(): void {
    this.db.close();
  }
}
