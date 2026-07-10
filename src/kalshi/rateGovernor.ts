/** Simple serial token-bucket: guarantees >= 1/rps seconds between acquisitions. */
export class RateGovernor {
  private nextAt = 0;
  private readonly gapMs: number;
  constructor(requestsPerSecond: number) {
    this.gapMs = 1000 / Math.max(1, requestsPerSecond);
  }
  async acquire(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextAt - now);
    this.nextAt = Math.max(now, this.nextAt) + this.gapMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}
