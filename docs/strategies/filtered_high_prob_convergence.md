# Filtered High Probability Convergence
**Strategy ID:** `filtered_high_prob_convergence`

## 📖 Overview
Targets markets heavily skewed (>95% prob) nearing resolution, sweeping up pennies with massive capital sizing.

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
    A([Start Tick]) --> B[Filter Active Markets]
    B --> C{Days to Resolution < 7?}
    C -- No --> Z([Skip Market])
    C -- Yes --> D{Current Price > $0.95?}
    D -- No --> Z
    D -- Yes --> E[Calculate Implied Annualized Yield (APY)]
    E --> F{Is APY > Target Hurdle Rate (e.g. 15%)?}
    F -- No --> Z
    F -- Yes --> G[Calculate Heavy Capital Allocation]
    G --> H{Risk Engine: Portfolio Drawdown Check}
    H -- No --> Z
    H -- Yes --> I[Place Limit Order at $0.96 / $0.97]
    I --> J([Hold to Resolution])
```

---

## 📥 Inputs and 📤 Outputs

### Data Inputs (In)
- **Primary Source:** Days to Resolution, Implied Probability (>0.95), APY Yield calculations
- **Environment:** `Live` or `Paper` state.
- **Risk Limits:** Max Drawdown, Max Position Size from Wallet Config.

### Data Outputs (Out)
- **Trade Signal:** High-Size / Low-Yield Limit Order
- **Telemetry:** Logs routed to `AgentScrubber` (lessons_learned.md) on failure or success.