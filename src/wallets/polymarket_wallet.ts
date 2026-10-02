import { WalletConfig, WalletState, TradeRecord, Position } from '../types';
import { logger } from '../reporting/logs';
import { consoleLog } from '../reporting/console_log';
import { OrderbookStream } from '../data/orderbook_stream';
import { ClobClient, SignatureTypeV2 } from '@polymarket/clob-client-v2';
import { PolymarketConnector, ConnectionIntegrityStatus } from '../core/polymarket_connector';
import { TradeMemoryBank } from '../learning/memory_bank';

export class PolymarketWallet {
  private state: WalletState;
  private readonly trades: TradeRecord[] = [];
  private clobClient: ClobClient | null = null;
  private stream?: OrderbookStream;
  private connector: PolymarketConnector;
  public connectionStatus?: ConnectionIntegrityStatus;
  private tokenCache = new Map<string, string[]>();

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

    this.initClient();
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
      } else {
        logger.warn('Connector fell back to READ-ONLY mode. Live trading is disabled.');
        this.state.mode = 'PAPER';
      }
    } catch (err) {
      logger.error({ err }, 'Failed to initialize ClobClient via Connector');
    }
  }

  getState(): WalletState {
    return { ...this.state, openPositions: [...this.state.openPositions] };
  }

  getTradeHistory(): TradeRecord[] {
    return [...this.trades];
  }

  updateBalance(delta: number): void {
    this.state.availableBalance += delta;
  }

  private async resolveTokenId(marketId: string, outcome: 'YES' | 'NO'): Promise<string | null> {
    if (this.tokenCache.has(marketId)) {
      const tokens = this.tokenCache.get(marketId)!;
      return outcome === 'YES' ? tokens[0] : tokens[1];
    }

    if (this.stream) {
      const market = this.stream.getMarket(marketId);
      if (market && market.clobTokenIds?.length >= 2) {
        this.tokenCache.set(marketId, market.clobTokenIds);
        return outcome === 'YES' ? market.clobTokenIds[0] : market.clobTokenIds[1];
      }
    }

    // Dynamic Gamma API fallback
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`);
      if (res.ok) {
        const data = await res.json();
        const tokens: string[] = typeof data.clobTokenIds === 'string' 
          ? JSON.parse(data.clobTokenIds) 
          : (data.clobTokenIds ?? []);
        if (tokens.length >= 2) {
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
    if (!this.clobClient || this.connectionStatus?.mode !== 'LIVE_TRADING') {
      logger.warn('ClobClient not initialized for live trading. Cannot place LIVE order.');
      return;
    }

    const tokenId = await this.resolveTokenId(request.marketId, request.outcome);
    if (!tokenId) {
      logger.error({ marketId: request.marketId }, 'Market or Token ID not found. Refusing order.');
      return;
    }

    // Align price to 2 decimal places to satisfy Polymarket tick size rules
    const roundedPrice = Number((Math.round(request.price * 100) / 100).toFixed(2));
    const safePrice = Math.max(0.01, Math.min(0.99, roundedPrice));
    
    // Enforce strictly 1 to 2 shares max per trade, respecting Polymarket minimum order notional of $1.00
    let size = Math.max(1, Math.floor(request.size));
    if (request.side === 'BUY') {
      const minSharesForDollar = Math.ceil(1.00 / safePrice);
      size = Math.min(2, Math.max(minSharesForDollar, size));
      if (size * safePrice < 1.00) {
        size = Math.min(2, Math.ceil(1.00 / safePrice));
      }
      // Ensure we don't exceed available cash
      const maxAffordable = Math.floor(this.state.availableBalance / safePrice);
      if (size > maxAffordable) {
        size = maxAffordable;
      }
      if (size * safePrice < 1.00) {
        logger.warn({ availableBalance: this.state.availableBalance, cost: size * safePrice, size }, 'Order cannot meet Polymarket $1.00 min notional within 1-2 shares limit. Skipping.');
        return;
      }
    } else {
      // SELL: Don't sell more than we hold
      const existingPos = this.state.openPositions.find(
        (p) => p.marketId === request.marketId && p.outcome === request.outcome
      );
      if (existingPos) {
        size = Math.min(size, existingPos.size);
      }
    }

    if (size <= 0) {
      logger.warn({ request }, 'Order size calculated as 0. Aborting order.');
      return;
    }

    logger.info(
      { walletId: this.state.walletId, marketId: request.marketId, tokenId, price: safePrice, size },
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

      let feeRateBps = 0;
      try {
        if (typeof (this.clobClient as any).getFeeRateBps === 'function') {
          feeRateBps = await (this.clobClient as any).getFeeRateBps(tokenId);
        }
      } catch {
        feeRateBps = 0;
      }

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

      let realizedOnTrade = 0;
      if (request.side === 'BUY') {
        if (existingIndex >= 0) {
          const pos = this.state.openPositions[existingIndex];
          const totalSize = pos.size + size;
          pos.avgPrice = ((pos.avgPrice * pos.size) + (safePrice * size)) / totalSize;
          pos.size = totalSize;
          pos.realizedPnl -= feeCost;
        } else {
          this.state.openPositions.push({
            marketId: request.marketId,
            outcome: request.outcome,
            size,
            avgPrice: safePrice,
            realizedPnl: -feeCost,
          });
        }
        this.state.realizedPnl -= feeCost; // Deduct entry fee from realized PnL
      } else {
        // SELL / EXIT
        if (existingIndex >= 0) {
          const pos = this.state.openPositions[existingIndex];
          const grossPnl = (safePrice - pos.avgPrice) * Math.min(pos.size, size);
          realizedOnTrade = grossPnl - feeCost; // Net Realized PnL after exit fee
          pos.realizedPnl += realizedOnTrade;
          this.state.realizedPnl += realizedOnTrade;
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
        realizedPnl: realizedOnTrade,
        cumulativePnl: this.state.realizedPnl,
        balanceAfter: this.state.availableBalance,
        timestamp: Date.now(),
      });

      const memoryBank = TradeMemoryBank.getInstance();
      memoryBank.logOrder({
        orderId,
        marketId: request.marketId,
        strategy: this.state.assignedStrategy,
        outcome: request.outcome,
        side: request.side,
        price: safePrice,
        size,
        status: 'filled',
        createdAt: new Date().toISOString()
      });
      memoryBank.logFill({
        fillId: `fill_${orderId}`,
        orderId,
        marketId: request.marketId,
        strategy: this.state.assignedStrategy,
        outcome: request.outcome,
        side: request.side,
        intendedPrice: safePrice,
        actualPrice: safePrice,
        size,
        slippageBps: 0,
        latencyMs: 50,
        filledAt: new Date().toISOString()
      });

    } catch (err: any) {
      logger.error({ err: err?.message || err }, 'Error posting LIVE order to Polymarket');
      consoleLog.error('ORDER', `Error posting LIVE order: ${err?.message || err}`);
    }
  }
}

