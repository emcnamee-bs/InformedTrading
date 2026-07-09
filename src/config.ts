export interface Config {
  kalshiBaseUrl: string;
  cacheDir: string;
  requestsPerSecond: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    kalshiBaseUrl:
      env.KALSHI_BASE_URL ?? "https://api.elections.kalshi.com/trade-api/v2",
    cacheDir: env.CACHE_DIR ?? ".cache",
    // Wired straight into RateGovernor (see kalshi/historicalClient.ts). A conservative
    // default of 5 rps; a real sweep can raise it (e.g. REQUESTS_PER_SECOND=10) within
    // Kalshi's published rate limits to cut wall-clock time.
    requestsPerSecond: Number(env.REQUESTS_PER_SECOND ?? "5"),
  };
}
