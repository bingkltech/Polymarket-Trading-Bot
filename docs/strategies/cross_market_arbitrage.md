# Cross Market Arbitrage Strategy
**Strategy ID:** `cross_market_arbitrage`

## 📖 Overview
Exploits price discrepancies between Polymarket and external markets (like Binance) by detecting lagging orderbooks.

---

## 🏗️ Front-End / Back-End Workflow

This diagram illustrates the lifecycle of this strategy, from data ingestion to UI reflection.

```mermaid
flowchart TD
    %% Styling
    classDef frontend fill:#3b82f6,stroke:#1e3a8a,color:#fff,stroke-width:2px;
    classDef backend fill:#10b981,stroke:#064e3b,color:#fff,stroke-width:2px;
    classDef db fill:#8b5cf6,stroke:#4c1d95,color:#fff,stroke-width:2px;

    UI[Web Dashboard UI]:::frontend
    SSE[SSE Stream]:::backend
    Strat[Engine]:::backend
    Router[Order Router]:::backend
    Polymarket[(Polymarket CLOB)]:::db

    UI -- "1. Enable" --> Strat
    Strat -- "2. Subscribes" --> Polymarket
    Polymarket -- "3. Market Updates" --> Strat
    Strat -- "4. Generates Trade" --> Router
    Router -- "5. EIP-712 Signature" --> Polymarket
    Strat -- "6. Log Event" --> SSE
    SSE -- "7. Real-Time Update" --> UI
```

---

## 🔍 Detailed Decision Flow Diagram

```mermaid
flowchart TD
    A([Start Tick]) --> B{Fetch External Oracle (e.g. Binance)}
    B --> C{Fetch Polymarket Orderbook}
    C --> D[Calculate Implied Price Delta]
    D --> E{Is Delta > Spread Threshold?}
    E -- No --> Z([Wait for next tick])
    E -- Yes --> F{Is Orderbook Depth sufficient?}
    F -- No --> Z
    F -- Yes --> G[Calculate Optimal Sizing / Hedge Ratio]
    G --> H{Risk Engine: Passes Legging Moat?}
    H -- No --> Z
    H -- Yes --> I[Dispatch Atomic Trade]
    I --> J[Buy Asset on External CEX]
    I --> K[Buy YES/NO on Polymarket]
    J --> L([Trade Logged])
    K --> L
```


### 📝 Step-by-Step Breakdown
1. **Fetch External Oracles:** The bot pulls real-time pricing data from external centralized exchanges (e.g., Binance).
2. **Fetch Polymarket Orderbook:** It pulls the current Bid/Ask limit levels from the Polymarket CLOB.
3. **Calculate Delta:** The engine compares the two prices to find the implied delta. If the spread is too small to cover fees, it waits.
4. **Liquidity Check:** If a profitable delta exists, it checks if the Polymarket orderbook actually has enough depth to absorb the trade without slipping.
5. **Hedge Ratios:** It calculates the mathematically optimal sizing to remain market-neutral.
6. **Risk Firewall:** The trade is sent to the Risk Engine to verify the Legging Moat veto. If cleared, atomic dual-leg orders are fired simultaneously.


---

## 📥 Inputs and 📤 Outputs

### Data Inputs (In)
- **Primary Source:** MarketData (Prices, Orderbook Depth) + External Oracle Data (Binance, CEX feeds)
- **Environment:** `Live` or `Paper` state.
- **Risk Limits:** Max Drawdown, Max Position Size from Wallet Config.

### Data Outputs (Out)
- **Trade Signal:** Atomic Trade Legs (Simultaneous Limit Orders) with calculated Hedge ratios
- **Telemetry:** Logs routed to `AgentScrubber` (lessons_learned.md) on failure or success.