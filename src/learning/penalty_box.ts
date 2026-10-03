/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DEERFLOW Learning System — Asset / Market Penalty Box
   Adapted from: KalshiMarketMaker learning & risk feedback loop

   When an asset / market delivers a negative PnL or suffers an adverse
   event, it is placed into the Penalty Box quarantine so the bot NEVER
   re-enters or repeats the same mistake on that asset.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../reporting/logs';
import { consoleLog } from '../reporting/console_log';

export interface PenalizedMarket {
  marketId: string;
  lossUsd: number;
  reason: string;
  penalizedAt: number;
  expiresAt: number;
  permanent: boolean;
}

const PENALTY_FILE = '.runtime/penalty_box.json';
const DEFAULT_QUARANTINE_MS = 48 * 3600_000; // 48-hour quarantine for losing assets
const PERMANENT_LOSS_THRESHOLD_USD = 5.00;   // Permanent quarantine if loss >= $5.00

export class MarketPenaltyBox {
  private static instance: MarketPenaltyBox;
  private penalized = new Map<string, PenalizedMarket>();

  constructor() {
    this.loadState();
    MarketPenaltyBox.instance = this;
  }

  static getInstance(): MarketPenaltyBox {
    if (!MarketPenaltyBox.instance) {
      MarketPenaltyBox.instance = new MarketPenaltyBox();
    }
    return MarketPenaltyBox.instance;
  }

  private loadState(): void {
    try {
      if (fs.existsSync(PENALTY_FILE)) {
        const data = JSON.parse(fs.readFileSync(PENALTY_FILE, 'utf8')) as PenalizedMarket[];
        const now = Date.now();
        for (const item of data) {
          if (item.permanent || item.expiresAt > now) {
            this.penalized.set(item.marketId, item);
          }
        }
        logger.info({ count: this.penalized.size }, 'Loaded active Penalty Box markets from disk');
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load penalty box from disk');
    }
  }

  private saveState(): void {
    try {
      const dir = path.dirname(PENALTY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const items = Array.from(this.penalized.values());
      fs.writeFileSync(PENALTY_FILE, JSON.stringify(items, null, 2));
    } catch (err) {
      logger.warn({ err }, 'Failed to save penalty box to disk');
    }
  }

  /**
   * Place a market into the Penalty Box after a losing trade
   */
  penalize(marketIdOrIds: string | string[], lossUsd: number, reason: string, durationMs = DEFAULT_QUARANTINE_MS): void {
    const now = Date.now();
    const isPermanent = lossUsd >= PERMANENT_LOSS_THRESHOLD_USD;
    const expiresAt = isPermanent ? Number.MAX_SAFE_INTEGER : now + durationMs;
    const ids = Array.isArray(marketIdOrIds) ? marketIdOrIds : [marketIdOrIds];

    for (const rawId of ids) {
      if (!rawId) continue;
      const marketId = rawId.toLowerCase();
      const existing = this.penalized.get(marketId);
      const cumulativeLoss = (existing?.lossUsd ?? 0) + lossUsd;

      const record: PenalizedMarket = {
        marketId,
        lossUsd: cumulativeLoss,
        reason,
        penalizedAt: now,
        expiresAt,
        permanent: isPermanent || cumulativeLoss >= PERMANENT_LOSS_THRESHOLD_USD,
      };

      this.penalized.set(marketId, record);
    }
    this.saveState();

    const primaryId = ids[0] ?? 'unknown';
    const quarantineType = isPermanent ? 'PERMANENT' : `${(durationMs / 3600_000).toFixed(0)}h`;
    logger.warn(
      { marketId: primaryId, lossUsd: lossUsd.toFixed(2), reason, quarantine: quarantineType },
      'Asset quarantined in Penalty Box — future entries blocked',
    );

    consoleLog.warn(
      'PENALTY_BOX',
      `Asset ${primaryId} QUARANTINED (${quarantineType}) after -$${lossUsd.toFixed(2)} loss [${reason}]`,
      { marketId: primaryId, lossUsd, reason, permanent: isPermanent },
    );
  }

  /**
   * Check if a market is currently quarantined in the Penalty Box
   */
  isPenalized(marketIdOrIds: string | string[]): { penalized: boolean; reason?: string; remainingHours?: number } {
    const ids = Array.isArray(marketIdOrIds) ? marketIdOrIds : [marketIdOrIds];
    const now = Date.now();

    for (const rawId of ids) {
      if (!rawId) continue;
      const marketId = rawId.toLowerCase();
      const record = this.penalized.get(marketId);
      if (record) {
        if (!record.permanent && now >= record.expiresAt) {
          this.penalized.delete(marketId);
          this.saveState();
          continue;
        }

        const remainingHours = record.permanent ? Infinity : (record.expiresAt - now) / 3600_000;
        return {
          penalized: true,
          reason: `${record.reason} (Total loss -$${record.lossUsd.toFixed(2)})`,
          remainingHours,
        };
      }
    }

    return { penalized: false };
  }

  /**
   * Get list of all quarantined markets
   */
  getAllPenalized(): PenalizedMarket[] {
    const now = Date.now();
    const active: PenalizedMarket[] = [];
    for (const [id, rec] of this.penalized) {
      if (rec.permanent || rec.expiresAt > now) {
        active.push(rec);
      } else {
        this.penalized.delete(id);
      }
    }
    return active;
  }

  /**
   * Clear penalty for a market (manual override)
   */
  pardon(marketId: string): void {
    this.penalized.delete(marketId);
    this.saveState();
    logger.info({ marketId }, 'Market pardoned from Penalty Box');
  }
}
