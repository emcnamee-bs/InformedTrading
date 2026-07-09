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
    requestsPerSecond: Number(env.REQUESTS_PER_SECOND ?? "5"),
  };
}
