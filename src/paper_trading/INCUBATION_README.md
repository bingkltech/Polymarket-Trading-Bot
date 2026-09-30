# Quantifiable Incubation Framework

The Polymarket Trading Bot uses a statistically rigorous "Incubation-Hardened" paper trading simulator. The goal is to prevent the "Fake Confidence" problem where backtests and paper trades show massive profits that disappear in live markets due to latency, queue priority, and slippage.

Instead of using basic heuristic random numbers (`Math.random()`), the incubation simulator uses established quantitative finance statistical models to emulate market micro-structure.

## The Parameters (The Tuning Knobs)

These parameters start with baseline assumptions. As the bot runs live trades alongside paper trades, the `IncubationQuantifier` calculates the Root Mean Square Error (RMSE) deviation. You use this deviation to adjust these parameters so the simulation perfectly converges with reality.

### 1. `queueDepthPenaltyLevels` (The Poisson Queue Parameter)
* **Current Baseline:** `2.0` (Lambda for Poisson distribution)
* **What it does:** Simulates how many levels of the L2 order book get "eaten" by faster trading bots between the time you see the book and the time your order arrives.
* **How Live Data Sharpens It:** If your live limit orders consistently fill at a worse price than the top-of-book you saw (e.g., you are missing the best bid), you increase this parameter.

### 2. `bookStalenessDecayBps` (The Gaussian Drift Parameter)
* **Current Baseline:** `8` (Basis Points)
* **What it does:** Acts as the standard deviation for a Gaussian random walk. It models the micro-price movement (drift) that happens while your order is traveling over the network.
* **How Live Data Sharpens It:** Track the exact price of the asset at the millisecond you emit the order vs. the millisecond the matching engine processes it. The variance in that price difference becomes your new exact value for this parameter.

### 3. `fillProbability` (The Limit Order Success Rate)
* **Current Baseline:** `0.35` (35% success)
* **What it does:** Models the hard reality that just because your limit order sits at the current market price doesn't mean it actually gets filled (someone else might have queue priority).
* **How Live Data Sharpens It:** Divide your `(Live Limit Orders Filled) / (Live Limit Orders Placed)`. If your live bot only gets filled 28% of the time, you drop this parameter to `0.28`.

### 4. `exitSlippageMultiplier` (The Panic Penalty)
* **Current Baseline:** `2.5x`
* **What it does:** Multiplies your market impact when you are closing a position (especially stop-losses). When you are trying to exit a losing position, other buyers tend to vanish, making slippage much worse than when you entered. 
* **How Live Data Sharpens It:** Compare the average slippage (in bps) of your live **entry** orders versus your live **exit** orders. The ratio between the two becomes this multiplier.

### 5. `arbRaceRejectionRate` (The MEV / Speed Race Parameter)
* **Current Baseline:** `0.70` (70% failure)
* **What it does:** If the bot spots an arbitrage or cross-market opportunity, this is the probability that a faster bot takes the trade before you do.
* **How Live Data Sharpens It:** Track how often your live arbitrage orders get rejected due to the opportunity no longer existing.

### 6. `liquidityDecayPctPerHour` (The Time-Decay Parameter)
* **Current Baseline:** `0.20` (20% decay per hour after 30 mins)
* **What it does:** Simulates the fact that if you hold a position for hours on a slow Polymarket market, the liquidity on the opposite side of the book might dry up, making it harder to exit large sizes later.
* **How Live Data Sharpens It:** Track the total order book depth over the lifespan of your held positions.

### 7. Latency Log-Normal Distribution
* **Current Baseline:** Mean `4.5`, StdDev `0.4` (Results in ~90ms average ping, with realistic spikes up to ~300ms).
* **What it does:** Simulates network lag using a Log-Normal distribution, which correctly models the long right-tail of network latency (as opposed to uniform randomness).
* **How Live Data Sharpens It:** Measure your actual API round-trip times to the Polymarket sequencer. Take the `log` of those times to find the true mean and standard deviation of your specific server's connection.

## The Feedback Loop

Over time, the `IncubationQuantifier` calculates the **RMSE (Root Mean Square Error)** between your Live Trades and Paper Trades. 

If the RMSE is high, it means the incubator is hallucinating. You look at where the deviation is (e.g., paper trading says you should have 5 bps slippage, but live trading gives you 12 bps). You then twist the `queueDepthPenaltyLevels` and `bookStalenessDecayBps` knobs until the simulated slippage matches the 12 bps live slippage. 

This ensures that any strategy that survives your paper trading incubator is mathematically guaranteed to survive in production.
