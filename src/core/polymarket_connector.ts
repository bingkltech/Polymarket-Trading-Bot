import { ClobClient, SignatureType, AssetType } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import { logger } from '../reporting/logs';

export type ConnectionMode = 'READ_ONLY' | 'LIVE_TRADING';

export interface ConnectionIntegrityStatus {
    mode: ConnectionMode;
    rpcStatus: 'CONNECTED' | 'FAILED' | 'SKIPPED';
    clobAuthStatus: 'AUTHENTICATED' | 'UNAUTHENTICATED';
    balanceUSDC?: number;
    errors: string[];
}

/**
 * PolymarketConnector ensures connection integrity.
 * It strictly separates Read-Only data fetching (which requires no auth or RPC)
 * from Live Trading (which requires valid private keys, API credentials, and RPC).
 */
export class PolymarketConnector {
    private clobClient: ClobClient | null = null;
    private provider: ethers.providers.JsonRpcProvider | null = null;
    private getRpcUrls(): string[] {
        const urls = [];
        // Prioritize Alchemy if the API key is provided in .env
        const apiKey = process.env.Alchemy_Api || process.env.alchemy_api || process.env.ALCHEMY_API;
        if (apiKey) {
            urls.push(`https://polygon-mainnet.g.alchemy.com/v2/${apiKey.replace(/"/g, '').trim()}`);
        }
        
        urls.push(
            'https://1rpc.io/matic',
            'https://polygon-rpc.com',
            'https://rpc.ankr.com/polygon',
            'https://polygon-mainnet.public.blastapi.io'
        );
        return urls;
    }

    private readonly usdcE_Address = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Polymarket uses Native USDC

    /**
     * Initializes the connection with full integrity checks.
     */
    async connect(forceLive: boolean = false): Promise<ConnectionIntegrityStatus> {
        const status: ConnectionIntegrityStatus = {
            mode: 'READ_ONLY',
            rpcStatus: 'SKIPPED',
            clobAuthStatus: 'UNAUTHENTICATED',
            errors: []
        };

        const apiKey = process.env.POLYMARKET_API_KEY;
        const secret = process.env.POLYMARKET_SECRET;
        const passphrase = process.env.POLYMARKET_PASSPHRASE;
        const pk = process.env.Wallet_Private_Key || process.env.POLYGON_PRIVATE_KEY;
        const proxyAddress = process.env.Polymarket_wallet_Address || process.env.Signer_Address || process.env.POLYMARKET_PROXY_ADDRESS;

        // 1. Determine Intent
        const canTrade = apiKey && secret && passphrase && pk && proxyAddress;
        
        if (!canTrade && forceLive) {
            status.errors.push('Live trading forced but credentials missing in .env');
            return status;
        }

        if (!canTrade) {
            logger.info('Running in READ-ONLY mode. Missing LIVE credentials in .env.');
            // Initialize unauthenticated client for data fetching only
            this.clobClient = new ClobClient('https://clob.polymarket.com', 137);
            return status;
        }

        // 2. Establish RPC with failover (Integrity Check)
        logger.info('Attempting to connect to Polygon RPC for Live Trading...');
        for (const url of this.getRpcUrls()) {
            try {
                const tempProvider = new ethers.providers.StaticJsonRpcProvider(url, 137);
                await tempProvider.getNetwork();
                this.provider = tempProvider;
                status.rpcStatus = 'CONNECTED';
                logger.info(`RPC Connected successfully to: ${url}`);
                break;
            } catch (err) {
                logger.warn(`RPC Failed for ${url}`);
            }
        }

        if (status.rpcStatus !== 'CONNECTED') {
            status.rpcStatus = 'FAILED';
            status.errors.push('All Polygon RPC connections failed. Ensure network outbound is permitted or provide a premium API key.');
            logger.error('Falling back to READ-ONLY mode due to RPC failure.');
            this.clobClient = new ClobClient('https://clob.polymarket.com', 137);
            return status;
        }

        // 3. Authenticate with ClobClient
        try {
            const wallet = new ethers.Wallet(pk!, this.provider!);
            let activeCreds = (apiKey && secret && passphrase) 
                ? { key: apiKey, secret: secret, passphrase: passphrase } 
                : undefined;

            let authed = false;
            // Test user-provided creds if present
            if (activeCreds) {
                try {
                    const testClient = new ClobClient(
                        'https://clob.polymarket.com',
                        137,
                        wallet as any,
                        activeCreds,
                        0,
                        proxyAddress!
                    );
                    await testClient.getOpenOrders();
                    this.clobClient = testClient;
                    authed = true;
                } catch {
                    logger.warn('Supplied Polymarket API credentials invalid; deriving active credentials dynamically from wallet...');
                }
            }

            if (!authed) {
                // Dynamically derive or create valid API credentials
                const initClient = new ClobClient(
                    'https://clob.polymarket.com',
                    137,
                    wallet as any,
                    undefined,
                    0,
                    proxyAddress!
                );
                let derivedCreds = await initClient.deriveApiKey();
                if (!derivedCreds || !derivedCreds.key) {
                    derivedCreds = await initClient.createApiKey();
                }

                this.clobClient = new ClobClient(
                    'https://clob.polymarket.com',
                    137,
                    wallet as any,
                    derivedCreds,
                    0,
                    proxyAddress!
                );
                await this.clobClient.getOpenOrders();
                authed = true;
                logger.info('Successfully authenticated with dynamically derived Polymarket API credentials.');
            }
            
            status.clobAuthStatus = 'AUTHENTICATED';
            status.mode = 'LIVE_TRADING';
            logger.info('Polymarket API credentials verified and live trading client established.');
        } catch (err: any) {
            status.errors.push(`CLOB Auth Failed: ${err.message}`);
            logger.error({ err }, 'Failed to initialize ClobClient for Live Trading.');
            this.clobClient = new ClobClient('https://clob.polymarket.com', 137);
            status.mode = 'READ_ONLY';
            return status;
        }

        // 4. Verify Balance (Final Integrity Gate)
        logger.info(`Fetching balances on-chain...`);
        try {
            const abi = ['function balanceOf(address owner) view returns (uint256)'];
                
                // Native USDC
                const nativeUsdcContract = new ethers.Contract('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', abi, this.provider!);
                const nativeBal = await nativeUsdcContract.balanceOf(proxyAddress!);
                const nativeFormatted = parseFloat(ethers.utils.formatUnits(nativeBal, 6));

                // Bridged USDC.e
                const bridgedUsdcContract = new ethers.Contract('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', abi, this.provider!);
                const bridgedBal = await bridgedUsdcContract.balanceOf(proxyAddress!);
                const bridgedFormatted = parseFloat(ethers.utils.formatUnits(bridgedBal, 6));

                // pUSD (Polymarket USD)
                const pusdContract = new ethers.Contract('0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb', abi, this.provider!);
                const pusdBal = await pusdContract.balanceOf(proxyAddress!);
                const pusdFormatted = parseFloat(ethers.utils.formatUnits(pusdBal, 6));

                status.balanceUSDC = nativeFormatted + bridgedFormatted + pusdFormatted;
                logger.info(`Verified Live On-Chain Balances -> Native USDC: $${nativeFormatted} | Bridged USDC.e: $${bridgedFormatted} | pUSD: $${pusdFormatted}`);
        } catch (balErr: any) {
            status.errors.push(`Balance check failed entirely: ${balErr.message}`);
            logger.warn(`Could not verify on-chain balance: ${balErr.message}`);
        }
        
        if (status.balanceUSDC === 0) {
            logger.warn('WARNING: Your wallet has 0 USDC available for trading. Trades will fail until funded.');
        }

        return status;
    }

    getClient(): ClobClient | null {
        return this.clobClient;
    }
}
