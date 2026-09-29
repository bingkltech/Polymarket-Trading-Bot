import { WalletConfig, WalletState, TradeRecord } from '../types';
import { logger } from '../reporting/logs';
import { OrderbookStream } from '../data/orderbook_stream';
import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';

export class PolymarketWallet {
  private state: WalletState;
  private readonly trades: TradeRecord[] = [];
  private clobClient: ClobClient | null = null;
  private readonly stream?: OrderbookStream;

  constructor(
    config: WalletConfig,
    assignedStrategy: string,
    stream?: OrderbookStream
  ) {
    this.stream = stream;
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

  private initClient() {
    const apiKey = process.env.POLYMARKET_API_KEY;
    const secret = process.env.POLYMARKET_SECRET;
    const passphrase = process.env.POLYMARKET_PASSPHRASE;
    const pk = process.env.POLYGON_PRIVATE_KEY;

    if (!apiKey || !secret || !passphrase || !pk) {
      logger.warn('Live API keys or Private Key missing. ClobClient will not initialize.');
      return;
    }

    try {
      const provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
      const wallet = new ethers.Wallet(pk, provider);
      const creds = { key: apiKey, secret, passphrase };

      this.clobClient = new ClobClient(
        'https://clob.polymarket.com',
        137,
        wallet,
        creds
      );
      logger.info('Live Polymarket ClobClient initialized successfully.');
    } catch (err) {
      logger.error({ err }, 'Failed to initialize ClobClient');
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

  async placeOrder(request: {
    marketId: string;
    outcome: 'YES' | 'NO';
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
  }): Promise<void> {
    if (!this.clobClient) {
      logger.warn('ClobClient not initialized. Cannot place LIVE order.');
      return;
    }

    if (!this.stream) {
      logger.warn('OrderbookStream not available to resolve Token IDs.');
      return;
    }

    const market = this.stream.getMarket(request.marketId);
    if (!market || market.clobTokenIds.length === 0) {
      logger.error('Market or Token ID not found in stream. Refusing order.');
      return;
    }

    const tokenId = request.outcome === 'YES' ? market.clobTokenIds[0] : market.clobTokenIds[1];
    
    logger.info(
      { walletId: this.state.walletId, marketId: request.marketId, tokenId, price: request.price, size: request.size },
      `Constructing LIVE order for ${request.side} ${request.outcome}`
    );

    try {
      // NOTE: Actual order creation requires tickSize rounding and fmp verification
      // This is the core SDK integration logic:
      const order = await this.clobClient.createOrder({
        tokenID: tokenId,
        price: request.price,
        side: request.side,
        size: request.size,
        feeRateBps: 0 // Polymarket dynamic fee takes care of this on match
      });

      const response = await this.clobClient.postOrder(order);
      logger.info({ response }, 'LIVE order posted successfully!');
    } catch (err) {
      logger.error({ err }, 'Error posting LIVE order');
    }
  }
}
