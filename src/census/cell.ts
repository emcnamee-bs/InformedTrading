import { FeatureVector } from "../detection/features";

export const SPORTS_CATEGORY = "sports";

// Series-prefix → category. Order matters: check sports mention-markets before generic *MENTION.
const SPORTS_PREFIXES = ["KXMLB", "KXNBA", "KXNFL", "KXNHL", "KXWC", "KXATP", "KXWTA", "KXFIGHT", "KXUFC", "KXSOCCER", "KXTENNIS"];
export function categoryOf(series: string): string {
  const s = series.toUpperCase();
  if (SPORTS_PREFIXES.some((p) => s.startsWith(p))) return SPORTS_CATEGORY;
  if (s.includes("MENTION")) return "mentions";
  if (/(NETFLIX|BIGBROTHER|LIUSA|LOVEISLAND|OSCAR|EMMY|GRAMMY|BOXOFFICE|ROTTEN|SHOWRUNNER|MOVIE|ALBUM)/.test(s)) return "entertainment";
  if (/(SENATE|HOUSE|PRES|ELECT|GOV|POLL|CONGRESS|SCOTUS|VETO|NDAA)/.test(s)) return "politics";
  if (/(CPI|GDP|FED|RATE|JOBS|UNEMP|INFLATION|PAYROLL)/.test(s)) return "economics";
  if (/(EARN|MERGER|IPO|TSLA|AAPL|COMPANY|NVDA|LAYOFF)/.test(s)) return "companies";
  return "other";
}

export function bandOf(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0 || cents >= 100) return "bNA";
  return `b${Math.round(cents)}`;
}

export function timeBucketOf(minsToClose: number): string {
  const m = minsToClose;
  if (m <= 30) return "30m";
  if (m <= 60) return "1h";
  if (m <= 120) return "2h";
  if (m <= 360) return "6h";
  if (m <= 720) return "12h";
  if (m <= 1440) return "1d";
  if (m <= 2880) return "2d";
  return "1wk";
}

export function scoreBucketOf(score: number): string {
  if (score < 1.5) return "low";
  if (score < 3) return "med";
  return "high";
}

// DEFAULT_ANOMALY_PARAMS thresholds (imbalanceTau=0.3, volumeZTau=2, vpinTau=0.2) decide which
// confirmations fired. detectAnomaly guarantees at least one of imbalance/volumeZ confirmed.
export function detectorLabel(f: FeatureVector): string {
  const parts: string[] = ["cusum"];
  if (f.flowImbalance !== null && Math.abs(f.flowImbalance) >= 0.3) parts.push("imbalance");
  if (f.volumeZ !== null && f.volumeZ >= 2) parts.push("volumeZ");
  if (f.vpin !== null && f.vpin >= 0.2) parts.push("vpin");
  return parts.join("+");
}

export function cellKey(p: {
  category: string; detector: string; sensitivity: string; direction: string;
  entryBand: string; timeBucket: string; scoreBucket: string;
}): string {
  return [p.category, p.detector, p.sensitivity, p.direction, p.entryBand, p.timeBucket, p.scoreBucket].join("|");
}
