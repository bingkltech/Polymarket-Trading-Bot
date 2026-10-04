import { MarketData, Signal, OrderRequest } from '../types';
import { logger } from '../reporting/logs';
import { consoleLog } from '../reporting/console_log';
import { MarketPenaltyBox } from '../learning/penalty_box';
import * as fs from 'fs';
import * as path from 'path';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Quant Council Types & State Schema
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export interface QuantEvaluation {
  expectedValue: number;      // e.g. +0.125 / share (+16.4%)
  impliedApy: number;         // Annualized APY percentage (e.g. +420%)
  goldenBandValid: boolean;   // true if 0.68 <= price <= 0.84
  orderbookImbalance: number; // e.g. +0.14
  spreadBps: number;          // e.g. 80 bps
  setupQualityScore: number;  // 0.0 to 1.0
  recommendedPrice: number;   // formatted 2-decimal entry price
  targetHarvestPrice: number; // e.g. 0.97
  stopLossPrice: number;      // e.g. 0.65
  confidence: number;         // 0.0 to 1.0
  summary: string;
}

export interface RedTeamAudit {
  passed: boolean;
  steamrollerRisk: boolean;    // true if price >= 0.85 (toxic zone)
  oracleRisk: boolean;         // true if question is ambiguous/subjective
  categoryRisk: boolean;       // true if minor esports, ITF tennis, etc.
  liquidityTrapRisk: boolean;  // true if depth < 500 or spread > 150 bps
  horizonRisk: boolean;        // true if daysLeft > 3 days (72h)
  flags: string[];
  critique: string;
}

export interface CouncilConsensus {
  verdict: 'APPROVED' | 'VETOED' | 'STANDBY';
  overallScore: number;       // 0 to 100
  approvedPrice: number;
  approvedSize: number;       // standard 5 shares
  vetoReasons: string[];
  rationale: string;
  timestamp: number;
}

export interface CouncilDeliberationRecord {
  id: string;
  marketId: string;
  question: string;
  category: string;
  price: number;
  quantValuation: QuantEvaluation;
  redTeamAudit: RedTeamAudit;
  consensus: CouncilConsensus;
  timestamp: number;
}

export interface CouncilStats {
  totalEvaluated: number;
  totalApproved: number;
  totalVetoed: number;
  steamrollerVetoes: number;
  oracleVetoes: number;
  categoryVetoes: number;
  avgSetupScore: number;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Quant Council Engine (LangGraph Multi-Agent Architecture)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export class QuantCouncilEngine {
  private static instance: QuantCouncilEngine;
  private readonly maxHistory = 50;
  private readonly deliberations: CouncilDeliberationRecord[] = [];
  private readonly historyFilePath = '.runtime/quant_council_history.json';
  private stats: CouncilStats = {
    totalEvaluated: 0,
    totalApproved: 0,
    totalVetoed: 0,
    steamrollerVetoes: 0,
    oracleVetoes: 0,
    categoryVetoes: 0,
    avgSetupScore: 0,
  };

  private constructor() {
    this.loadHistory();
  }

  public static getInstance(): QuantCouncilEngine {
    if (!QuantCouncilEngine.instance) {
      QuantCouncilEngine.instance = new QuantCouncilEngine();
    }
    return QuantCouncilEngine.instance;
  }

  /* ─── 1. Stage 1: Quantitative Lead Evaluation (TradingAgent Brain) ─── */
  public evaluateQuantLead(m: MarketData): QuantEvaluation {
    const impliedProb = m.midPrice;
    const leadingProb = Math.max(impliedProb, 1 - impliedProb);
    const goldenBandValid = leadingProb >= 0.68 && leadingProb <= 0.84;

    // Days to resolution
    let daysLeft = 3.0;
    if (m.endDate) {
      daysLeft = Math.max(0.05, (new Date(m.endDate).getTime() - Date.now()) / 86_400_000);
    }

    // Expected Value & Implied Return
    const impliedReturn = (1.00 - leadingProb) / Math.max(0.01, leadingProb);
    const impliedApy = impliedReturn * (365 / daysLeft) * 100;
    
    // Empirical win probability model for favorites in 68-84% band
    const modelWinProb = Math.min(0.92, leadingProb + 0.05);
    const expectedValue = (modelWinProb * (1.00 - leadingProb)) - ((1 - modelWinProb) * leadingProb);

    // Spread in bps
    const spreadBps = (m.spread / Math.max(0.001, m.midPrice)) * 10_000;

    // Orderbook Imbalance
    const bidDepth = m.bid * m.liquidity;
    const askDepth = (1 - m.ask) * m.liquidity;
    const totalDepth = bidDepth + askDepth;
    const orderbookImbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;

    // Setup Quality Composite Score (0.0 to 1.0)
    const bandScore = goldenBandValid ? 1.0 : Math.max(0, 1 - Math.abs(leadingProb - 0.76) * 3);
    const spreadScore = Math.max(0, 1 - spreadBps / 150);
    const depthScore = Math.min(1, m.liquidity / 10_000);
    const imbalanceScore = Math.max(0, Math.min(1, (orderbookImbalance + 0.2) / 0.7));
    const apyScore = Math.min(1, impliedApy / 200);

    const setupQualityScore = Number((
      0.30 * bandScore +
      0.20 * spreadScore +
      0.20 * apyScore +
      0.15 * depthScore +
      0.15 * imbalanceScore
    ).toFixed(4));

    const recommendedPrice = Number((Math.round(leadingProb * 100) / 100).toFixed(2));
    const targetHarvestPrice = 0.97;
    const stopLossPrice = Number((recommendedPrice - 0.08).toFixed(2));

    const summary = goldenBandValid
      ? `Golden Band Valid (P=${(leadingProb * 100).toFixed(1)}%). EV=+${(expectedValue * 100).toFixed(1)}c/share, Implied APY=${impliedApy.toFixed(0)}%.`
      : `Outside Golden Band (P=${(leadingProb * 100).toFixed(1)}%). Expected return suboptimal.`;

    return {
      expectedValue: Number(expectedValue.toFixed(4)),
      impliedApy: Number(impliedApy.toFixed(1)),
      goldenBandValid,
      spreadBps: Number(spreadBps.toFixed(0)),
      orderbookImbalance: Number(orderbookImbalance.toFixed(4)),
      setupQualityScore,
      recommendedPrice,
      targetHarvestPrice,
      stopLossPrice,
      confidence: setupQualityScore,
      summary,
    };
  }

  /* ─── 2. Stage 2: Adversarial Red Team Audit (Devil's Advocate) ─── */
  public evaluateRedTeam(m: MarketData, quant: QuantEvaluation): RedTeamAudit {
    const flags: string[] = [];
    const q = (m.question || '').toLowerCase();
    const s = (m.slug || '').toLowerCase();

    // 1. Anti-Steamroller Risk Guard (Price >= $0.85)
    const steamrollerRisk = quant.recommendedPrice >= 0.85 || m.midPrice >= 0.85;
    if (steamrollerRisk) {
      flags.push('CRITICAL: Steamroller toxic risk (price >= $0.85). Negative payoff asymmetry.');
    }

    // 2. Horizon Risk (T > 72 hours / 3 days)
    let horizonRisk = false;
    if (!m.endDate) {
      horizonRisk = true;
      flags.push('HIGH: Missing end date / indeterminate horizon.');
    } else {
      const daysLeft = (new Date(m.endDate).getTime() - Date.now()) / 86_400_000;
      if (daysLeft > 3.0) {
        horizonRisk = true;
        flags.push(`HIGH: Horizon exceeds 72 hours (${daysLeft.toFixed(1)} days left). Capital lockup.`);
      }
      if (daysLeft <= 0) {
        horizonRisk = true;
        flags.push('HIGH: Market already past resolution timestamp.');
      }
    }

    // 3. Category & Subjective Ambiguity Risk
    const isEsports = q.includes('lol:') || q.includes('dota') || q.includes('esport') || q.includes('map handicap') || s.includes('lol') || s.includes('esports');
    const isMinorTennis = q.includes('w15') || q.includes('w25') || q.includes('w35') || q.includes('m15') || q.includes('m25') || q.includes('itf') || s.includes('itf');
    const isLongPolitics = q.includes('presidential election') || q.includes('mayoral') || q.includes('prime minister') || q.includes('2026') || q.includes('2027') || q.includes('2028');
    const isHighFeeCrypto = q.includes('15m') || q.includes('15 min') || q.includes('1 hour') || q.includes('up or down') || s.includes('updown') || s.includes('15m');
    const categoryRisk = isEsports || isMinorTennis || isLongPolitics || isHighFeeCrypto;
    if (categoryRisk) {
      flags.push('HIGH: Blacklisted category (minor esports, low-tier tennis, multi-year politics, or dynamic crypto).');
    }

    // 4. Oracle Resolution & Ambiguity Check
    const isSubjective = q.includes('will twitter') || q.includes('rumor') || q.includes('called by') || q.includes('sentiment');
    const oracleRisk = isSubjective || MarketPenaltyBox.getInstance().isPenalized(m.marketId).penalized;
    if (oracleRisk) {
      flags.push('HIGH: Oracle dispute risk or quarantined in penalty box.');
    }

    // 5. Liquidity Trap Risk
    const liquidityTrapRisk = m.liquidity < 3000 || quant.spreadBps > 150;
    if (liquidityTrapRisk) {
      flags.push(`MEDIUM: Illiquid orderbook or wide spread (${quant.spreadBps} bps). Taker slippage.`);
    }

    const passed = !steamrollerRisk && !horizonRisk && !categoryRisk && !oracleRisk && !liquidityTrapRisk;
    const critique = passed
      ? 'Red Team Audit: Clean market profile. No critical structural or oracle risks detected.'
      : `Red Team Audit VETO: ${flags.join(' | ')}`;

    return {
      passed,
      steamrollerRisk,
      oracleRisk,
      categoryRisk,
      liquidityTrapRisk,
      horizonRisk,
      flags,
      critique,
    };
  }

  /* ─── 3. Stage 3: Council Deliberation & Consensus Arbiter ─── */
  public deliberate(m: MarketData): CouncilDeliberationRecord {
    const quant = this.evaluateQuantLead(m);
    const redTeam = this.evaluateRedTeam(m, quant);

    let verdict: 'APPROVED' | 'VETOED' | 'STANDBY' = 'STANDBY';
    const vetoReasons: string[] = [];

    if (!redTeam.passed) {
      verdict = 'VETOED';
      vetoReasons.push(...redTeam.flags);
    } else if (quant.setupQualityScore >= 0.65 && quant.goldenBandValid) {
      verdict = 'APPROVED';
    } else {
      verdict = 'STANDBY';
      vetoReasons.push('Setup quality score below 0.65 threshold or marginal edge.');
    }

    const overallScore = Math.round(
      (verdict === 'APPROVED' ? 80 + quant.setupQualityScore * 20 : quant.setupQualityScore * 50)
    );

    const rationale = verdict === 'APPROVED'
      ? `APPROVED by Quant Council: Golden Band entry @ $${quant.recommendedPrice.toFixed(2)} with Implied APY ${quant.impliedApy.toFixed(0)}%, EV +${(quant.expectedValue * 100).toFixed(1)}c. Red Team cleared.`
      : `VETOED by Quant Council: ${vetoReasons.join('; ')}`;

    const consensus: CouncilConsensus = {
      verdict,
      overallScore,
      approvedPrice: quant.recommendedPrice,
      approvedSize: 5, // Minimum CLOB lot size
      vetoReasons,
      rationale,
      timestamp: Date.now(),
    };

    const record: CouncilDeliberationRecord = {
      id: `council-${Date.now()}-${m.marketId.slice(0, 8)}`,
      marketId: m.marketId,
      question: m.question || m.slug || m.marketId,
      category: m.eventSlug || m.seriesSlug || 'general',
      price: m.midPrice,
      quantValuation: quant,
      redTeamAudit: redTeam,
      consensus,
      timestamp: Date.now(),
    };

    // Update internal stats
    this.updateStats(record);

    // Push to rolling history
    this.deliberations.unshift(record);
    if (this.deliberations.length > this.maxHistory) {
      this.deliberations.pop();
    }

    // Persist to disk periodically
    this.saveHistory();

    if (verdict === 'APPROVED') {
      logger.info({ record }, 'QUANT COUNCIL: Approved Market Setup');
      consoleLog.success('COUNCIL', `[APPROVED] ${record.question.slice(0, 45)}… @ $${quant.recommendedPrice.toFixed(2)} (Score ${overallScore}/100)`);
    } else {
      logger.debug({ record }, 'QUANT COUNCIL: Vetoed Market Setup');
    }

    return record;
  }

  /* ─── 4. Public API & Telemetry Access ─── */
  public getRecentDeliberations(): readonly CouncilDeliberationRecord[] {
    return this.deliberations;
  }

  public getStats(): CouncilStats {
    return { ...this.stats };
  }

  private updateStats(record: CouncilDeliberationRecord) {
    this.stats.totalEvaluated++;
    if (record.consensus.verdict === 'APPROVED') {
      this.stats.totalApproved++;
    } else {
      this.stats.totalVetoed++;
      if (record.redTeamAudit.steamrollerRisk) this.stats.steamrollerVetoes++;
      if (record.redTeamAudit.oracleRisk) this.stats.oracleVetoes++;
      if (record.redTeamAudit.categoryRisk) this.stats.categoryVetoes++;
    }
    const currentTotal = this.stats.totalEvaluated;
    this.stats.avgSetupScore = Number(
      ((this.stats.avgSetupScore * (currentTotal - 1) + record.quantValuation.setupQualityScore) / currentTotal).toFixed(3)
    );
  }

  private loadHistory() {
    try {
      if (fs.existsSync(this.historyFilePath)) {
        const raw = fs.readFileSync(this.historyFilePath, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.deliberations)) {
          this.deliberations.push(...data.deliberations.slice(0, this.maxHistory));
        }
        if (data.stats) {
          this.stats = { ...this.stats, ...data.stats };
        }
      }
    } catch (e) {}
  }

  private saveHistory() {
    try {
      fs.mkdirSync(path.dirname(this.historyFilePath), { recursive: true });
      fs.writeFileSync(
        this.historyFilePath,
        JSON.stringify(
          {
            deliberations: this.deliberations.slice(0, 30),
            stats: this.stats,
            lastUpdated: new Date().toISOString(),
          },
          null,
          2
        )
      );
    } catch (e) {}
  }
}
