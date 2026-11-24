export type AlertType = "exit" | "strong" | "book" | "caution" | "prime" | "standard" | "review";

export interface DeskAlert {
  id: string;
  type: AlertType;
  symbol: string;
  name: string;
  message: string;
  createdAt: string;
  read: boolean;
  active: boolean;
}

export interface AlertMemory {
  alerts: DeskAlert[];
  primed: boolean;
  seenStrong: string[];
  triggersPrimed: boolean;
  seenTriggers: string[];
  /** Symbols that already received the one-shot 10-session review. */
  seenReviews: string[];
}

export const EMPTY_ALERT_MEMORY: AlertMemory = {
  alerts: [],
  primed: false,
  seenStrong: [],
  triggersPrimed: false,
  seenTriggers: [],
  seenReviews: [],
};
