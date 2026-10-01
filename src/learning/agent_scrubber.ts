import * as fs from 'fs';
import * as path from 'path';
import { TradeMemoryBank } from './memory_bank';
import { ModelCritic, StrategyGrade } from './critic';
import { logger } from '../reporting/logs';

export enum VetoCategory {
  NONE = 'NONE',
  WHALE_QUEUE = 'WHALE_QUEUE',
  RAZOR_TIGHT_MOAT = 'RAZOR_TIGHT_MOAT',
  VPIN_TOXIC = 'VPIN_TOXIC',
  IN_FLIGHT_LOCKOUT = 'IN_FLIGHT_LOCKOUT',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  FAKE_CONFIDENCE = 'FAKE_CONFIDENCE',
}

export enum CycleOutcome {
  CYCLE_HELD_VETO = 'CYCLE_HELD_VETO',
  TRADE_FIRED_WIN = 'TRADE_FIRED_WIN',
  TRADE_FIRED_LOSS = 'TRADE_FIRED_LOSS',
}

export interface CondensedCycleTelemetry {
  cycle_ticker: string;
  asset: string;
  timeframe: string;
  outcome: CycleOutcome;
  trade_side?: string;
  pnl?: number;
  dominant_veto: VetoCategory;
  deer_briefing: string;
  generated_at_utc: string;
}

const LESSONS_FILE = path.join(process.cwd(), 'src', 'learning', 'lessons_learned.md');
const VAULT_DIR = path.join(process.cwd(), '.runtime', 'vault');

/**
 * Agent Scrubber
 * Inspired by the Kalshi Simulator DeerScrubber.
 * Periodically processes raw telemetry, shrinks thousands of log lines into
 * high-signal semantic digests, and updates the repository's Lessons Learned vault.
 */
export class AgentScrubber {
  private memoryBank: TradeMemoryBank;

  constructor(memoryBank: TradeMemoryBank) {
    this.memoryBank = memoryBank;
    if (!fs.existsSync(VAULT_DIR)) {
      fs.mkdirSync(VAULT_DIR, { recursive: true });
    }
  }

  /**
   * Deterministic zero-cost template generator (Fallback when no LLM is available)
   */
  public generateBriefingFallback(
    outcome: CycleOutcome,
    dominantVeto: VetoCategory,
    tradeSide?: string,
    pnl?: number
  ): string {
    if (outcome === CycleOutcome.TRADE_FIRED_WIN) {
      return `Executed ${tradeSide?.toUpperCase() || 'TRADE'} fill successfully; market settled in favorable directional parity resulting in +$${pnl?.toFixed(2)} PnL.`;
    } else if (outcome === CycleOutcome.TRADE_FIRED_LOSS) {
      return `Executed ${tradeSide?.toUpperCase() || 'TRADE'} fill but late adverse price reversal slipped through settlement, ending in -$${Math.abs(pnl || 0).toFixed(2)} loss.`;
    } else if (dominantVeto === VetoCategory.WHALE_QUEUE) {
      return `Cycle held in defensive quarantine: persistent institutional resting wall blocked execution.`;
    } else if (dominantVeto === VetoCategory.RAZOR_TIGHT_MOAT) {
      return `Cycle held: spot separation remained inside strike noise corridor, vetoing coin-flip exposure.`;
    } else if (dominantVeto === VetoCategory.FAKE_CONFIDENCE) {
      return `Cycle held: ModelCritic caught Fake Confidence (profitable on paper but 0% fill rate). Agent penalized.`;
    } else if (dominantVeto === VetoCategory.INSUFFICIENT_FUNDS) {
      return `Cycle held: Execution engine halted due to API rejection (Insufficient Funds / Dust limits).`;
    } else {
      return `Cycle held: market conditions failed entry conviction hurdles. Capital preserved with 0 risk.`;
    }
  }

  /**
   * Run periodically to evaluate recent cycles, classify vetos and trades,
   * and update the Lessons Learned markdown file.
   */
  public async scrubAndCondense(criticGrades: Record<string, StrategyGrade>): Promise<void> {
    logger.info('Scrubber: Compiling telemetric digest from recent cycles...');

    // Extract lessons from Critic Grades
    let newLessons = '';
    
    for (const [strategy, grade] of Object.entries(criticGrades)) {
      if (grade.flags.includes('FAKE_CONFIDENCE')) {
        newLessons += `- **${strategy}**: Flagged for FAKE_CONFIDENCE. High simulated PnL but ${((grade.fillRate)*100).toFixed(1)}% fill rate. Strategy weight crushed to ${grade.weight}.\n`;
      } else if (grade.flags.includes('PENALTY_BOX')) {
        newLessons += `- **${strategy}**: Flagged for PENALTY_BOX. Strategy bleeds capital (Avg PnL: $${grade.avgPnlCents.toFixed(2)}). Weight crushed to ${grade.weight}.\n`;
      } else if (grade.flags.includes('STAR_PERFORMER')) {
        newLessons += `- **${strategy}**: STAR_PERFORMER. Exceptional PnL capture. Weight boosted to ${grade.weight}.\n`;
      }
    }

    if (newLessons.length > 0) {
      this.updateLessonsLearned(newLessons);
    }
  }

  private updateLessonsLearned(newBullets: string) {
    let existingContent = '';
    
    if (fs.existsSync(LESSONS_FILE)) {
      existingContent = fs.readFileSync(LESSONS_FILE, 'utf8');
    } else {
      existingContent = `# Live Trading: Lessons Learned & Institutional Memory\n\nThis file is autonomously updated by the Agent Scrubber subagent.\nIt observes mistakes, calculates dynamic weights, and writes its findings here to permanently adjust live trading behavior.\n\n## Autonomous Observations\n\n`;
      const dir = path.dirname(LESSONS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    // Append with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const updateBlock = `### Update [${timestamp}]\n${newBullets}\n`;

    if (!existingContent.includes(updateBlock.trim())) {
      const finalContent = existingContent + updateBlock;
      fs.writeFileSync(LESSONS_FILE, finalContent);
      logger.info('Scrubber: Appended new findings to lessons_learned.md');
    }
  }
}
