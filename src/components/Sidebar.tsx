import type { ReactNode } from "react";
import { useAlerts } from "../alerts/AlertsContext";
import { useMarketData } from "../market/MarketData";
import {
  IconAlerts,
  IconAnalysis,
  IconBacktest,
  IconJournal,
  IconOverview,
  IconPortfolio,
  IconRecommendations,
  IconSectors,
  IconSettings,
  IconNexusMark,
  IconWatchlist,
} from "./icons";

export type DeskView =
  | "overview"
  | "recommendations"
  | "analysis"
  | "portfolio"
  | "alerts"
  | "watchlist"
  | "sectors"
  | "journal"
  | "backtest"
  | "settings";

export const NAV_ITEMS: readonly {
  id: DeskView;
  label: string;
  hash: string;
  icon: ReactNode;
  placeholder: string | null;
}[] = [
  {
    id: "overview",
    label: "Overview",
    hash: "#/overview",
    icon: <IconOverview />,
    placeholder: null,
  },
  {
    id: "recommendations",
    label: "Recommendations",
    hash: "#/recommendations",
    icon: <IconRecommendations />,
    placeholder: null,
  },
  {
    id: "analysis",
    label: "Analysis",
    hash: "#/analysis",
    icon: <IconAnalysis />,
    placeholder: null,
  },
  {
    id: "portfolio",
    label: "Portfolio",
    hash: "#/portfolio",
    icon: <IconPortfolio />,
    placeholder: null,
  },
  {
    id: "alerts",
    label: "Alerts",
    hash: "#/alerts",
    icon: <IconAlerts />,
    placeholder: null,
  },
  {
    id: "watchlist",
    label: "Watchlist",
    hash: "#/watchlist",
    icon: <IconWatchlist />,
    placeholder: null,
  },
  {
    id: "sectors",
    label: "Sectors",
    hash: "#/sectors",
    icon: <IconSectors />,
    placeholder: null,
  },
  {
    id: "backtest",
    label: "Backtest",
    hash: "#/backtest",
    icon: <IconBacktest />,
    placeholder: null,
  },
  {
    id: "journal",
    label: "Journal",
    hash: "#/journal",
    icon: <IconJournal />,
    placeholder: null,
  },
  {
    id: "settings",
    label: "Settings",
    hash: "#/settings",
    icon: <IconSettings />,
    placeholder: null,
  },
];

export function Sidebar({ active }: { active: DeskView }) {
  const { unread } = useAlerts();
  const market = useMarketData();
  const live = market.status.connected && !market.needsReconnect;
  return (
    <aside className="sidebar">
      <a className="brand" href="#/overview">
        <span className="brand-mark" aria-hidden="true">
          <IconNexusMark />
        </span>
        <span className="brand-copy">
          <span className="brand-name">NEXUS</span>
          <span className="brand-sub">NSE swing desk</span>
        </span>
      </a>
      <nav className="nav" aria-label="Desk">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          return (
            <a
              key={item.id}
              href={item.hash}
              className={isActive ? "nav-item is-active" : "nav-item"}
              aria-current={isActive ? "page" : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === "alerts" && unread > 0 ? (
                <span className="nav-badge" aria-label={`${unread} unread alerts`}>
                  {unread}
                </span>
              ) : null}
            </a>
          );
        })}
      </nav>
      <p className={live ? "sidebar-note is-live" : "sidebar-note"}>{live ? "Live data from Kite" : "Connect Kite for live NSE prices"}</p>
    </aside>
  );
}
