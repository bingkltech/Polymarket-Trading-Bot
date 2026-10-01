# Custom User Defined Strategy
**Strategy ID:** `user_defined`

## 📖 Overview
A sandboxed strategy template where the user can define ad-hoc rules without modifying core engine logic.

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

## 🔍 Micro-Level Logic Diagram
This detailed diagram shows the internal decision tree the strategy executes on every tick.

```mermaid
stateDiagram-v2
    [*] --> IngestData
    IngestData --> Filter: Raw Market Data
    Filter --> Analysis: Passed Filters
    Filter --> [*]: Ignored (Noise)
    
    Analysis --> RiskCheck: Proposed Trade
    Analysis --> [*]: No Alpha Found

    RiskCheck --> Execution: Risk Engine Passed
    RiskCheck --> [*]: Risk VETO (Drawdown/Limit)

    Execution --> AwaitFill: Sent to ClobClient
    AwaitFill --> Filled: Trade Executed
    AwaitFill --> Canceled: Timeout / Slipped
    
    Filled --> [*]
    Canceled --> [*]
```

---

## 📥 Inputs and 📤 Outputs

### Data Inputs (In)
- **Primary Source:** JSON Config Parameters, Evaluated Expressions
- **Environment:** `Live` or `Paper` state.
- **Risk Limits:** Max Drawdown, Max Position Size from Wallet Config.

### Data Outputs (Out)
- **Trade Signal:** User-specified Signal
- **Telemetry:** Logs routed to `AgentScrubber` (lessons_learned.md) on failure or success.