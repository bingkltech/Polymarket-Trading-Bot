/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DEERFLOW Learning System — Loss Analysis (Forensic Autopsy)
   Adapted from: KalshiMarketMaker/kalshi_market_maker/learning/Loss_Analysis.py

   When a trade closes at a loss, this module performs a forensic autopsy
   and tags the loss with one of 4 root causes so the Critic can make
   smarter adjustments.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { logger } from '../reporting/logs';

export type LossTag =
  | 'NATURAL_VARIANCE'
  | 'FALSE_ASSUMPTION'
  | 'ADVERSE_SELECTION'
  | 'LIQUIDITY_TRAP';

export interface LossContext {
  strategy: string;
  marketId: string;
  outcome: 'YES' | 'NO';
  entryPrice: number;
  exitPrice: number;
  intendedExitPrice: number;  // What stop-loss / exit price we *wanted*
  holdDurationMs: number;
  exitReason: string;
  pnlCents: number;
}

/**
 * Performs a forensic autopsy on a losing trade and returns a root cause tag.
 *
 * Tags (adapted from Kalshi's 3-tag system, extended to 4):
 *
 * 1. NATURAL_VARIANCE — Normal cost of doing business. Spread-crossing loss
 *    or time decay. Loss < 50 bps. Expected and acceptable.
 *
 * 2. FALSE_ASSUMPTION — The bot entered a high-probability convergence trade
 *    (entry > 0.85) expecting near-certain resolution, but the event resolved
 *    against it. The crowd's probability estimate was wrong.
 *
 * 3. ADVERSE_SELECTION — The position moved against us within 60 seconds of
 *    entry. A faster bot or breaking news sniped our stale quote before we
 *    could react. Kalshi lesson: 60% of losses were this tag.
 *
 * 4. LIQUIDITY_TRAP — The stop-loss triggered, but the actual exit price was
 *    > 20 bps worse than the intended exit price. There were no buyers when
 *    we needed to dump. The orderbook evaporated.
 */
export function analyzeLoss(ctx: LossContext): LossTag {
  const lossBps = Math.abs(ctx.pnlCents);
  const holdMin = ctx.holdDurationMs / 60_000;
  const slippageOnExit = Math.abs(ctx.exitPrice - ctx.intendedExitPrice) * 10_000;

  // 1. ADVERSE_SELECTION: Position moved against us within 1 minute
  //    (Kalshi's killer insight — sniped by faster information)
  if (holdMin < 1.0 && lossBps > 10) {
    logger.warn(
      { strategy: ctx.strategy, market: ctx.marketId, tag: 'ADVERSE_SELECTION', holdMin, lossBps },
      'Loss Autopsy: SNIPED — position reversed within 60s',
    );
    return 'ADVERSE_SELECTION';
  }

  // 2. FALSE_ASSUMPTION: High-confidence entry that was just wrong
  //    (Adapted from Kalshi's avg_buy_price > 80 check)
  if (ctx.entryPrice > 0.85 && ctx.exitReason !== 'TIME_EXIT') {
    logger.warn(
      { strategy: ctx.strategy, market: ctx.marketId, tag: 'FALSE_ASSUMPTION', entry: ctx.entryPrice },
      'Loss Autopsy: FALSE ASSUMPTION — high-prob trade resolved against us',
    );
    return 'FALSE_ASSUMPTION';
  }

  // 3. LIQUIDITY_TRAP: Exit slippage > 20 bps (no buyers when we needed them)
  if (slippageOnExit > 20) {
    logger.warn(
      { strategy: ctx.strategy, market: ctx.marketId, tag: 'LIQUIDITY_TRAP', slippageOnExit },
      'Loss Autopsy: LIQUIDITY TRAP — exit slippage exceeded 20 bps',
    );
    return 'LIQUIDITY_TRAP';
  }

  // 4. NATURAL_VARIANCE: Normal spread-crossing loss
  logger.info(
    { strategy: ctx.strategy, market: ctx.marketId, tag: 'NATURAL_VARIANCE', lossBps },
    'Loss Autopsy: NATURAL VARIANCE — normal cost of business',
  );
  return 'NATURAL_VARIANCE';
}

/**
 * Generate a human-readable summary of loss distribution
 * (mirrors Kalshi's MACRO LOSS SUMMARY output)
 */
export function summarizeLossTags(tags: LossTag[]): Record<LossTag, number> {
  const summary: Record<LossTag, number> = {
    NATURAL_VARIANCE: 0,
    FALSE_ASSUMPTION: 0,
    ADVERSE_SELECTION: 0,
    LIQUIDITY_TRAP: 0,
  };
  for (const tag of tags) {
    summary[tag]++;
  }
  return summary;
}
