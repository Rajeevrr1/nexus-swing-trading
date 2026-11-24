import type { Security } from "./types";

const MID: Security["factors"] = { trueRs: 55, volume: 55, sector: 55, closingStrength: 55 };

function named(symbol: string, name: string, sector: string, factors: Security["factors"] = MID): Security {
  return { symbol, name, sector, factors };
}

/** Desk names Kite has no NSE instrument token for. Quotes are skipped, not surfaced as errors. */
export const UNQUOTED_SYMBOLS: ReadonlySet<string> = new Set(["LTIM", "ICICIPRULI"]);

/**
 * Official Nifty 100 universe (Nifty 50 + Nifty Next 50).
 * Combines blue-chip stability with the high-momentum growth leaders of the Next 50.
 * Eliminates small-cap manipulation and illiquid penny stock risk while ensuring ample swing trading setups.
 */
export const SAMPLE_UNIVERSE: readonly Security[] = [
  // ==========================================
  // --- NIFTY 50 BLUE CHIPS (50 STOCKS) ---
  // ==========================================

  // Energy & Utilities
  named("RELIANCE", "Reliance Industries", "Energy", { trueRs: 93, volume: 86, sector: 90, closingStrength: 88 }),
  named("BPCL", "Bharat Petroleum", "Energy"),
  named("COALINDIA", "Coal India", "Energy"),
  named("NTPC", "NTPC", "Energy"),
  named("ONGC", "Oil & Natural Gas Corporation", "Energy"),
  named("POWERGRID", "Power Grid Corporation", "Energy"),

  // Banking
  named("HDFCBANK", "HDFC Bank", "Banking", { trueRs: 90, volume: 84, sector: 88, closingStrength: 86 }),
  named("ICICIBANK", "ICICI Bank", "Banking", { trueRs: 83, volume: 81, sector: 86, closingStrength: 80 }),
  named("SBIN", "State Bank of India", "Banking", { trueRs: 71, volume: 75, sector: 70, closingStrength: 68 }),
  named("AXISBANK", "Axis Bank", "Banking"),
  named("KOTAKBANK", "Kotak Mahindra Bank", "Banking"),
  named("INDUSINDBK", "IndusInd Bank", "Banking"),

  // Financial Services
  named("BAJFINANCE", "Bajaj Finance", "Financials", { trueRs: 82, volume: 78, sector: 80, closingStrength: 81 }),
  named("BAJAJFINSV", "Bajaj Finserv", "Financials"),
  named("SHRIRAMFIN", "Shriram Finance", "Financials"),
  named("HDFCLIFE", "HDFC Life Insurance", "Financials"),
  named("SBILIFE", "SBI Life Insurance", "Financials"),

  // Information Technology
  named("TCS", "Tata Consultancy Services", "IT", { trueRs: 78, volume: 72, sector: 74, closingStrength: 79 }),
  named("INFY", "Infosys", "IT", { trueRs: 68, volume: 66, sector: 62, closingStrength: 70 }),
  named("HCLTECH", "HCL Technologies", "IT"),
  named("TECHM", "Tech Mahindra", "IT"),
  named("WIPRO", "Wipro", "IT", { trueRs: 36, volume: 48, sector: 34, closingStrength: 32 }),

  // Automotive
  named("BAJAJ-AUTO", "Bajaj Auto", "Auto"),
  named("EICHERMOT", "Eicher Motors", "Auto"),
  named("HEROMOTOCO", "Hero MotoCorp", "Auto"),
  named("M&M", "Mahindra & Mahindra", "Auto"),
  named("MARUTI", "Maruti Suzuki", "Auto"),
  named("TATAMOTORS", "Tata Motors", "Auto", { trueRs: 54, volume: 88, sector: 42, closingStrength: 50 }),

  // Consumer Goods & Retail
  named("ASIANPAINT", "Asian Paints", "Consumer"),
  named("BRITANNIA", "Britannia Industries", "Consumer"),
  named("HINDUNILVR", "Hindustan Unilever", "Consumer"),
  named("ITC", "ITC", "Consumer"),
  named("NESTLEIND", "Nestle India", "Consumer"),
  named("TATACONSUM", "Tata Consumer Products", "Consumer"),
  named("TITAN", "Titan Company", "Consumer", { trueRs: 66, volume: 48, sector: 60, closingStrength: 74 }),
  named("TRENT", "Trent", "Consumer"),

  // Healthcare & Pharma
  named("APOLLOHOSP", "Apollo Hospitals", "Pharma"),
  named("CIPLA", "Cipla", "Pharma"),
  named("DRREDDY", "Dr Reddy's Laboratories", "Pharma"),
  named("SUNPHARMA", "Sun Pharmaceutical", "Pharma"),

  // Metals & Mining
  named("HINDALCO", "Hindalco Industries", "Metals"),
  named("JSWSTEEL", "JSW Steel", "Metals"),
  named("TATASTEEL", "Tata Steel", "Metals"),

  // Capital Goods & Manufacturing
  named("BEL", "Bharat Electronics", "Capital Goods"),
  named("LT", "Larsen & Toubro", "Capital Goods", { trueRs: 86, volume: 78, sector: 84, closingStrength: 84 }),
  named("ULTRACEMCO", "UltraTech Cement", "Capital Goods"),

  // Conglomerate & Infrastructure
  named("ADANIENT", "Adani Enterprises", "Conglomerate", { trueRs: 28, volume: 70, sector: 22, closingStrength: 30 }),
  named("ADANIPORTS", "Adani Ports", "Infrastructure"),
  named("GRASIM", "Grasim Industries", "Conglomerate"),

  // Telecommunications
  named("BHARTIARTL", "Bharti Airtel", "Telecom", { trueRs: 74, volume: 70, sector: 76, closingStrength: 72 }),

  // ==========================================
  // --- NIFTY NEXT 50 LEADERS (50 STOCKS) ---
  // ==========================================

  // Capital Goods & Engineering
  named("ABB", "ABB India", "Capital Goods"),
  named("AMBUJACEM", "Ambuja Cements", "Capital Goods"),
  named("BHEL", "Bharat Heavy Electricals", "Capital Goods"),
  named("CGPOWER", "CG Power & Industrial Solutions", "Capital Goods"),
  named("CUMMINSIND", "Cummins India", "Capital Goods"),
  named("HAL", "Hindustan Aeronautics", "Capital Goods"),
  named("HAVELLS", "Havells India", "Capital Goods"),
  named("POLYCAB", "Polycab India", "Capital Goods"),
  named("SIEMENS", "Siemens", "Capital Goods"),

  // Energy, Oil & Utilities
  named("ADANIGREEN", "Adani Green Energy", "Energy"),
  named("ADANIPOWER", "Adani Power", "Energy"),
  named("ATGL", "Adani Total Gas", "Energy"),
  named("GAIL", "GAIL India", "Energy"),
  named("IOC", "Indian Oil Corporation", "Energy"),
  named("NHPC", "NHPC", "Energy"),
  named("TATAPOWER", "Tata Power", "Energy"),

  // Banking
  named("BANKBARODA", "Bank of Baroda", "Banking"),
  named("CANBK", "Canara Bank", "Banking"),
  named("PNB", "Punjab National Bank", "Banking"),

  // Financial Services & Insurance
  named("CHOLAFIN", "Cholamandalam Investment", "Financials"),
  named("ICICIGI", "ICICI Lombard General Insurance", "Financials"),
  named("ICICIPRULI", "ICICI Prudential Life Insurance", "Financials"),
  named("IRFC", "Indian Railway Finance Corporation", "Financials"),
  named("JIOFIN", "Jio Financial Services", "Financials"),
  named("PFC", "Power Finance Corporation", "Financials"),
  named("RECLTD", "REC", "Financials"),
  named("SBICARD", "SBI Cards & Payment Services", "Financials"),

  // Consumer & Retail
  named("BERGEPAINT", "Berger Paints", "Consumer"),
  named("COLPAL", "Colgate-Palmolive", "Consumer"),
  named("GODREJCP", "Godrej Consumer Products", "Consumer"),
  named("INDHOTEL", "Indian Hotels Company", "Consumer"),
  named("MARICO", "Marico", "Consumer"),
  named("PAGEIND", "Page Industries", "Consumer"),
  named("PIDILITIND", "Pidilite Industries", "Consumer"),
  named("VBL", "Varun Beverages", "Consumer"),

  // Automotive & Ancillaries
  named("BHARATFORG", "Bharat Forge", "Auto"),
  named("BOSCHLTD", "Bosch", "Auto"),
  named("MOTHERSON", "Samvardhana Motherson", "Auto"),
  named("TVSMOTOR", "TVS Motor Company", "Auto"),

  // Healthcare & Pharmaceuticals
  named("AUROPHARMA", "Aurobindo Pharma", "Pharma"),
  named("DIVISLAB", "Divi's Laboratories", "Pharma"),
  named("LUPIN", "Lupin", "Pharma"),
  named("MAXHEALTH", "Max Healthcare", "Pharma"),

  // Information Technology
  named("LTIM", "LTIMindtree", "IT"),
  named("NAUKRI", "Info Edge", "IT"),
  named("TATAELXSI", "Tata Elxsi", "IT"),

  // Metals & Mining
  named("JINDALSTEL", "Jindal Steel & Power", "Metals"),

  // Real Estate
  named("DLF", "DLF", "Real Estate"),

  // Materials & Chemicals
  named("SRF", "SRF", "Materials"),

  // Services
  named("IRCTC", "IRCTC", "Services"),
];

export function getUniverse(): readonly Security[] {
  return SAMPLE_UNIVERSE;
}
