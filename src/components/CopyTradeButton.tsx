import { useState } from "react";
import { executionClipboardText, type SwingSetup } from "../recommendations/setup";

const COPIED_MS = 1500;

export function CopyTradeButton({ symbol, setup }: { symbol: string; setup: SwingSetup }) {
  const [copied, setCopied] = useState(false);
  const payload = executionClipboardText({ symbol, setup });
  if (!payload) return null;
  return (
    <button
      type="button"
      className={copied ? "copy-trade is-copied" : "copy-trade"}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(payload).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), COPIED_MS);
          },
          () => setCopied(false),
        );
      }}
    >
      <svg className="copy-trade-icon" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      {copied ? "Copied" : "Copy trade"}
    </button>
  );
}
