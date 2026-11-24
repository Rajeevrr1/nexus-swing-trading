import type { ScoredSecurity } from "../scanner";

export interface PriceBar {
  date: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Daily volume when the feed provides it. Sample bars omit it. */
  volume?: number;
}

export interface MacdSeries {
  line: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export interface ChartAnalysis {
  symbol: string;
  bars: PriceBar[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  macd: MacdSeries;
  support: number;
  resistance: number;
  lastClose: number;
  ema20Last: number;
  ema50Last: number;
  macdLast: number;
  signalLast: number;
  histogramLast: number;
  disclaimer: string;
}

/** Plausible NSE sample closes for Nifty 100 constituents. These are illustration levels when offline. */
const SAMPLE_ANCHORS: Record<string, number> = {
  // Nifty 50
  ADANIENT: 2460,
  ADANIPORTS: 1180,
  APOLLOHOSP: 6950,
  ASIANPAINT: 2480,
  AXISBANK: 1140,
  "BAJAJ-AUTO": 9600,
  BAJFINANCE: 6980,
  BAJAJFINSV: 1620,
  BEL: 295,
  BPCL: 310,
  BHARTIARTL: 1638,
  BRITANNIA: 4950,
  CIPLA: 1520,
  COALINDIA: 410,
  DRREDDY: 1240,
  EICHERMOT: 4850,
  GRASIM: 2600,
  HCLTECH: 1820,
  HDFCBANK: 1742,
  HDFCLIFE: 710,
  HEROMOTOCO: 4750,
  HINDALCO: 660,
  HINDUNILVR: 2420,
  ICICIBANK: 1294,
  INDUSINDBK: 1040,
  INFY: 1864,
  ITC: 470,
  JSWSTEEL: 940,
  KOTAKBANK: 1720,
  LT: 3620,
  "M&M": 2850,
  MARUTI: 11200,
  NESTLEIND: 2240,
  NTPC: 380,
  ONGC: 250,
  POWERGRID: 320,
  RELIANCE: 1486,
  SBILIFE: 1540,
  SBIN: 812,
  SHRIRAMFIN: 3100,
  SUNPHARMA: 1780,
  TATACONSUM: 960,
  TATAMOTORS: 784,
  TATASTEEL: 145,
  TCS: 4125,
  TECHM: 1680,
  TITAN: 3388,
  TRENT: 6400,
  ULTRACEMCO: 11200,
  WIPRO: 492,

  // Nifty Next 50
  ABB: 7450,
  ADANIGREEN: 1620,
  ADANIPOWER: 590,
  AMBUJACEM: 560,
  ATGL: 710,
  AUROPHARMA: 1280,
  BANKBARODA: 245,
  BERGEPAINT: 520,
  BHARATFORG: 1360,
  BHEL: 235,
  BOSCHLTD: 34200,
  CANBK: 102,
  CGPOWER: 690,
  CHOLAFIN: 1340,
  COLPAL: 3050,
  CUMMINSIND: 3680,
  DIVISLAB: 5920,
  DLF: 810,
  GAIL: 195,
  GODREJCP: 1180,
  HAL: 4320,
  HAVELLS: 1680,
  ICICIGI: 1780,
  ICICIPRULI: 690,
  INDHOTEL: 780,
  IOC: 142,
  IRCTC: 810,
  IRFC: 148,
  JINDALSTEL: 920,
  JIOFIN: 315,
  LTIM: 5850,
  LUPIN: 2150,
  MARICO: 630,
  MAXHEALTH: 980,
  MOTHERSON: 165,
  NAUKRI: 7300,
  NHPC: 88,
  PAGEIND: 44200,
  PFC: 475,
  PIDILITIND: 3080,
  PNB: 105,
  POLYCAB: 6450,
  RECLTD: 510,
  SBICARD: 710,
  SIEMENS: 6850,
  SRF: 2320,
  TATAELXSI: 6750,
  TATAPOWER: 395,
  TVSMOTOR: 2420,
  VBL: 615,
};

const BAR_COUNT = 80;
const SAMPLE_END = "2026-11-10";

export function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period || period < 1) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function lastNumber(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value != null) return value;
  }
  return 0;
}

function macd(closes: number[]): MacdSeries {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line: (number | null)[] = closes.map((_, i) => {
    const f = fast[i];
    const s = slow[i];
    return f == null || s == null ? null : f - s;
  });
  const defined: number[] = [];
  const definedAt: number[] = [];
  line.forEach((value, i) => {
    if (value != null) {
      defined.push(value);
      definedAt.push(i);
    }
  });
  const signalOnDefined = ema(defined, 9);
  const signal: (number | null)[] = Array(closes.length).fill(null);
  signalOnDefined.forEach((value, i) => {
    if (value != null) signal[definedAt[i]] = value;
  });
  const histogram = line.map((value, i) => {
    const sig = signal[i];
    return value == null || sig == null ? null : value - sig;
  });
  return { line, signal, histogram };
}

function hashSymbol(symbol: string): number {
  let hash = 2166136261;
  for (const char of symbol) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function businessDaysEnding(isoDate: string, count: number): Date[] {
  const [year, month, day] = isoDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  const days: Date[] = [];
  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days.reverse();
}

function roundLevel(value: number): number {
  const step = value >= 1000 ? 5 : 1;
  return Math.round(value / step) * step;
}

export function latestEma(values: number[], period: number): number | null {
  const series = ema(values, period);
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (value != null) return value;
  }
  return null;
}

/** Same EMA, MACD, support, and resistance math for sample bars and Kite candles. */
export function analyzeBars(symbol: string, bars: PriceBar[], disclaimer: string): ChartAnalysis {
  const closes = bars.map((bar) => bar.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const macdSeries = macd(closes);
  const recent = bars.slice(-30);
  const lastClose = closes[closes.length - 1] ?? 0;
  let support = roundLevel(Math.min(...recent.map((bar) => bar.low)));
  let resistance = roundLevel(Math.max(...recent.map((bar) => bar.high)));
  if (support >= lastClose) support = roundLevel(lastClose * 0.985);
  if (resistance <= lastClose) resistance = roundLevel(lastClose * 1.015);

  return {
    symbol,
    bars,
    ema20,
    ema50,
    macd: macdSeries,
    support,
    resistance,
    lastClose,
    ema20Last: lastNumber(ema20),
    ema50Last: lastNumber(ema50),
    macdLast: lastNumber(macdSeries.line),
    signalLast: lastNumber(macdSeries.signal),
    histogramLast: lastNumber(macdSeries.histogram),
    disclaimer,
  };
}

/** Deterministic sample daily bars and indicators for one scanned NSE name. */
export function buildAnalysis(security: ScoredSecurity): ChartAnalysis {
  const rng = mulberry32(hashSymbol(security.symbol));
  const anchor = SAMPLE_ANCHORS[security.symbol] ?? 1000;
  const drift = (security.conviction - 58) * 0.00004;
  const dates = businessDaysEnding(SAMPLE_END, BAR_COUNT);
  const raw: number[] = [];
  let price = 1;
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const shock = (rng() - 0.5) * 0.016 + drift;
    price *= 1 + shock;
    raw.push(price);
  }
  const scale = anchor / raw[raw.length - 1];
  const closes = raw.map((value) => value * scale);

  const bars: PriceBar[] = closes.map((close, i) => {
    const body = close * (0.006 + rng() * 0.016) * (rng() > 0.48 ? 1 : -1);
    const open = close - body;
    const wick = close * (0.002 + rng() * 0.008);
    const high = Math.max(open, close) + wick;
    const low = Math.max(1, Math.min(open, close) - wick * (0.55 + rng() * 0.7));
    const date = dates[i];
    const volume = Math.round(800_000 + rng() * 2_400_000 * (0.7 + Math.abs(body / close) * 8));
    return {
      date: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(date),
      open,
      high,
      low,
      close,
      volume,
    };
  });

  return analyzeBars(
    security.symbol,
    bars,
    "Sample daily candles through 10 Nov 2026. Not a live NSE feed.",
  );
}
