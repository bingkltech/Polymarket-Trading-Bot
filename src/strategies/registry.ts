import { StrategyInterface } from './strategy_interface';
import { CrossMarketArbitrageStrategy } from './arbitrage/cross_market_arbitrage';
import { MispricingArbitrageStrategy } from './arbitrage/mispricing_detector';
import { AiForecastStrategy } from './research_ai/ai_forecast_strategy';
import { SpreadStrategy } from './market_making/spread_strategy';
import { MomentumStrategy } from './trend/momentum_strategy';
import { UserDefinedStrategy } from './custom/user_defined_strategy';
import { FilteredHighProbConvergenceStrategy } from './convergence/filtered_high_prob_convergence';
import { CopyTradeStrategy } from './copy_trading/copy_trade_strategy';

import { MispricingArbitrageClonedStrategy } from './arbitrage/mispricing_detector_cloned';
import { SpreadStrategyCloned } from './market_making/spread_strategy_cloned';

export const STRATEGY_REGISTRY: Record<string, new () => StrategyInterface> = {
  cross_market_arbitrage: CrossMarketArbitrageStrategy,
  mispricing_arbitrage: MispricingArbitrageStrategy,
  'mispricing_arbitrage++clone': MispricingArbitrageClonedStrategy,
  ai_forecast: AiForecastStrategy,
  market_making: SpreadStrategy,
  'market_making++clone': SpreadStrategyCloned,
  momentum: MomentumStrategy,
  user_defined: UserDefinedStrategy,
  filtered_high_prob_convergence: FilteredHighProbConvergenceStrategy,
  copy_trade: CopyTradeStrategy,
};

export function listStrategies(): string[] {
  return Object.keys(STRATEGY_REGISTRY);
}
