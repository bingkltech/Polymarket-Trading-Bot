async function fetchUserData() {
  const proxy = '0xaffb9738983984c517ef0508ce861cb2a952e6ed';
  console.log('=== FORENSIC PORTFOLIO AUDIT FOR:', proxy, '===');

  // 1. Positions
  try {
    const posRes = await fetch(`https://data-api.polymarket.com/positions?user=${proxy.toLowerCase()}`);
    if (posRes.ok) {
      const positions = await posRes.json();
      console.log('\n--- ALL POSITIONS (' + positions.length + ') ---');
      let totalCurrentVal = 0;
      let totalInitialVal = 0;
      for (const p of positions) {
        const size = Number(p.size || 0);
        const avgPrice = Number(p.avgPrice || 0);
        const curPrice = Number(p.curPrice || 0);
        const currentValue = Number(p.currentValue || (size * curPrice));
        const initValue = size * avgPrice;
        totalCurrentVal += currentValue;
        totalInitialVal += initValue;
        console.log(`• ${p.title}`);
        console.log(`  Outcome: ${p.outcome} | Size: ${size} | AvgPrice: $${avgPrice.toFixed(4)} | CurPrice: $${curPrice.toFixed(4)} | CurVal: $${currentValue.toFixed(2)} | RealizedPnL: $${Number(p.realizedPnl||0).toFixed(2)} | Redeemable: ${p.redeemable}`);
      }
      console.log(`\nTOTAL ACTIVE POSITIONS VALUE: $${totalCurrentVal.toFixed(2)} (Cost basis: $${totalInitialVal.toFixed(2)})`);
    }
  } catch (e) {
    console.error('Error fetching positions:', e.message);
  }

  // 2. Activity History (Fills & Redemptions)
  try {
    const actRes = await fetch(`https://data-api.polymarket.com/activity?user=${proxy.toLowerCase()}&limit=200`);
    if (actRes.ok) {
      const activity = await actRes.json();
      console.log('\n--- ACTIVITY LOGS (' + activity.length + ') ---');
      let buyCount = 0;
      let sellCount = 0;
      let buyTotal = 0;
      let sellTotal = 0;
      let redemptionTotal = 0;
      
      for (const a of activity) {
        const sz = Number(a.size || 0);
        const pr = Number(a.price || 0);
        const val = (a.usdcSize ? Number(a.usdcSize) : sz * pr);
        if (a.type === 'BUY' || a.side === 'BUY') {
          buyCount++;
          buyTotal += val;
        } else if (a.type === 'SELL' || a.side === 'SELL') {
          sellCount++;
          sellTotal += val;
        } else if (a.type === 'REDEEM') {
          redemptionTotal += val;
        }
      }
      console.log({ buyCount, sellCount, buyTotal: `$${buyTotal.toFixed(2)}`, sellTotal: `$${sellTotal.toFixed(2)}`, redemptionTotal: `$${redemptionTotal.toFixed(2)}` });

      console.log('\n--- 20 MOST RECENT TRADES ---');
      for (const a of activity.slice(0, 20)) {
        console.log(`${new Date(a.timestamp * (a.timestamp < 1e11 ? 1000 : 1)).toISOString().slice(0, 19)} | ${(a.type || a.side).padEnd(5)} ${a.outcome?.padEnd(4) || '    '} x${String(a.size || 0).padEnd(6)} @ $${Number(a.price||0).toFixed(3)} | $${(Number(a.size||0) * Number(a.price||0)).toFixed(2).padEnd(6)} | ${a.title?.slice(0, 60)}`);
      }
    }
  } catch (e) {
    console.error('Error fetching activity:', e.message);
  }
}

fetchUserData();
