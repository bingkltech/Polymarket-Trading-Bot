import 'dotenv/config';
import { PolymarketConnector } from '../src/core/polymarket_connector';
import { logger } from '../src/reporting/logs';

async function main() {
  const connector = new PolymarketConnector();
  const status = await connector.connect(true);
  console.log('Connection status:', status);
  if (status.mode !== 'LIVE_TRADING') {
    console.error('Failed to connect in LIVE_TRADING mode');
    return;
  }

  const client = connector.getClobClient();
  if (!client) {
    console.error('No CLOB client available');
    return;
  }

  const proxyAddress = connector.getFunderAddress();
  console.log('Funder Proxy Address:', proxyAddress);

  const posRes = await fetch(`https://data-api.polymarket.com/positions?user=${proxyAddress.toLowerCase()}`);
  const positions: any[] = await posRes.json();
  console.log('Live Positions Found:', positions.length);

  for (const pos of positions) {
    const size = Number(pos.size || 0);
    const curPrice = Number(pos.curPrice || 0);
    if (size <= 0 || pos.redeemable === true) continue;

    console.log(`\nEvaluating: ${pos.title}`);
    console.log(`Asset ID: ${pos.asset} | Outcome: ${pos.outcome} | Size: ${size} | CurPrice: $${curPrice}`);

    // We want to exit:
    // 1. Brazil Lula Minas Gerais (asset token or slug)
    // 2. LoL Galions (asset token or slug)
    const titleLower = (pos.title || '').toLowerCase();
    const shouldExit = titleLower.includes('lula') || titleLower.includes('galions') || titleLower.includes('minas gerais');

    if (shouldExit) {
      console.log(`--> EXECUTING 1-CLICK MARKET EXIT FOR: ${pos.title}`);
      
      // Determine exit price (match current price or slightly aggressive to ensure fill)
      const exitPrice = curPrice > 0.05 ? Number((Math.round(curPrice * 100) / 100).toFixed(2)) : 0.50;
      const exitSize = Math.floor(size); // whole shares

      try {
        console.log(`Posting SELL order: tokenID=${pos.asset}, price=${exitPrice}, size=${exitSize}`);
        const order = await (client as any).createOrder({
          tokenID: pos.asset,
          price: exitPrice,
          side: 'SELL' as any,
          size: exitSize,
        });

        const resp = await (client as any).postOrder(order);
        console.log('Order Response:', resp);
      } catch (err: any) {
        console.error('Error placing exit order:', err?.message || err);
      }
    }
  }
}

main().catch(console.error);
