import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function IconOverview() {
  return (
    <Icon>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

export function IconRecommendations() {
  return (
    <Icon>
      <path d="M12 3.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7L12 14.3 7.8 16.5l.8-4.7L5.2 8.5l4.7-.7L12 3.5z" />
    </Icon>
  );
}

export function IconPortfolio() {
  return (
    <Icon>
      <rect x="3.5" y="7" width="17" height="12.5" rx="1.5" />
      <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" />
      <path d="M3.5 12.5h17" />
    </Icon>
  );
}

export function IconWatchlist() {
  return (
    <Icon>
      <path d="M5 6.5h14M5 12h14M5 17.5h9" />
    </Icon>
  );
}

export function IconSectors() {
  return (
    <Icon>
      <path d="M4 19.5V10M10 19.5V4.5M16 19.5v-7M22 19.5H2" />
    </Icon>
  );
}

export function IconJournal() {
  return (
    <Icon>
      <path d="M7 4.5h10.5a1 1 0 0 1 1 1V19.5H8.5A2.5 2.5 0 0 1 6 17V5.5a1 1 0 0 1 1-1z" />
      <path d="M6 17a2.5 2.5 0 0 1 2.5-2.5H18.5" />
    </Icon>
  );
}

export function IconAlerts() {
  return (
    <Icon>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13.5 6 9.5z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </Icon>
  );
}

export function IconBacktest() {
  return (
    <Icon>
      <path d="M4 16.5l4.2-5 3.2 3.2L16 7.5" />
      <path d="M13.5 7.5H16V10" />
      <path d="M4 19.5h16" />
    </Icon>
  );
}

export function IconSettings() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.8 6.8l1.6 1.6M17.6 15.6l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.8 17.2l1.6-1.6M17.6 8.4l1.6-1.6" />
    </Icon>
  );
}

export function IconBack() {
  return (
    <Icon width="16" height="16">
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </Icon>
  );
}

export function IconClose() {
  return (
    <Icon width="16" height="16">
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

/** Institutional NEXUS mark: minimal geometric “N”. */
export function IconNexusMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6 18.75V5.25h3.15L15 13.9V5.25h3v13.5h-3.15L9 10.1v8.65H6z"
      />
    </svg>
  );
}

/** @deprecated Prefer IconNexusMark for brand; kept for any legacy references. */
export function IconStockMarket() {
  return <IconNexusMark />;
}

export function IconHold() {
  return (
    <Icon width="16" height="16">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </Icon>
  );
}

export function IconAverage() {
  return (
    <Icon width="16" height="16">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </Icon>
  );
}

export function IconSell() {
  return (
    <Icon width="16" height="16">
      <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2z" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </Icon>
  );
}

export function IconTrim() {
  return (
    <Icon width="16" height="16">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
    </Icon>
  );
}

export function IconChevronDown() {
  return (
    <Icon width="14" height="14">
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function IconChevronUp() {
  return (
    <Icon width="14" height="14">
      <path d="M18 15l-6-6-6 6" />
    </Icon>
  );
}

export function IconAnalysis() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 19V5M4 19h16M8 16V10M12 16V7M16 16v-5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconChart() {
  return (
    <Icon width="15" height="15">
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </Icon>
  );
}
