import { WalletState, TradeRecord } from '../types';

export interface PerformanceSnapshot {
  walletId: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  winRate: number;
  winCount: number;
  lossCount: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeLike: number;
  totalTrades: number;
}

export interface WalletDashboardEntry {
  walletId: string;
  displayName: string;
  mode: 'LIVE' | 'PAPER';
  strategy: string;
  capitalAllocated: number; // Strategy Budget
  availableBalance: number; // Polymarket Cash (Free USDC)
  engagedCapital: number;   // Cash engaged in open positions
  portfolioValue: number;   // Total Portfolio Value (Cash + Positions MTM)
  marketValue?: number;     // Current market value of open positions
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  paused: boolean;
  openPositions: Array<{
    marketId: string;
    outcome: 'YES' | 'NO';
    size: number;
    avgPrice: number;
    realizedPnl: number;
    unrealizedPnl: number;
  }>;
  riskLimits: {
    maxPositionSize: number;
    maxExposurePerMarket: number;
    maxDailyLoss: number;
    maxOpenTrades: number;
    maxDrawdown: number;
  };
  performance: PerformanceSnapshot;
}

export interface DashboardPayload {
  generatedAt: string;
  polymarketCash: number;   // Free liquid USDC on Polymarket
  engagedCapital: number;   // Capital currently in active positions (cost basis)
  activePositionsValue?: number; // Total current mark value of active positions
  totalCostBasis?: number;  // Cost basis of all active positions
  portfolioValue: number;   // Total Portfolio Value (Cash + Current Positions MTM)
  totalBudget: number;      // Configured strategy budget ceiling
  totalCapital: number;     // Legacy alias for totalBudget
  totalBalance: number;     // Legacy alias for polymarketCash
  totalPnl: number;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  netRoiPct?: number;       // Net ROI percentage relative to budget
  activeWallets: number;
  wallets: WalletDashboardEntry[];
}


export function computePerformance(
  wallet: WalletState,
  trades: TradeRecord[],
  unrealizedPnl: number,
  openPositions?: Array<{ unrealizedPnl: number; size: number }>,
): PerformanceSnapshot {
  // Only evaluate closed round trips (SELL trades) or trades with non-zero realized PnL
  const closedTradesList = trades.filter((t) => t.side === 'SELL' || t.realizedPnl !== 0);
  const closedWins = closedTradesList.filter((t) => t.realizedPnl > 0);
  const closedLosses = closedTradesList.filter((t) => t.realizedPnl < 0);
  
  // Count mark-to-market active open positions to prevent showing 100% win rate when open trades are losing
  const openWins = (openPositions ?? []).filter((p) => p.size > 0 && p.unrealizedPnl > 0).length;
  const openLosses = (openPositions ?? []).filter((p) => p.size > 0 && p.unrealizedPnl < 0).length;

  const totalEvaluatedPositions = closedWins.length + closedLosses.length + openWins + openLosses;
  const totalWinningEvaluated = closedWins.length + openWins;
  
  // Mark-to-market comprehensive win rate
  const winRate = totalEvaluatedPositions > 0 
    ? totalWinningEvaluated / totalEvaluatedPositions 
    : (closedTradesList.length > 0 ? closedWins.length / closedTradesList.length : 0);

  const totalWinPnl = closedWins.reduce((s, t) => s + t.realizedPnl, 0);
  const totalLossPnl = closedLosses.reduce((s, t) => s + t.realizedPnl, 0);
  const avgWin = closedWins.length > 0 ? totalWinPnl / closedWins.length : 0;
  const avgLoss = closedLosses.length > 0 ? totalLossPnl / closedLosses.length : 0;
  
  const totalPnl = wallet.realizedPnl + unrealizedPnl;
  
  // Profit factor is undefined/0 if total PnL is negative or no closed losses exist when losing
  const profitFactor =
    closedLosses.length > 0 && totalLossPnl !== 0
      ? Math.abs(totalWinPnl / totalLossPnl)
      : closedWins.length > 0 && totalPnl > 0
        ? Infinity
        : 0;

  // Sharpe-like ratio: PnL / capital
  const sharpeLike = Number(
    (totalPnl / Math.max(1, wallet.capitalAllocated)).toFixed(4),
  );

  return {
    walletId: wallet.walletId,
    realizedPnl: wallet.realizedPnl,
    unrealizedPnl,
    totalPnl,
    winRate: Number(winRate.toFixed(4)),
    winCount: totalWinningEvaluated,
    lossCount: closedLosses.length + openLosses,
    avgWin: Number(avgWin.toFixed(4)),
    avgLoss: Number(avgLoss.toFixed(4)),
    profitFactor: profitFactor === Infinity ? 999 : Number(profitFactor.toFixed(4)),
    sharpeLike,
    totalTrades: closedTradesList.length > 0 ? closedTradesList.length : trades.length,
  };
}

export function buildDashboardPayload(
  wallets: WalletState[],
  tradesByWallet: Map<string, TradeRecord[]>,
  marketPrices?: Map<string, number>,
  pausedWallets?: Set<string>,
  displayNames?: Map<string, string>,
): DashboardPayload {
  const entries: WalletDashboardEntry[] = wallets.map((w) => {
    const trades = tradesByWallet.get(w.walletId) ?? [];

    // Compute unrealized PnL and market values for each open position (skip zero-size)
    let walletUnrealizedPnl = 0;
    let walletCostBasis = 0;
    let walletMarketValue = 0;

    const positions = w.openPositions.filter((p) => p.size > 0).map((p) => {
      // Use live market price if available, otherwise curPrice or avgPrice
      const currentPrice = marketPrices?.get(p.marketId) ?? p.curPrice ?? p.avgPrice;
      const unrealizedPnl =
        p.size > 0 && p.avgPrice > 0
          ? (currentPrice - p.avgPrice) * p.size
          : 0;
      walletUnrealizedPnl += unrealizedPnl;
      walletCostBasis += (p.size * p.avgPrice);
      walletMarketValue += (p.size * currentPrice);

      return {
        marketId: p.marketId,
        outcome: p.outcome,
        size: Number(p.size.toFixed(4)),
        avgPrice: Number(p.avgPrice.toFixed(4)),
        realizedPnl: Number(p.realizedPnl.toFixed(4)),
        unrealizedPnl: Number(unrealizedPnl.toFixed(4)),
      };
    });

    const engagedCapital = Number(walletCostBasis.toFixed(4));
    const marketValue = Number(walletMarketValue.toFixed(4));
    const portfolioValue = Number((w.availableBalance + walletMarketValue).toFixed(4));

    return {
      walletId: w.walletId,
      displayName: displayNames?.get(w.walletId) ?? w.walletId,
      mode: w.mode,
      strategy: w.assignedStrategy,
      capitalAllocated: w.capitalAllocated,
      availableBalance: Number(w.availableBalance.toFixed(4)),
      engagedCapital,
      marketValue,
      portfolioValue,
      realizedPnl: Number(w.realizedPnl.toFixed(4)),
      unrealizedPnl: Number(walletUnrealizedPnl.toFixed(4)),
      totalPnl: Number((w.realizedPnl + walletUnrealizedPnl).toFixed(4)),
      paused: pausedWallets?.has(w.walletId) ?? false,
      openPositions: positions,
      riskLimits: w.riskLimits,
      performance: computePerformance(w, trades, walletUnrealizedPnl, positions),
    };
  });

  const liveEntries = entries.filter(e => e.mode === 'LIVE');
  const totalRealizedPnl = liveEntries.reduce((s, e) => s + e.realizedPnl, 0);
  const totalUnrealizedPnl = liveEntries.reduce((s, e) => s + e.unrealizedPnl, 0);
  
  // When live sub-wallets share the same underlying Polymarket account balance:
  // True Polymarket Free Cash is the maximum onChainBalance (or availableBalance) across live wallets
  const liveOnChainBalances = wallets.filter(w => w.mode === 'LIVE').map(w => w.onChainBalance ?? w.availableBalance);
  const totalCash = liveOnChainBalances.length > 0 
    ? Math.max(...liveOnChainBalances)
    : 0;

  const totalEngaged = Number(liveEntries.reduce((s, e) => s + e.engagedCapital, 0).toFixed(4));
  const totalMarketValue = liveEntries.reduce((s, e) => {
    const posVal = e.openPositions.reduce((ps, p) => ps + (p.size * (p.avgPrice + (p.unrealizedPnl / Math.max(p.size, 1)))), 0);
    return s + posVal;
  }, 0);
  const totalPortfolio = Number((totalCash + totalMarketValue).toFixed(4));
  const totalBudget = liveEntries.reduce((s, e) => s + e.capitalAllocated, 0);
  const totalPnl = Number((totalRealizedPnl + totalUnrealizedPnl).toFixed(4));
  const netRoiPct = totalBudget > 0 ? Number(((totalPnl / totalBudget) * 100).toFixed(2)) : 0;

  return {
    generatedAt: new Date().toISOString(),
    polymarketCash: Number(totalCash.toFixed(4)),
    engagedCapital: totalEngaged,
    activePositionsValue: Number(totalMarketValue.toFixed(4)),
    totalCostBasis: totalEngaged,
    portfolioValue: totalPortfolio,
    totalBudget,
    totalCapital: totalBudget, // Legacy compatibility
    totalBalance: Number(totalCash.toFixed(4)), // Legacy compatibility
    totalPnl,
    totalRealizedPnl: Number(totalRealizedPnl.toFixed(4)),
    totalUnrealizedPnl: Number(totalUnrealizedPnl.toFixed(4)),
    netRoiPct,
    activeWallets: liveEntries.length,
    wallets: liveEntries, // Exclude paper wallets from the dashboard UI
  };
}

