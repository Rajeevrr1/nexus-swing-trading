import { useEffect, useState } from "react";

export interface RiskCapitalSettings {
  totalCapital: number;
  riskPercent: number;
  maxPositionCapPercent: number;
  /** Cap on combined rupee risk of open positions plus a new trigger. */
  maxTotalOpenRiskPercent: number;
}

export const DEFAULT_RISK_SETTINGS: RiskCapitalSettings = {
  totalCapital: 1_000_000,
  riskPercent: 1.0,
  maxPositionCapPercent: 20,
  maxTotalOpenRiskPercent: 5,
};

export const RISK_SETTINGS_EVENT = "nexus-risk-settings";
const STORAGE_KEY = "nexus-risk-capital";

export function loadRiskSettings(): RiskCapitalSettings {
  if (typeof window === "undefined") return { ...DEFAULT_RISK_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RISK_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<RiskCapitalSettings>;
    return {
      totalCapital: saneNumber(parsed.totalCapital, DEFAULT_RISK_SETTINGS.totalCapital),
      riskPercent: saneNumber(parsed.riskPercent, DEFAULT_RISK_SETTINGS.riskPercent),
      maxPositionCapPercent: saneNumber(parsed.maxPositionCapPercent, DEFAULT_RISK_SETTINGS.maxPositionCapPercent),
      maxTotalOpenRiskPercent: saneNumber(
        parsed.maxTotalOpenRiskPercent,
        DEFAULT_RISK_SETTINGS.maxTotalOpenRiskPercent,
      ),
    };
  } catch {
    return { ...DEFAULT_RISK_SETTINGS };
  }
}

export function saveRiskSettings(settings: RiskCapitalSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event(RISK_SETTINGS_EVENT));
}

/** Reactive hook so changing capital/risk in Settings updates sizing & AlertsContext immediately. */
export function useRiskSettings(): RiskCapitalSettings {
  const [settings, setSettings] = useState<RiskCapitalSettings>(() => loadRiskSettings());
  useEffect(() => {
    const sync = () => setSettings(loadRiskSettings());
    window.addEventListener(RISK_SETTINGS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(RISK_SETTINGS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return settings;
}

function saneNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
