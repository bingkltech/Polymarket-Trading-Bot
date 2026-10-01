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

## 🔍 Detailed Decision Flow Diagram

```mermaid
flowchart TD
    A([Start Tick]) --> B[Load custom JSON AST Ruleset]
    B --> C[Extract required market/wallet variables]
    C --> D[Evaluate AST Tree Conditions]
    D --> E{Evaluates to TRUE?}
    E -- No --> Z([Wait])
    E -- Yes --> F[Extract User Defined Sizing / Price rules]
    F --> G{Risk Engine: Global Limit Checks}
    G -- No --> Z
    G -- Yes --> H[Execute User Defined Signal]
    H --> I([Log Execution])
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