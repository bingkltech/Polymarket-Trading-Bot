export class MathStats {
  /**
   * Generates a random number from a Normal (Gaussian) Distribution 
   * using the Box-Muller transform.
   */
  static randomNormal(mean = 0, stdDev = 1): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + z * stdDev;
  }

  /**
   * Generates a random number from a Log-Normal Distribution.
   * Useful for latency modeling.
   */
  static randomLogNormal(mean = 0, stdDev = 1): number {
    return Math.exp(this.randomNormal(mean, stdDev));
  }

  /**
   * Calculates the theoretical market impact using the Square Root Law.
   * Delta P = Y * sigma * sqrt(Q / V)
   * where Y is a constant, sigma is volatility, Q is order size, V is available liquidity.
   */
  static squareRootMarketImpact(size: number, liquidityAtLevel: number, volatility = 0.05, Y = 1.0): number {
    if (liquidityAtLevel <= 0) return 0.01; // fallback max slip
    return Y * volatility * Math.sqrt(size / liquidityAtLevel);
  }

  /**
   * Poisson process to simulate random arrival events 
   * returns the number of events (e.g. orders) in a given timeframe
   */
  static poissonRandom(lambda: number): number {
    let L = Math.exp(-lambda);
    let p = 1.0;
    let k = 0;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }
}

/**
 * Alignment metrics to quantify how close paper trading is to real trading
 */
export class IncubationQuantifier {
  
  /**
   * Calculates the Root Mean Square Error (RMSE) between a set of paper execution
   * metrics and real execution metrics (e.g., slippage bps, fill times).
   * A lower RMSE means the simulation is highly aligned with reality.
   */
  static calculateRMSE(realValues: number[], simulatedValues: number[]): number {
    if (realValues.length === 0 || simulatedValues.length === 0) return 1.0; // Default mismatch
    
    // We compare distributions by sorting them or using quantiles if lengths differ,
    // but assuming simple equal lengths for straightforward calculation:
    const minLen = Math.min(realValues.length, simulatedValues.length);
    let sumSq = 0;
    for (let i = 0; i < minLen; i++) {
      const diff = realValues[i] - simulatedValues[i];
      sumSq += diff * diff;
    }
    return Math.sqrt(sumSq / minLen);
  }

  /**
   * Calculates an overall "Reality Alignment Score" (0.0 to 1.0)
   * 1.0 = Simulation is perfectly matching live market conditions.
   * < 0.5 = High risk of "Fake Confidence".
   */
  static calculateRealityScore(rmseSlippageBps: number, rmseLatencyMs: number, fillRateDiff: number): number {
    // Arbitrary normalization factors to turn errors into a 0-1 confidence score
    // E.g., if slippage is off by 10 bps, score drops.
    const slippageScore = Math.max(0, 1 - (rmseSlippageBps / 20)); 
    const latencyScore = Math.max(0, 1 - (rmseLatencyMs / 200));
    const fillRateScore = Math.max(0, 1 - Math.abs(fillRateDiff));

    return (slippageScore * 0.5) + (latencyScore * 0.2) + (fillRateScore * 0.3);
  }
}
