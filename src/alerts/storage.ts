import { EMPTY_ALERT_MEMORY, type AlertMemory, type DeskAlert } from "./types";

const KEY = "nexus-alerts";

export function loadAlertMemory(): AlertMemory {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_ALERT_MEMORY;
    const parsed = JSON.parse(raw) as Partial<AlertMemory>;
    const alerts = Array.isArray(parsed.alerts) ? parsed.alerts.filter(isAlert) : [];
    return {
      alerts,
      primed: Boolean(parsed.primed),
      seenStrong: Array.isArray(parsed.seenStrong) ? parsed.seenStrong.filter((item) => typeof item === "string") : [],
      triggersPrimed: Boolean(parsed.triggersPrimed),
      seenTriggers: Array.isArray(parsed.seenTriggers) ? parsed.seenTriggers.filter((item) => typeof item === "string") : [],
      seenReviews: Array.isArray(parsed.seenReviews) ? parsed.seenReviews.filter((item) => typeof item === "string") : [],
    };
  } catch {
    return EMPTY_ALERT_MEMORY;
  }
}

export function saveAlertMemory(memory: AlertMemory) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // The desk still shows the alerts for this page load.
  }
}

function isAlert(value: unknown): value is DeskAlert {
  if (!value || typeof value !== "object") return false;
  const alert = value as Partial<DeskAlert>;
  return typeof alert.id === "string" && typeof alert.symbol === "string" && typeof alert.message === "string" && typeof alert.createdAt === "string";
}
