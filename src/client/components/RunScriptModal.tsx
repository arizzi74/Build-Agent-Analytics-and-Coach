import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface RunScriptModalProps {
  script: string;
  result: string;
  intent?: string;
  scope?: string;
  success: boolean;
  duration: number;
  onClose: () => void;
}

/** Format duration in ms to human readable */
function fmtDuration(ms: number): string {
  if (ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Try to pretty-format JSON inside the output string */
function formatOutput(raw: string): string {
  // Strip leading "*** Script: " prefix if present
  let cleaned = raw.replace(/^\*{3}\s*Script:\s*/i, "").trim();
  // Try to parse as JSON for pretty display
  try {
    const parsed = JSON.parse(cleaned);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return cleaned || raw;
  }
}

/** Strip the internal "// ba-run:..." comment line from the script */
function cleanScript(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("// ba-run:"))
    .join("\n")
    .trim();
}

/**
 * Full-page modal showing run_script tool invocation:
 * left column = script code, right column = result/output.
 * Portalled to document.body for true overlay.
 */
export default function RunScriptModal({
  script,
  result,
  intent,
  scope,
  success,
  duration,
  onClose,
}: RunScriptModalProps) {
  const [copiedPanel, setCopiedPanel] = useState<"script" | "result" | null>(null);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const displayScript = cleanScript(script);
  const displayResult = formatOutput(result);
  const durationLabel = fmtDuration(duration);

  async function copyToClipboard(text: string, panel: "script" | "result") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPanel(panel);
      setTimeout(() => setCopiedPanel(null), 2000);
    } catch {
      /* noop */
    }
  }

  return createPortal(
    <div className="ba-modal-overlay" onClick={onClose}>
      <div className="rs-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="rs-modal__header">
          <span className="rs-modal__icon">⚡</span>
          <span className="rs-modal__title">run_script</span>
          <span className={`rs-modal__status ${success ? "rs-modal__status--ok" : "rs-modal__status--fail"}`}>
            {success ? "✓ Success" : "✗ Failed"}
          </span>
          {scope && <span className="rs-modal__scope">{scope}</span>}
          {durationLabel && <span className="rs-modal__duration">{durationLabel}</span>}
          <button className="ba-modal__close" onClick={onClose} type="button" aria-label="Close">
            ✕
          </button>
        </div>

        {/* ── Intent banner ── */}
        {intent && (
          <div className="rs-modal__intent">
            <span className="rs-modal__intent-label">Intent:</span>
            <span className="rs-modal__intent-text">{intent}</span>
          </div>
        )}

        {/* ── Two-column body ── */}
        <div className="rs-modal__body">
          {/* Left: Script */}
          <div className="rs-modal__panel">
            <div className="rs-modal__panel-header">
              <span className="rs-modal__panel-icon">📜</span>
              <span className="rs-modal__panel-title">Script</span>
              <button
                className={`rs-modal__copy ${copiedPanel === "script" ? "rs-modal__copy--done" : ""}`}
                onClick={() => copyToClipboard(displayScript, "script")}
                type="button"
                title="Copy script"
              >
                {copiedPanel === "script" ? "✓ Copied" : "📋 Copy"}
              </button>
            </div>
            <pre className="rs-modal__code">
              <code>{displayScript}</code>
            </pre>
          </div>

          {/* Right: Result */}
          <div className="rs-modal__panel">
            <div className="rs-modal__panel-header">
              <span className="rs-modal__panel-icon">📤</span>
              <span className="rs-modal__panel-title">Result</span>
              <button
                className={`rs-modal__copy ${copiedPanel === "result" ? "rs-modal__copy--done" : ""}`}
                onClick={() => copyToClipboard(displayResult, "result")}
                type="button"
                title="Copy result"
              >
                {copiedPanel === "result" ? "✓ Copied" : "📋 Copy"}
              </button>
            </div>
            <pre className={`rs-modal__code ${!success ? "rs-modal__code--error" : ""}`}>
              <code>{displayResult}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
