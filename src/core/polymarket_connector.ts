import 'dotenv/config';
import { ClobClient, SignatureTypeV2, AssetType } from '@polymarket/clob-client-v2';
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

        // 1. Determine Intent: pk & proxyAddress are sufficient to derive or use credentials
        const canTrade = Boolean(pk && proxyAddress);
        
        if (!canTrade && forceLive) {
            status.errors.push('Live trading forced but credentials (Wallet_Private_Key or proxyAddress) missing in .env');
            return status;
        }

        if (!canTrade) {
            logger.info('Running in READ-ONLY mode. Missing LIVE credentials in .env.');
            // Initialize unauthenticated client for data fetching only
            this.clobClient = new ClobClient({
                host: 'https://clob.polymarket.com',
                chain: 137
            });
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
            this.clobClient = new ClobClient({
                host: 'https://clob.polymarket.com',
                chain: 137
            });
            return status;
        }

        // 3. Authenticate with ClobClient V2
        try {
            const wallet = new ethers.Wallet(pk!, this.provider!);
            const isEOA = wallet.address.toLowerCase() === proxyAddress!.toLowerCase();
            const signatureType = isEOA ? SignatureTypeV2.EOA : SignatureTypeV2.POLY_1271;

            let activeCreds = (apiKey && secret && passphrase) 
                ? { key: apiKey, secret: secret, passphrase: passphrase } 
                : undefined;

            let authed = false;
            // Test user-provided creds if present
            if (activeCreds) {
                try {
                    const testClient = new ClobClient({
                        host: 'https://clob.polymarket.com',
                        chain: 137,
                        signer: wallet as any,
                        creds: activeCreds,
                        signatureType,
                        funderAddress: proxyAddress!
                    });
                    await testClient.getOpenOrders();
                    this.clobClient = testClient;
                    authed = true;
                } catch {
                    logger.warn('Supplied Polymarket API credentials invalid; deriving active credentials dynamically from wallet...');
                }
            }

            if (!authed) {
                // Dynamically derive or create valid API credentials
                const initClient = new ClobClient({
                    host: 'https://clob.polymarket.com',
                    chain: 137,
                    signer: wallet as any,
                    signatureType,
                    funderAddress: proxyAddress!
                });
                let derivedCreds = await initClient.createOrDeriveApiKey();

                this.clobClient = new ClobClient({
                    host: 'https://clob.polymarket.com',
                    chain: 137,
                    signer: wallet as any,
                    creds: derivedCreds,
                    signatureType,
                    funderAddress: proxyAddress!
                });
                await this.clobClient.getOpenOrders();
                authed = true;
                logger.info('Successfully authenticated with Polymarket CLOB v2 credentials.');
            }
            
            status.clobAuthStatus = 'AUTHENTICATED';
            status.mode = 'LIVE_TRADING';
            logger.info('Polymarket CLOB v2 client verified and live trading established.');
        } catch (err: any) {
            status.errors.push(`CLOB Auth Failed: ${err.message}`);
            logger.error({ err }, 'Failed to initialize ClobClient for Live Trading.');
            this.clobClient = new ClobClient({
                host: 'https://clob.polymarket.com',
                chain: 137
            });
            status.mode = 'READ_ONLY';
            return status;
        }

        // 4. Verify Balance (Final Integrity Gate)
        logger.info(`Fetching balances on-chain...`);
        try {
            if (this.clobClient) {
                const clobBal = await this.clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
                if (clobBal && clobBal.balance) {
                    status.balanceUSDC = parseFloat(clobBal.balance) / 1e6;
                    logger.info(`Verified Live Polymarket CLOB Balance -> $${status.balanceUSDC.toFixed(2)} pUSD`);
                }
            }
            
            if (status.balanceUSDC === undefined) {
                const abi = ['function balanceOf(address owner) view returns (uint256)'];
                const pusdContract = new ethers.Contract('0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb', abi, this.provider!);
                const pusdBal = await pusdContract.balanceOf(proxyAddress!);
                status.balanceUSDC = parseFloat(ethers.utils.formatUnits(pusdBal, 6));
                logger.info(`Verified Live On-Chain Balance -> $${status.balanceUSDC.toFixed(2)} pUSD`);
            }
        } catch (balErr: any) {
            status.errors.push(`Balance check failed: ${balErr.message}`);
            logger.warn(`Could not verify on-chain balance: ${balErr.message}`);
        }
        
        if (status.balanceUSDC === 0) {
            logger.warn('WARNING: Your wallet has 0 USDC/pUSD available for trading. Trades will fail until funded.');
        }

        return status;
    }

    getClient(): ClobClient | null {
        return this.clobClient;
    }

    getFunderAddress(): string | undefined {
        return process.env.Polymarket_wallet_Address || process.env.Signer_Address || process.env.POLYMARKET_PROXY_ADDRESS;
    }
}
