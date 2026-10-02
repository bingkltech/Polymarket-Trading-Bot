import { ClobClient, SignatureTypeV2, AssetType } from '@polymarket/clob-client-v2';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const pk = process.env.Wallet_Private_Key || process.env.POLYGON_PRIVATE_KEY;
  const proxy = process.env.Polymarket_wallet_Address || process.env.Signer_Address || process.env.POLYMARKET_PROXY_ADDRESS;
  const apiKey = (process.env.Alchemy_Api || '').replace(/"/g, '').trim();
  const provider = new ethers.providers.StaticJsonRpcProvider(`https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`, 137);
  const wallet = new ethers.Wallet(pk!, provider);

  const initClient = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: 137,
    signer: wallet as any,
    signatureType: SignatureTypeV2.POLY_1271,
    funderAddress: proxy
  });

  const creds = await initClient.createOrDeriveApiKey();

  const client = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: 137,
    signer: wallet as any,
    creds: creds,
    signatureType: SignatureTypeV2.POLY_1271,
    funderAddress: proxy
  });

  const openOrders = await client.getOpenOrders();
  console.log('Open orders count:', openOrders?.length ?? 0);
  if (openOrders && openOrders.length > 0) {
    console.log('Open orders:', openOrders);
    for (const ord of openOrders) {
      console.log('Cancelling open order:', ord.id);
      await client.cancelOrder({ orderID: ord.id });
    }
  }

  const allowance = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  console.log('Current balance allowance on CLOB:', allowance);

  // Fetch positions on Polymarket for this proxy address
  try {
    const res = await fetch(`https://data-api.polymarket.com/positions?user=${proxy}`);
    if (res.ok) {
      const positions = await res.json();
      console.log('Current positions on Polymarket:', positions);
    }
  } catch (e) {
    console.error('Failed to fetch positions:', e);
  }
}

run().catch(console.error);
