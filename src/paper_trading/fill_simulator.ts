import { SlippageModel } from './slippage_model';
import { MathStats } from './statistics';
import { consoleLog } from '../reporting/console_log';
import { logger } from '../reporting/logs';
import { OrderbookStream } from '../data/orderbook_stream';
import { ClobFetcher, OrderBookLevel } from '../data/clob_fetcher';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DEERFLOW Incubation-Hardened Fill Simulator
   ─────────────────────────────────────────────────────────────────────────────
   The original simulator lied by omission. It gave 100% fill rate, zero
   queue competition, free exits, and no gas fees. This version injects
   7 reality penalties so paper results match live results.

   See: fake_confidence_definition.md for the full rationale.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** Incubation configuration — all 7 reality penalties */
export interface IncubationConfig {
  /** Lie #1: Probability that a limit order actually gets filled (0.0–1.0). Default 0.35 */
  fillProbability: number;
  /** Lie #2: Extra book levels to skip (simulates orders ahead of you in queue) */
  queueDepthPenaltyLevels: number;
  /** Lie #3: Additional adverse bps to apply when book snapshot is stale */
  bookStalenessDecayBps: number;
  /** Lie #4: Multiplier on slippage for exit orders (stop-loss, take-profit) */
  exitSlippageMultiplier: number;
  /** Lie #5: Gas fee in USD deducted per order placement */
  gasFeePerOrderUsd: number;
  /** Lie #6: Liquidity decay % per hour for positions held > 30 min */
  liquidityDecayPctPerHour: number;
  /** Lie #7: Probability of losing the speed race on arbitrage strategies */
  arbRaceRejectionRate: number;
}

const DEFAULT_INCUBATION: IncubationConfig = {
  fillProbability: 0.35,
  queueDepthPenaltyLevels: 2,
  bookStalenessDecayBps: 8,
  exitSlippageMultiplier: 2.5,
  gasFeePerOrderUsd: 0.003,
  liquidityDecayPctPerHour: 0.20,
  arbRaceRejectionRate: 0.70,
};

export interface FillResult {
  orderId: string;
  marketId: string;
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  fee: number;
  gasFee: number;
  feeAsset: 'USDC' | 'SHARES';
  timestamp: number;
  rejected: boolean;
  rejectionReason: string | null;
}

export class FillSimulator {
  private readonly fallbackSlippage = new SlippageModel();
  private readonly incubation: IncubationConfig;
  /** Track gas fees accumulated this session */
  private totalGasFees = 0;

  constructor(
    private readonly stream?: OrderbookStream,
    private readonly clobFetcher?: ClobFetcher,
    incubationOverrides?: Partial<IncubationConfig>,
  ) {
    this.incubation = { ...DEFAULT_INCUBATION, ...incubationOverrides };
    logger.info(
      { incubation: this.incubation },
      'FillSimulator: Incubation-Hardened mode active',
    );
  }

  /** Get total gas fees burned this session (for dashboard display) */
  getAccumulatedGasFees(): number {
    return this.totalGasFees;
  }

  async simulate(request: {
    marketId: string;
    outcome: 'YES' | 'NO';
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    strategy?: string;
    isExit?: boolean;
    holdDurationMin?: number;
  }): Promise<FillResult> {

    // ════════════════════════════════════════════════════════════
    // LIE #5: Gas Fee Deduction — Every order costs gas, even paper
    // ════════════════════════════════════════════════════════════
    const gasFee = this.incubation.gasFeePerOrderUsd;
    this.totalGasFees += gasFee;

    // ════════════════════════════════════════════════════════════
    // LIE #7: Arbitrage Race Simulator
    // If this is an arbitrage strategy, simulate losing the speed
    // race to faster bots. 70% of arb opportunities are taken by
    // someone else before your order arrives.
    // ════════════════════════════════════════════════════════════
    const isArbitrage = request.strategy?.includes('arbitrage') ||
                        request.strategy?.includes('cross_market');
    if (isArbitrage && Math.random() < this.incubation.arbRaceRejectionRate) {
      const reason = 'ARB_RACE_LOST: A faster bot captured this opportunity before you';
      consoleLog.info('FILL', `[INCUBATION] ${reason} — ${request.marketId}`, {
        marketId: request.marketId, strategy: request.strategy,
      });
      return this.buildRejection(request, gasFee, reason);
    }

    // ════════════════════════════════════════════════════════════
    // LIE #1: Probabilistic Fill Rejection
    // Real fill rate for limit orders is ~35%, not 100%.
    // ════════════════════════════════════════════════════════════
    if (!request.isExit && Math.random() > this.incubation.fillProbability) {
      const reason = 'QUEUE_MISS: Order was not filled — other orders had queue priority';
      consoleLog.info('FILL', `[INCUBATION] ${reason} — ${request.marketId}`, {
        marketId: request.marketId, fillProb: this.incubation.fillProbability,
      });
      return this.buildRejection(request, gasFee, reason);
    }

    // ─── Artificial Latency (Log-Normal Distribution) ───────────
    // A log-normal distribution correctly models long-tail network latency
    // mean 4.5, std 0.4 gives typical value ~90ms, tail up to 300ms
    const latency = Math.max(10, MathStats.randomLogNormal(4.5, 0.4));
    await new Promise((resolve) => setTimeout(resolve, latency));

    let finalPrice = request.price;
    let fallbackUsed = true;
    let actualSize = request.size;
    let fee = 0;
    let feeAsset: 'USDC' | 'SHARES' = request.side === 'BUY' ? 'SHARES' : 'USDC';

    // Attempt VWAP from real L2 book
    if (this.stream && this.clobFetcher) {
      const market = this.stream.getMarket(request.marketId);
      if (market && market.clobTokenIds.length > 0) {
        const tokenId = request.outcome === 'YES' ? market.clobTokenIds[0] : market.clobTokenIds[1];
        if (tokenId) {
          const [book, feeInfo] = await Promise.all([
            this.clobFetcher.fetchOrderBook(tokenId),
            this.clobFetcher.fetchFeeRate(tokenId),
          ]);

          if (book) {
            fallbackUsed = false;
            const levels = request.side === 'BUY' ? book.asks : book.bids;

            // ════════════════════════════════════════════════════
            // LIE #2: Queue Depth Penalty
            // Skip the first N levels to simulate orders ahead
            // of you in the queue that already consumed them.
            // Modeled as a Poisson arrival process.
            // ════════════════════════════════════════════════════
            const skipLevels = Math.min(
              levels.length - 1,
              MathStats.poissonRandom(this.incubation.queueDepthPenaltyLevels)
            );
            const adjustedLevels = levels.slice(Math.max(0, skipLevels));

            // ════════════════════════════════════════════════════
            // LIE #6: Liquidity Decay on Hold (for exit orders)
            // For positions held > 30 min, reduce available
            // liquidity to simulate book thinning.
            // ════════════════════════════════════════════════════
            let effectiveLevels = adjustedLevels;
            if (request.isExit && request.holdDurationMin && request.holdDurationMin > 30) {
              const hoursHeld = (request.holdDurationMin - 30) / 60;
              const decayFactor = Math.max(0.1, 1 - this.incubation.liquidityDecayPctPerHour * hoursHeld);
              effectiveLevels = adjustedLevels.map(level => ({
                ...level,
                size: Math.max(1, Math.floor(level.size * decayFactor)),
              }));
            }

            let executedSize = 0;
            let totalCost = 0;

            for (const level of effectiveLevels) {
              const remainingVal = request.size - executedSize;
              if (remainingVal <= 0) break;
              const fillAmount = Math.min(remainingVal, level.size);
              executedSize += fillAmount;
              totalCost += fillAmount * level.price;
            }

            if (executedSize >= request.size) {
              finalPrice = totalCost / request.size;
            } else if (executedSize > 0) {
              finalPrice = totalCost / executedSize;
              actualSize = executedSize;
              logger.warn({
                marketId: request.marketId,
                requested: request.size,
                filled: executedSize,
              }, 'Partial paper fill due to insufficient L2 liquidity');
            } else {
              logger.error({ marketId: request.marketId }, 'Zero liquidity for paper trade. Failing fill.');
              throw new Error(`Insufficient liquidity to paper trade ${request.size} ${request.outcome}`);
            }

            // ════════════════════════════════════════════════════
            // LIE #3: Book Staleness Decay
            // The book we read is already slightly stale. Apply
            // adverse price movement to simulate book drift.
            // Modeled as a Gaussian random walk (Normal dist).
            // ════════════════════════════════════════════════════
            const stalenessAdverse = this.incubation.bookStalenessDecayBps / 10_000;
            const staleJitter = Math.abs(MathStats.randomNormal(0, stalenessAdverse));
            if (request.side === 'BUY') {
              finalPrice *= (1 + staleJitter);  // pay more
            } else {
              finalPrice *= (1 - staleJitter);  // receive less
            }

            // ════════════════════════════════════════════════════
            // LIE #4: Exit Slippage Multiplier
            // When exiting (stop-loss, take-profit), slippage is
            // 2-3x worse because buyers disappear during crashes.
            // ════════════════════════════════════════════════════
            if (request.isExit) {
              const currentSlippage = Math.abs(finalPrice - request.price);
              const extraSlippage = currentSlippage * (this.incubation.exitSlippageMultiplier - 1);
              if (request.side === 'SELL') {
                finalPrice -= extraSlippage;  // exit price drops further
              } else {
                finalPrice += extraSlippage;  // covering costs more
              }
            }

            // Calculate precise maker/taker execution fee
            if (feeInfo && feeInfo.rate > 0) {
              const p = finalPrice;
              const rawFee = actualSize * feeInfo.rate * Math.pow(p * (1 - p), feeInfo.exponent);
              const minFeeThreshold = 0.0001;
              if (rawFee >= minFeeThreshold) {
                fee = Math.round(rawFee * 10000) / 10000;
              }
            }
          }
        }
      }
    }

    if (fallbackUsed) {
      finalPrice = this.fallbackSlippage.apply(request.price, request.size, request.side);

      // Apply staleness + exit slippage even on fallback
      if (request.isExit) {
        const adverseMove = (this.incubation.exitSlippageMultiplier - 1) * 0.002;
        finalPrice = request.side === 'SELL'
          ? finalPrice * (1 - adverseMove)
          : finalPrice * (1 + adverseMove);
      }
    }

    const fill: FillResult = {
      orderId: `paper-${Date.now()}`,
      marketId: request.marketId,
      outcome: request.outcome,
      side: request.side,
      price: Number(Math.max(0.01, Math.min(0.99, finalPrice)).toFixed(4)),
      size: actualSize,
      fee,
      gasFee,
      feeAsset,
      timestamp: Date.now(),
      rejected: false,
      rejectionReason: null,
    };

    const slippageBps = Math.abs(fill.price - request.price) / Math.max(request.price, 0.01) * 10000;
    const exitTag = request.isExit ? ' [EXIT]' : '';
    consoleLog.info('FILL', `Paper fill: ${fill.side} ${fill.outcome} ×${fill.size} @ $${fill.price} (slip ${slippageBps.toFixed(1)} bps${fallbackUsed ? ' [MATH]' : ' [VWAP]'}${exitTag} gas $${gasFee}) — ${fill.orderId}`, {
      orderId: fill.orderId,
      marketId: fill.marketId,
      outcome: fill.outcome,
      side: fill.side,
      requestedPrice: request.price,
      filledPrice: fill.price,
      size: fill.size,
      slippageBps: Number(slippageBps.toFixed(1)),
      cost: Number((fill.price * fill.size).toFixed(4)),
      gasFee,
      vwap: !fallbackUsed,
      isExit: request.isExit ?? false,
    });

    return fill;
  }

  /** Build a rejected fill result (order was not executed) */
  private buildRejection(
    request: { marketId: string; outcome: 'YES' | 'NO'; side: 'BUY' | 'SELL'; price: number; size: number },
    gasFee: number,
    reason: string,
  ): FillResult {
    return {
      orderId: `paper-rejected-${Date.now()}`,
      marketId: request.marketId,
      outcome: request.outcome,
      side: request.side,
      price: request.price,
      size: 0,
      fee: 0,
      gasFee,
      feeAsset: 'USDC',
      timestamp: Date.now(),
      rejected: true,
      rejectionReason: reason,
    };
  }
}
