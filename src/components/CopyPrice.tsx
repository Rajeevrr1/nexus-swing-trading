import { useState } from "react";
import { formatInr } from "../analysis";

export type CopyPriceVariant = "entry" | "max-buy" | "target" | "gtt" | "sl";

const COPIED_MS = 1500;

export function CopyPrice({
  label,
  value,
  variant = "entry",
  prominent = false,
}: {
  label: string;
  value: number | null;
  variant?: CopyPriceVariant;
  /** @deprecated use variant */
  prominent?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (value == null || !Number.isFinite(value)) return null;
  const tone: CopyPriceVariant =
    prominent && variant === "entry" ? (label.toLowerCase().includes("gtt") ? "gtt" : "max-buy") : variant;
  return (
    <button
      type="button"
      className={`copy-price is-${tone}${copied ? " is-copied" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        const text = value.toFixed(2);
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), COPIED_MS);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? (
        <span className="copy-cue is-success">COPIED ✓</span>
      ) : (
        <>
          <span className="copy-price-label">
            {tone === "max-buy" && !label.includes("🛡️")
              ? `🛡️ ${label}`
              : tone === "sl" && !label.includes("🛑")
                ? `🛑 ${label}`
                : tone === "target" && !label.includes("🎯")
                  ? `🎯 ${label}`
                  : label}
          </span>
          <span className="num">{formatInr(value)}</span>
          <span className="copy-cue">Copy</span>
        </>
      )}
    </button>
  );
}
