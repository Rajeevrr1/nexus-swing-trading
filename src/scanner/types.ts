/** Factor readings are 0–100 sample scores, not prices or live prints. */
export interface FactorInput {
  trueRs: number;
  volume: number;
  sector: number;
  closingStrength: number;
}

export type FactorKey = keyof FactorInput;

export interface Security {
  symbol: string;
  name: string;
  sector: string;
  factors: FactorInput;
}

export interface FactorReading {
  key: FactorKey;
  label: string;
  value: number;
}

/** Letter grades used on recommendation cards. Names below the floor have none. */
export type Grade = "A+" | "A" | "B";

export type Stance = "Strong" | "Watch" | "Weak" | "Avoid";

/** Palette key shared by the gauge, the grade, and factor bars. */
export type Tone = "strong" | "watch" | "weak";

export interface ScoredSecurity {
  symbol: string;
  name: string;
  sector: string;
  factors: FactorReading[];
  conviction: number;
  grade: Grade | null;
  stance: Stance;
  tone: Tone;
  action: string;
}

export interface Recommendation extends ScoredSecurity {
  grade: Grade;
}
