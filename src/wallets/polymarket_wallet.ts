import { WalletConfig, WalletState, TradeRecord, Position, OpenOrder, GroundTruthResult } from '../types';
import { logger } from '../reporting/logs';
import { consoleLog } from '../reporting/console_log';
import { OrderbookStream } from '../data/orderbook_stream';
import { ClobClient, SignatureTypeV2, AssetType } from '@polymarket/clob-client-v2';
import { PolymarketConnector, ConnectionIntegrityStatus } from '../core/polymarket_connector';
import { MarketPenaltyBox } from '../learning/penalty_box';
import { analyzeLoss } from '../learning/loss_analysis';

export class PolymarketWallet {
  private state: WalletState;
  private readonly trades: TradeRecord[] = [];
  private openOrders: OpenOrder[] = [];
  private clobClient: ClobClient | null = null;
  private stream?: OrderbookStream;
  private connector: PolymarketConnector;
  public connectionStatus?: ConnectionIntegrityStatus;
  private tokenCache = new Map<string, string[]>();
  private initPromise: Promise<void>;

  constructor(
    private readonly config: WalletConfig,
    assignedStrategy: string,
    stream?: OrderbookStream
  ) {
    this.stream = stream;
    this.connector = new PolymarketConnector();
    this.state = {
      walletId: config.id,
      mode: 'LIVE',
      assignedStrategy,
      capitalAllocated: config.capital,
      availableBalance: config.capital,
      openPositions: [],
      realizedPnl: 0,
      riskLimits: {
        maxPositionSize: config.riskLimits?.maxPositionSize ?? 100,
        maxExposurePerMarket: config.riskLimits?.maxExposurePerMarket ?? 200,
        maxDailyLoss: config.riskLimits?.maxDailyLoss ?? 100,
        maxOpenTrades: config.riskLimits?.maxOpenTrades ?? 5,
        maxDrawdown: config.riskLimits?.maxDrawdown ?? 0.2,
      },
    };

    this.initPromise = this.initClient();
  }

  async ready(): Promise<void> {
    await this.initPromise;
  }

  setDependencies(stream: OrderbookStream): void {
    this.stream = stream;
    logger.info({ walletId: this.state.walletId }, 'PolymarketWallet OrderbookStream injected');
  }

  private async initClient() {
    try {
      this.connectionStatus = await this.connector.connect(true);
      this.clobClient = this.connector.getClient();

      if (this.connectionStatus.mode === 'LIVE_TRADING') {
        logger.info('Live Polymarket ClobClient initialized successfully via Connector.');
        
        if (this.connectionStatus.balanceUSDC !== undefined) {
          // Respect the user-budgeted capital allocation, bounded by true on-chain cash
          const onChain = this.connectionStatus.balanceUSDC;
          this.state.capitalAllocated = this.config.capital;
          this.state.availableBalance = Math.min(this.config.capital, onChain);
          logger.info(`Live wallet capital set to $${this.state.capitalAllocated} (Available on-chain: $${onChain})`);
        }

        // Reconcile real on-chain state from Polymarket on startup
        await Promise.allSettled([
          this.syncLivePositions(),
          this.syncLiveOpenOrders(),
          this.syncLiveTradeHistory(),
        ]);
      } else {
        logger.warn('Connector fell back to READ-ONLY mode. Live trading is disabled.');
        this.state.mode = 'PAPER';
      }
    } catch (err) {
      logger.error({ err }, 'Failed to initialize ClobClient via Connector');
    }
  }

  async syncLivePositions(): Promise<Position[]> {
    if (!this.clobClient || this.connectionStatus?.mode !== 'LIVE_TRADING') {
      return this.state.openPositions;
    }

    const proxyAddress = this.connector.getFunderAddress();
    if (!proxyAddress) {
      return this.state.openPositions;
    }

    try {
      logger.info({ proxyAddress }, 'Fetching live on-chain positions from Polymarket data-api...');
      const res = await fetch(`https://data-api.polymarket.com/positions?user=${proxyAddress.toLowerCase()}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Failed to fetch live positions from data-api');
        return this.state.openPositions;
      }

      const liveData: any[] = await res.json();
      if (!Array.isArray(liveData)) return this.state.openPositions;

      const activePositions: Position[] = [];

      for (const item of liveData) {
        const size = Number(item.size || 0);
        const curPrice = Number(item.curPrice || 0);
        const currentValue = Number(item.currentValue || 0);

        // Strictly track only genuine active un-resolved holdings
        // Discard resolved, expired, redeemable, or zero-valued markets
        if (size <= 0 || item.redeemable === true || (curPrice <= 0 && currentValue <= 0)) {
          continue;
        }

        let marketId: string | null = null;

        // 1. Check Stream cache
        if (this.stream) {
          const allCached = this.stream.getAllMarkets();
          const match = allCached.find((m) =>
            (m.conditionId && item.conditionId && m.conditionId.toLowerCase() === item.conditionId.toLowerCase()) ||
            (m.clobTokenIds && item.asset && m.clobTokenIds.map((t) => t.toLowerCase()).includes(item.asset.toLowerCase())) ||
            (m.slug && item.slug && m.slug.toLowerCase() === item.slug.toLowerCase())
          );
          if (match) {
            marketId = match.marketId;
            if (match.clobTokenIds && match.clobTokenIds.length >= 2) {
              this.tokenCache.set(marketId, match.clobTokenIds);
            }
          }
        }

        // 2. Query Gamma API by slug
        if (!marketId && item.slug) {
          try {
            const gammaRes = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(item.slug)}`, {
              signal: AbortSignal.timeout(4000),
            });
            if (gammaRes.ok) {
              const gammaMarkets: any[] = await gammaRes.json();
              if (Array.isArray(gammaMarkets) && gammaMarkets.length > 0) {
                marketId = String(gammaMarkets[0].id);
                const tokens: string[] = typeof gammaMarkets[0].clobTokenIds === 'string'
                  ? JSON.parse(gammaMarkets[0].clobTokenIds)
                  : (gammaMarkets[0].clobTokenIds ?? []);
                if (marketId && tokens.length >= 2) {
                  this.tokenCache.set(marketId, tokens);
                }
              }
            }
          } catch (e) {
            logger.warn({ slug: item.slug, err: e }, 'Failed to lookup market by slug from Gamma');
          }
        }

        // 3. Fallback
        const finalMarketId: string = marketId || item.conditionId || item.asset || item.slug || 'unknown';

        const outcomeStr = (item.outcome || 'YES').toUpperCase();
        let outcome: 'YES' | 'NO' = 'YES';
        if (item.outcomeIndex === 1 || outcomeStr === 'NO' || outcomeStr === 'UNDER') {
          outcome = 'NO';
        } else if (item.outcomeIndex === 0 || outcomeStr === 'YES' || outcomeStr === 'OVER') {
          outcome = 'YES';
        }

        const avgPrice = Number(item.avgPrice || item.curPrice || 0.5);
        const realizedPnl = Number(item.realizedPnl || 0);

        activePositions.push({
          marketId: finalMarketId,
          outcome,
          size,
          avgPrice,
          realizedPnl,
          title: item.title,
          curPrice: curPrice > 0 ? curPrice : avgPrice,
          currentValue: currentValue > 0 ? currentValue : Number((size * (curPrice > 0 ? curPrice : avgPrice)).toFixed(4)),
        });
      }

      this.state.openPositions = activePositions;
      logger.info({ count: activePositions.length, positions: activePositions }, 'Synchronized live on-chain positions');
      if (activePositions.length > 0) {
        consoleLog.info('WALLET', `Synced ${activePositions.length} live on-chain position(s) from Polymarket`, {
          positions: activePositions.map((p) => `${p.marketId} (${p.outcome} x${p.size} @ $${p.avgPrice.toFixed(2)})`),
        });
      }
      return this.state.openPositions;
    } catch (err) {
      logger.error({ err }, 'Error synchronizing live positions from Polymarket');
      return this.state.openPositions;
    }
  }

  async syncLiveBalance(): Promise<number> {
    if (!this.clobClient || this.connectionStatus?.mode !== 'LIVE_TRADING') {
      return this.state.availableBalance;
    }
    try {
      let onChainBalance: number | undefined;
      const clobBal = await this.clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      if (clobBal && clobBal.balance) {
        onChainBalance = parseFloat(clobBal.balance) / 1e6;
      }
      if (onChainBalance !== undefined) {
        this.state.availableBalance = Math.min(this.config.capital, onChainBalance);
        if (this.connectionStatus) {
          this.connectionStatus.balanceUSDC = onChainBalance;
        }
        logger.info({ walletId: this.state.walletId, onChainBalance, availableBalance: this.state.availableBalance }, 'Synchronized live on-chain balance');
        return onChainBalance;
      }
    } catch (err) {
      logger.error({ err }, 'Error synchronizing live balance from Polymarket');
    }
    return this.state.availableBalance;
  }

  async syncLiveOpenOrders(): Promise<OpenOrder[]> {
    if (!this.clobClient || this.connectionStatus?.mode !== 'LIVE_TRADING') {
      return this.openOrders;
    }
    try {
      logger.info('Fetching live open orders from Polymarket CLOB...');
      const rawOrders = await this.clobClient.getOpenOrders();
      if (!Array.isArray(rawOrders)) {
        this.openOrders = [];
        return this.openOrders;
      }

      const parsed: OpenOrder[] = [];
      for (const ord of rawOrders) {
        const orderId = String(ord.id || (ord as any).orderID || (ord as any).order_id || '');
        const assetId = String(ord.asset_id || (ord as any).token_id || (ord as any).tokenId || '');
        const marketId = String(ord.market || (ord as any).market_id || assetId);
        const side = (String(ord.side || 'BUY').toUpperCase()) as 'BUY' | 'SELL';
        const price = Number(ord.price || 0);
        const originalSize = Number(ord.original_size || (ord as any).size || (ord as any).originalSize || 0);
        const sizeMatched = Number(ord.size_matched || (ord as any).sizeMatched || 0);
        const sizeRemaining = Math.max(0, originalSize - sizeMatched);
        const status = String(ord.status || 'OPEN');
        
        const rawTs = (ord as any).created_at || (ord as any).timestamp;
        const timestamp = typeof rawTs === 'number'
          ? (rawTs > 1e11 ? rawTs : rawTs * 1000)
          : (rawTs ? new Date(rawTs).getTime() : Date.now());

        let outcome: 'YES' | 'NO' = 'YES';
        if ((ord as any).outcome) {
          const ordOutcomeStr = String((ord as any).outcome).toUpperCase();
          outcome = (ordOutcomeStr === 'NO' || ordOutcomeStr === 'UNDER') ? 'NO' : 'YES';
        } else if (this.stream) {
          const market = this.stream.getMarket(marketId);
          if (market && market.clobTokenIds && market.clobTokenIds.length >= 2) {
            if (market.clobTokenIds[1].toLowerCase() === assetId.toLowerCase()) {
              outcome = 'NO';
            }
          }
        }

        parsed.push({
          id: orderId,
          marketId,
          tokenId: assetId,
          side,
          outcome,
          price,
          originalSize,
          sizeMatched,
          sizeRemaining,
          status,
          timestamp,
        });
      }

      this.openOrders = parsed;
      logger.info({ count: parsed.length }, 'Synchronized live open orders from CLOB');
      if (parsed.length > 0) {
        consoleLog.info('ORDER', `Synced ${parsed.length} open resting order(s) from Polymarket CLOB`, {
          orders: parsed.map(o => `${o.side} ${o.outcome} x${o.sizeRemaining} @ $${o.price.toFixed(2)} (${o.marketId})`)
        });
      }
      return this.openOrders;
    } catch (err) {
      logger.error({ err }, 'Error synchronizing open orders from Polymarket');
      return this.openOrders;
    }
  }

  async syncLiveTradeHistory(): Promise<TradeRecord[]> {
    if (!this.clobClient || this.connectionStatus?.mode !== 'LIVE_TRADING') {
      return this.trades;
    }

    const proxyAddress = this.connector.getFunderAddress();
    if (!proxyAddress) {
      return this.trades;
    }

    try {
      logger.info({ proxyAddress }, 'Fetching live trade history and closed positions from Polymarket data-api...');
      const [tradesRes, closedRes] = await Promise.allSettled([
        fetch(`https://data-api.polymarket.com/trades?user=${proxyAddress.toLowerCase()}&limit=200`, {
          signal: AbortSignal.timeout(6000),
        }),
        fetch(`https://data-api.polymarket.com/closed-positions?user=${proxyAddress.toLowerCase()}&limit=100`, {
          signal: AbortSignal.timeout(6000),
        }),
      ]);

      const rawClosed: any[] = closedRes.status === 'fulfilled' && closedRes.value.ok ? await closedRes.value.json() : [];
      const rawTrades: any[] = tradesRes.status === 'fulfilled' && tradesRes.value.ok ? await tradesRes.value.json() : [];

      // 1. Ingest closed positions from Polymarket (with exact ground truth realized PnL)
      if (Array.isArray(rawClosed)) {
        for (const item of rawClosed) {
          const conditionId = String(item.conditionId || item.asset || item.market || 'unknown');
          const orderId = `poly_closed_${conditionId}_${item.timestamp || Date.now()}`;
          
          const exists = this.trades.some((t) =>
            t.orderId === orderId ||
            (t.marketId === conditionId && t.realizedPnl === Number(item.realizedPnl || 0) && t.side === 'SELL')
          );

          if (!exists) {
            const rawOutcome = String(item.outcome || 'YES').toUpperCase();
            const outcome = rawOutcome.includes('NO') ? 'NO' : 'YES';
            const avgPrice = Number(item.avgPrice || 0);
            const curPrice = Number(item.curPrice ?? avgPrice);
            const totalBought = Number(item.totalBought || 0);
            const realizedPnl = Number(item.realizedPnl || 0);
            const rawTs = item.timestamp;
            const ts = typeof rawTs === 'number' ? (rawTs > 1e11 ? rawTs : rawTs * 1000) : Date.now();

            this.trades.push({
              orderId,
              walletId: this.state.walletId,
              marketId: conditionId,
              outcome,
              side: 'SELL',
              price: curPrice,
              size: totalBought,
              cost: Number((avgPrice * totalBought).toFixed(4)),
              fee: 0,
              feeAsset: 'USDC',
              realizedPnl,
              cumulativePnl: this.state.realizedPnl,
              balanceAfter: this.state.availableBalance,
              timestamp: ts,
            });
          }
        }
      }

      // 2. Ingest raw execution fills for open trades / audit trail
      if (Array.isArray(rawTrades)) {
        for (const item of rawTrades) {
          const orderId = String(item.id || item.transactionHash || `poly_${item.timestamp || Date.now()}`);
          
          const exists = this.trades.some((t) => 
            t.orderId === orderId || 
            (item.transactionHash && t.orderId === item.transactionHash) ||
            (t.marketId === (item.conditionId || item.asset || item.market) &&
             t.price === Number(item.price || 0) &&
             t.size === Number(item.size || 0) &&
             Math.abs(t.timestamp - (typeof item.timestamp === 'number' ? (item.timestamp > 1e11 ? item.timestamp : item.timestamp * 1000) : 0)) < 3000)
          );

          if (!exists) {
            const side = (String(item.side || 'BUY').toUpperCase()) as 'BUY' | 'SELL';
            const rawOutcome = String(item.outcome || 'YES').toUpperCase();
            const outcome = rawOutcome.includes('NO') ? 'NO' : 'YES';
            const price = Number(item.price || 0);
            const size = Number(item.size || 0);
            const fee = Number(item.fee || 0);
            const realizedPnl = Number(item.realizedPnl || 0);
            const rawTs = item.timestamp;
            const ts = typeof rawTs === 'number' ? (rawTs > 1e11 ? rawTs : rawTs * 1000) : Date.now();

            this.trades.push({
              orderId,
              walletId: this.state.walletId,
              marketId: String(item.conditionId || item.asset || item.market || item.slug || 'unknown'),
              outcome,
              side,
              price,
              size,
              cost: Number((price * size).toFixed(4)),
              fee,
              feeAsset: 'USDC',
              realizedPnl,
              cumulativePnl: this.state.realizedPnl,
              balanceAfter: this.state.availableBalance,
              timestamp: ts,
            });
          }
        }
      }

      this.trades.sort((a, b) => a.timestamp - b.timestamp);
      const MAX_TRADES = 500;
      if (this.trades.length > MAX_TRADES) {
        this.trades.splice(0, this.trades.length - MAX_TRADES);
      }

      logger.info({ totalTrades: this.trades.length }, 'Synchronized live trade history and closed positions from Polymarket');
      return this.trades;
    } catch (err) {
      logger.error({ err }, 'Error synchronizing live trade history from Polymarket');
      return this.trades;
    }
  }

  async syncGroundTruth(): Promise<GroundTruthResult> {
    const [balRes, posRes, ordRes, tradeRes] = await Promise.allSettled([
      this.syncLiveBalance(),
      this.syncLivePositions(),
      this.syncLiveOpenOrders(),
      this.syncLiveTradeHistory(),
    ]);

    const balance = balRes.status === 'fulfilled' ? balRes.value : this.state.availableBalance;
    const positions = posRes.status === 'fulfilled' ? posRes.value : this.state.openPositions;
    const openOrders = ordRes.status === 'fulfilled' ? ordRes.value : this.openOrders;
    const trades = tradeRes.status === 'fulfilled' ? tradeRes.value : this.trades;

    return {
      walletId: this.state.walletId,
      mode: this.state.mode,
      timestamp: Date.now(),
      balanceUSDC: balance,
      capitalAllocated: this.state.capitalAllocated,
      positionsCount: positions.length,
      openOrdersCount: openOrders.length,
      tradesCount: trades.length,
      positions: [...positions],
      openOrders: [...openOrders],
      recentTrades: trades.slice(-20),
    };
  }

  getOpenOrders(): OpenOrder[] {
    return [...this.openOrders];
  }

  getState(): WalletState {
    return {
      ...this.state,
      onChainBalance: this.connectionStatus?.balanceUSDC ?? this.state.availableBalance,
      openPositions: [...this.state.openPositions],
    };
  }

  getTradeHistory(): TradeRecord[] {
    return [...this.trades];
  }

  updateBalance(delta: number): void {
    this.state.availableBalance += delta;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.clobClient || this.connectionStatus?.mode !== 'LIVE_TRADING') {
      const initialLen = this.openOrders.length;
      this.openOrders = this.openOrders.filter((o) => o.id !== orderId);
      return this.openOrders.length < initialLen;
    }
    try {
      logger.info({ orderId, walletId: this.state.walletId }, 'Canceling live order on Polymarket CLOB...');
      await this.clobClient.cancelOrder({ orderID: orderId });
      this.openOrders = this.openOrders.filter((o) => o.id !== orderId);
      consoleLog.warn('ORDER', `Cancelled live CLOB order ${orderId}`);
      return true;
    } catch (err: any) {
      logger.error({ orderId, err: err?.message || err }, 'Failed to cancel live CLOB order');
      return false;
    }
  }

  async cancelAllOrders(): Promise<number> {
    if (!this.clobClient || this.connectionStatus?.mode !== 'LIVE_TRADING') {
      const count = this.openOrders.length;
      this.openOrders = [];
      return count;
    }
    try {
      logger.warn({ walletId: this.state.walletId }, 'Emergency panic: Canceling all live orders on Polymarket CLOB...');
      await this.clobClient.cancelAll();
      const count = this.openOrders.length;
      this.openOrders = [];
      consoleLog.error('ORDER', `Emergency Panic: Cancelled all live open orders (${count}) on Polymarket CLOB`);
      return count;
    } catch (err: any) {
      logger.error({ err: err?.message || err }, 'Failed to cancel all live orders on Polymarket CLOB');
      return 0;
    }
  }

  private async resolveTokenId(marketId: string, outcome: 'YES' | 'NO'): Promise<string | null> {
    if (this.tokenCache.has(marketId)) {
      const tokens = this.tokenCache.get(marketId)!;
      return outcome === 'YES' ? tokens[0] : tokens[1];
    }

    if (this.stream) {
      const market = this.stream.getMarket(marketId);
      if (market && market.clobTokenIds?.length >= 2) {
        if (this.tokenCache.size >= 100) {
          const firstKey = this.tokenCache.keys().next().value;
          if (firstKey) this.tokenCache.delete(firstKey);
        }
        this.tokenCache.set(marketId, market.clobTokenIds);
        return outcome === 'YES' ? market.clobTokenIds[0] : market.clobTokenIds[1];
      }
    }

    // Dynamic Gamma API fallback
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        const tokens: string[] = typeof data.clobTokenIds === 'string' 
          ? JSON.parse(data.clobTokenIds) 
          : (data.clobTokenIds ?? []);
        if (tokens.length >= 2) {
          if (this.tokenCache.size >= 100) {
            const firstKey = this.tokenCache.keys().next().value;
            if (firstKey) this.tokenCache.delete(firstKey);
          }
          this.tokenCache.set(marketId, tokens);
          return outcome === 'YES' ? tokens[0] : tokens[1];
        }
      }
    } catch (e) {
      logger.warn({ marketId, err: e }, 'Failed to resolve token ID from Gamma API');
    }

    return null;
  }

  async placeOrder(request: {
    marketId: string;
    outcome: 'YES' | 'NO';
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
  }): Promise<void> {
    await this.ready();
    if (!this.clobClient || this.connectionStatus?.mode !== 'LIVE_TRADING') {
      logger.warn('ClobClient not initialized for live trading. Cannot place LIVE order.');
      return;
    }

    // Strict Single-Position Per Market Guardrail: NEVER buy if we already have an open position in this market
    if (request.side === 'BUY') {
      const market = this.stream?.getMarket(request.marketId);
      const alreadyHeld = this.state.openPositions.some((p) => {
        if (p.size <= 0) return false;
        if (p.marketId === request.marketId) return true;
        if (market) {
          const target = p.marketId.toLowerCase();
          if (market.marketId && market.marketId.toLowerCase() === target) return true;
          if (market.conditionId && market.conditionId.toLowerCase() === target) return true;
          if (market.slug && market.slug.toLowerCase() === target) return true;
          if (market.clobTokenIds && market.clobTokenIds.some((t) => t.toLowerCase() === target)) return true;
        }
        return false;
      });
      if (alreadyHeld) {
        logger.warn({ marketId: request.marketId }, 'Single-Position Veto: Wallet already holds a position in this market. Aborting BUY.');
        consoleLog.warn('ORDER', `Aborted BUY for market ${request.marketId} — already holding position (Single-Position Rule).`);
        return;
      }
    }

    const tokenId = await this.resolveTokenId(request.marketId, request.outcome);
    if (!tokenId) {
      logger.error({ marketId: request.marketId }, 'Market or Token ID not found. Refusing order.');
      return;
    }

    // Pre-flight Fee Rate Validation
    let feeRateBps = 0;
    try {
      if (typeof (this.clobClient as any).getFeeRateBps === 'function') {
        feeRateBps = await (this.clobClient as any).getFeeRateBps(tokenId);
      }
    } catch {
      feeRateBps = 0;
    }

    // Block BUY in high-fee markets for market making or general strategies
    if (request.side === 'BUY') {
      if (this.state.assignedStrategy === 'market_making' && feeRateBps > 0) {
        logger.warn(
          { walletId: this.state.walletId, marketId: request.marketId, feeRateBps },
          'Fee Veto: Market making strategy strictly requires 0% maker fee markets. Aborting BUY.'
        );
        consoleLog.warn('ORDER', `Aborted BUY for market ${request.marketId} — fee is ${feeRateBps} bps (0% fee required for Market Making).`);
        return;
      }
      if (feeRateBps > 100) {
        logger.warn(
          { walletId: this.state.walletId, marketId: request.marketId, feeRateBps },
          'Fee Veto: Market fee rate is excessive (>100 bps). Aborting BUY.'
        );
        consoleLog.warn('ORDER', `Aborted BUY for market ${request.marketId} — fee is ${feeRateBps} bps (>100 bps threshold).`);
        return;
      }
    }

    // Align price to 2 decimal places to satisfy Polymarket tick size rules
    const roundedPrice = Number((Math.round(request.price * 100) / 100).toFixed(2));
    const safePrice = Math.max(0.01, Math.min(0.99, roundedPrice));
    
    // Enforce strictly 5 shares (Polymarket CLOB minimum allowable order size)
    let size = Math.max(5, Math.floor(request.size));
    if (request.side === 'BUY') {
      size = 5;
      // Ensure we don't exceed available cash
      const maxAffordable = Math.floor(this.state.availableBalance / safePrice);
      if (size > maxAffordable) {
        logger.warn({ availableBalance: this.state.availableBalance, cost: size * safePrice, size }, 'Not enough balance for minimum 5 shares. Skipping.');
        return;
      }
    } else {
      // SELL: Don't sell more than we hold, accounting for active resting sell orders on CLOB
      const existingPos = this.state.openPositions.find(
        (p) => p.marketId === request.marketId && p.outcome === request.outcome
      );
      const heldSize = existingPos ? existingPos.size : size;
      const lockedSellShares = this.openOrders
        .filter((o) => (o.asset_id === tokenId || o.market === request.marketId) && (o.side === 'SELL' || String(o.side).toUpperCase() === 'SELL'))
        .reduce((sum, o) => sum + (parseFloat(o.original_size || o.size || '0') - parseFloat(o.size_matched || '0')), 0);
      
      const availableToSell = Math.max(0, heldSize - lockedSellShares);
      if (availableToSell < 5 && lockedSellShares > 0) {
        logger.info(
          { marketId: request.marketId, heldSize, lockedSellShares },
          'Position already has active resting SELL order on CLOB. Skipping redundant exit order.'
        );
        return;
      }
      size = Math.min(size, availableToSell);
    }

    if (size <= 0) {
      logger.warn({ request }, 'Order size calculated as 0. Aborting order.');
      return;
    }

    logger.info(
      { walletId: this.state.walletId, marketId: request.marketId, tokenId, price: safePrice, size, feeRateBps },
      `Constructing LIVE order for ${request.side} ${request.outcome}`
    );

    try {
      const order = await this.clobClient.createOrder({
        tokenID: tokenId,
        price: safePrice,
        side: request.side as any,
        size: size
      });

      const response: any = await this.clobClient.postOrder(order);
      
      // Strict rejection check: errorMsg, error string, status code >= 400, or success === false
      const hasError = !response || 
        response.success === false || 
        !!response.error || 
        (typeof response.errorMsg === 'string' && response.errorMsg.length > 0) ||
        response.status === 'ERROR' ||
        (typeof response.status === 'number' && response.status >= 400);

      if (hasError) {
        const errorMsg = response?.error || response?.errorMsg || JSON.stringify(response);
        logger.error({ response, errorMsg }, 'LIVE order rejected by Polymarket CLOB');
        consoleLog.error('ORDER', `Live order rejected: ${errorMsg}`);
        return; // DO NOT MUTATE LOCAL POSITIONS OR REALIZED PNL ON REJECTION!
      }

      logger.info({ response }, 'LIVE order posted successfully to Polymarket CLOB!');
      consoleLog.success('ORDER', `LIVE ${request.side} ${request.outcome} x${size} @ $${safePrice.toFixed(2)} placed! (ID: ${response.orderID || 'ok'})`);

      // Exact Fee Calculation
      const feeCost = (feeRateBps > 0) ? Number(((safePrice * size * (feeRateBps / 10000))).toFixed(4)) : 0;

      // Track open positions and net cash balances
      const grossCost = safePrice * size;
      if (request.side === 'BUY') {
        this.state.availableBalance -= (grossCost + feeCost);
      } else {
        this.state.availableBalance += (grossCost - feeCost);
      }

      const existingIndex = this.state.openPositions.findIndex(
        (p) => p.marketId === request.marketId && p.outcome === request.outcome
      );

      let netRealizedRoundTrip = 0;
      if (request.side === 'BUY') {
        if (existingIndex >= 0) {
          const pos = this.state.openPositions[existingIndex];
          const totalSize = pos.size + size;
          pos.avgPrice = ((pos.avgPrice * pos.size) + (safePrice * size)) / totalSize;
          pos.size = totalSize;
          pos.realizedPnl -= feeCost;
          pos.entryFee = (pos.entryFee || 0) + feeCost;
        } else {
          this.state.openPositions.push({
            marketId: request.marketId,
            outcome: request.outcome,
            size,
            avgPrice: safePrice,
            realizedPnl: -feeCost,
            entryFee: feeCost,
          });
        }
        this.state.realizedPnl -= feeCost; // Deduct entry fee from wallet realized PnL
        netRealizedRoundTrip = -feeCost;
      } else {
        // SELL / EXIT
        if (existingIndex >= 0) {
          const pos = this.state.openPositions[existingIndex];
          const soldSize = Math.min(pos.size, size);
          const grossPnl = (safePrice - pos.avgPrice) * soldSize;
          const allocatedEntryFee = (pos.entryFee || 0) * (soldSize / Math.max(pos.size, 1));
          
          // True Net Round-Trip PnL (accounting for BOTH entry fee and exit fee)
          netRealizedRoundTrip = Number((grossPnl - feeCost - allocatedEntryFee).toFixed(4));
          
          pos.realizedPnl += (grossPnl - feeCost);
          this.state.realizedPnl += (grossPnl - feeCost); // Entry fee was already deducted at BUY
          pos.entryFee = Math.max(0, (pos.entryFee || 0) - allocatedEntryFee);
          pos.size -= size;
          if (pos.size <= 0) {
            this.state.openPositions.splice(existingIndex, 1);
          }
        }
      }

      const orderId = response?.orderID || `live_${Date.now()}`;
      this.trades.push({
        orderId,
        walletId: this.state.walletId,
        marketId: request.marketId,
        outcome: request.outcome,
        side: request.side,
        price: safePrice,
        size,
        cost: grossCost,
        fee: feeCost,
        feeAsset: 'USDC',
        realizedPnl: netRealizedRoundTrip,
        cumulativePnl: this.state.realizedPnl,
        balanceAfter: this.state.availableBalance,
        timestamp: Date.now(),
      });

      const MAX_TRADES = 500;
      if (this.trades.length > MAX_TRADES) {
        this.trades.splice(0, this.trades.length - MAX_TRADES);
      }

      if (request.side === 'SELL') {
        const pnlCents = netRealizedRoundTrip * 100;
        let lossTag: any = null;
        if (netRealizedRoundTrip < 0) {
          lossTag = analyzeLoss({
            strategy: this.state.assignedStrategy,
            marketId: request.marketId,
            outcome: request.outcome,
            entryPrice: safePrice,
            exitPrice: safePrice,
            intendedExitPrice: safePrice,
            holdDurationMs: 60_000,
            exitReason: 'SELL_EXIT',
            pnlCents,
          });

          // Quarantine asset in Penalty Box — NEVER re-enter an asset that delivered a loss
          MarketPenaltyBox.getInstance().penalize(
            request.marketId,
            Math.abs(netRealizedRoundTrip),
            `Exit loss of -$${Math.abs(netRealizedRoundTrip).toFixed(2)} [${lossTag}]`
          );
        }
      }

    } catch (err: any) {
      logger.error({ err: err?.message || err }, 'Error posting LIVE order to Polymarket');
      consoleLog.error('ORDER', `Error posting LIVE order: ${err?.message || err}`);
    }
  }
}

