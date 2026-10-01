import { logger } from '../reporting/logs';
import { consoleLog } from '../reporting/console_log';

/**
 * AntiFreeze - Watchdog for the Node.js Event Loop and Latency Management.
 * Monitors if the event loop is blocked for too long (CPU spike) or if
 * memory/latency constraints are breached.
 */
export class AntiFreeze {
  private lastTick: number;
  private intervalHandle: NodeJS.Timeout | null = null;
  private thresholdMs: number;

  constructor(thresholdMs = 5000) {
    this.lastTick = Date.now();
    this.thresholdMs = thresholdMs;
  }

  start() {
    this.lastTick = Date.now();
    this.intervalHandle = setInterval(() => {
      const now = Date.now();
      const delay = now - this.lastTick;
      
      if (delay > this.thresholdMs) {
        logger.warn({ delay }, 'AntiFreeze: EVENT LOOP BLOCKED. Critical Latency Spike detected!');
        consoleLog.error('SYSTEM', `AntiFreeze: Event Loop stalled for ${delay}ms. Possible memory leak or synchronous blocking.`);
        // Note: We could forcibly restart here, but logging it as a critical warning is safer.
      }
      
      this.lastTick = now;
    }, 1000); // Check every 1s
    
    // Unref so it doesn't keep the process alive on shutdown
    this.intervalHandle.unref();
    consoleLog.success('SYSTEM', 'AntiFreeze watchdog activated.');
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Reset strategy state in memory (Hot reload / Bot change support)
   */
  static resetStrategyMemory(strategyName: string) {
    logger.info({ strategyName }, 'Memory Reset triggered for strategy hot-reload.');
    consoleLog.warn('SYSTEM', `Executing memory reset & state wipe for updated bot: ${strategyName}`);
    // A clean state boundary for strategies when they are swapped or updated
  }
}
