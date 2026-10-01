/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DEERFLOW Learning System — Critic (Performance Judge)
   Adapted from: KalshiMarketMaker/kalshi_market_maker/learning/critic.py

   Runs periodically, reads the Memory Bank, grades every strategy, and
   writes dynamic_weights.json. Includes the "Fake Confidence" detector
   that was Kalshi's most important lesson.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import * as fs from 'fs';
import * as path from 'path';
import { TradeMemoryBank } from './memory_bank';
import { logger } from '../reporting/logs';

export interface StrategyGrade {
  strategy: string;
  totalTrades: number;
  avgPnlCents: number;
  winRate: number;
  fillRate: number;
  weight: number;
  flags: string[];
}

const WEIGHTS_PATH = '.runtime/dynamic_weights.json';

export class ModelCritic {
  private memoryBank: TradeMemoryBank;
  private minSampleSize: number;
  private redemptionHours: number;
  private minFillRate: number;       // Kalshi's killer feature
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(memoryBank: TradeMemoryBank, opts?: {
    minSampleSize?: number;
    redemptionHours?: number;
    minFillRate?: number;
  }) {
    this.memoryBank = memoryBank;
    this.minSampleSize = opts?.minSampleSize ?? 5;
    this.redemptionHours = opts?.redemptionHours ?? 12;
    this.minFillRate = opts?.minFillRate ?? 0.05;  // 5% fill rate minimum
  }

  /* ── Start the periodic critic loop ─────────────────────────── */
  start(intervalMs = 30 * 60_000): void {
    logger.info('Critic: Starting periodic analysis (every 30 min)');
    // Run immediately on startup
    this.analyzePerformance();
    // Then every intervalMs
    this.intervalHandle = setInterval(() => this.analyzePerformance(), intervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /* ── Core analysis (mirrors Kalshi's critic.py) ─────────────── */
  analyzePerformance(): Record<string, StrategyGrade> {
    logger.info('Critic: Analyzing Memory Bank with Liquidity Reality Check...');

    const settlements = this.memoryBank.getSettlementsSince(this.redemptionHours);
    const orders = this.memoryBank.getOrdersSince(this.redemptionHours);

    // Group by strategy
    const strategyMap = new Map<string, {
      pnl: number;
      count: number;
      wins: number;
      ordersPlaced: number;
      ordersFilled: number;
      lossTags: Record<string, number>;
    }>();

    for (const s of settlements) {
      const entry = strategyMap.get(s.strategy) ?? {
        pnl: 0, count: 0, wins: 0, ordersPlaced: 0, ordersFilled: 0,
        lossTags: {},
      };
      entry.pnl += s.pnlCents;
      entry.count++;
      if (s.pnlCents > 0) entry.wins++;
      if (s.lossTag) {
        entry.lossTags[s.lossTag] = (entry.lossTags[s.lossTag] ?? 0) + 1;
      }
      strategyMap.set(s.strategy, entry);
    }

    for (const o of orders) {
      const entry = strategyMap.get(o.strategy) ?? {
        pnl: 0, count: 0, wins: 0, ordersPlaced: 0, ordersFilled: 0,
        lossTags: {},
      };
      entry.ordersPlaced++;
      if (o.status === 'filled') entry.ordersFilled++;
      strategyMap.set(o.strategy, entry);
    }

    // Calculate weights
    const dynamicWeights: Record<string, number> = {};
    const grades: Record<string, StrategyGrade> = {};

    for (const [strategy, stats] of strategyMap) {
      const fillRate = stats.ordersPlaced > 0
        ? stats.ordersFilled / stats.ordersPlaced
        : 0;

      let weight = 1.0;
      const flags: string[] = [];

      if (stats.count >= this.minSampleSize) {
        const avgPnl = stats.pnl / stats.count;

        // ── FAKE CONFIDENCE DETECTION (Kalshi's #1 lesson) ──
        // Profitable on paper, but nobody is filling our orders
        if (avgPnl > 0 && fillRate < this.minFillRate) {
          logger.warn(
            { strategy, avgPnl, fillRate: (fillRate * 100).toFixed(1) + '%' },
            'Critic: [FAKE CONFIDENCE ALERT] Profitable but illiquid. Forcing Incubation.',
          );
          weight = 0.1;
          flags.push('FAKE_CONFIDENCE');
        } else if (avgPnl > 20) {
          weight = 2.5;  // Star performer
          flags.push('STAR_PERFORMER');
        } else if (avgPnl > 0) {
          weight = 1.5;  // Solid performer
          flags.push('SOLID');
        } else if (avgPnl < -20) {
          weight = 0.1;  // Severe underperformer → Penalty Box
          flags.push('PENALTY_BOX');
        } else if (avgPnl < 0) {
          weight = 0.5;  // Struggling
          flags.push('STRUGGLING');
        }

        // ── ADVERSE SELECTION OVERRIDE ──
        // If > 50% of losses are ADVERSE_SELECTION, force wider spreads
        const totalLossTags = Object.values(stats.lossTags).reduce((a, b) => a + b, 0);
        const adverseCount = stats.lossTags['ADVERSE_SELECTION'] ?? 0;
        if (totalLossTags > 3 && adverseCount / totalLossTags > 0.5) {
          flags.push('HIGH_ADVERSE_SELECTION');
          weight = Math.min(weight, 0.5);  // cap weight
        }
      } else {
        flags.push('INSUFFICIENT_DATA');
      }

      dynamicWeights[strategy] = weight;
      grades[strategy] = {
        strategy,
        totalTrades: stats.count,
        avgPnlCents: stats.count > 0 ? stats.pnl / stats.count : 0,
        winRate: stats.count > 0 ? stats.wins / stats.count : 0,
        fillRate,
        weight,
        flags,
      };

      logger.info(
        {
          strategy,
          trades: stats.count,
          pnl: stats.pnl,
          fillRate: (fillRate * 100).toFixed(1) + '%',
          weight,
          flags,
        },
        `Critic: Strategy graded`,
      );
    }

    // Write to disk
    const dir = path.dirname(WEIGHTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(dynamicWeights, null, 4));
    logger.info('Critic: Saved dynamic_weights.json');

    // Autonomously scrub data into Lessons Learned
    import('./agent_scrubber').then((scrubModule) => {
      const scrubber = new scrubModule.AgentScrubber(this.memoryBank);
      scrubber.scrubAndCondense(grades).catch((err) => {
        logger.error({ err }, 'AgentScrubber failed to process lessons learned');
      });
    });

    return grades;
  }

  /* ── Read current weights (used by Incubation Override) ─────── */
  static readWeights(): Record<string, number> {
    try {
      if (fs.existsSync(WEIGHTS_PATH)) {
        return JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8'));
      }
    } catch {
      // First run — no weights file yet
    }
    return {};
  }
}
