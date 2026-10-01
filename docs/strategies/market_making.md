# Market Making (Spread Strategy)
**Strategy ID:** `market_making`

## 📖 Overview
Provides liquidity to both sides of the book. Uses Inventory Skew (Avellaneda-Stoikov model) to mitigate directional risk.

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
    A([Start Tick]) --> B[Fetch Market Mid-Price]
    B --> C[Fetch Current Wallet Inventory (YES/NO Exposure)]
    C --> D[Calculate Inventory Skew]
    D --> E{Is Inventory heavily skewed?}
    E -- Yes --> F[Shift Asks down to incentivize selling]
    E -- No --> G[Keep Bids/Asks symmetrical around mid]
    F --> H[Calculate New Ladder (Levels & Spreads)]
    G --> H
    H --> I{Are existing active orders > 2% away from new target?}
    I -- No --> Z([Do Nothing, wait])
    I -- Yes --> J[Cancel Old Orders]
    J --> K{Risk Engine: MM Spam Check (Max 500/min)?}
    K -- No --> Y([Throttle / Pause])
    K -- Yes --> L[Dispatch New Maker Limit Orders]
    L --> M([Update Resting Book])
```

---

## 📥 Inputs and 📤 Outputs

### Data Inputs (In)
- **Primary Source:** Live Orderbook (L2), Current Inventory (Position Size on YES/NO)
- **Environment:** `Live` or `Paper` state.
- **Risk Limits:** Max Drawdown, Max Position Size from Wallet Config.

### Data Outputs (Out)
- **Trade Signal:** Maker Limit Orders (Laddered Bids & Asks)
- **Telemetry:** Logs routed to `AgentScrubber` (lessons_learned.md) on failure or success.