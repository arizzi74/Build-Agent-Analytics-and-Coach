/**
 * conversationExport.ts
 *
 * Generates a self-contained HTML document with the full conversation transcript,
 * ready to be opened in a new tab for printing / saving as PDF.
 *
 * Includes: metadata header, KPI summary, token usage, NAU breakdown,
 * and EVERY message (user, assistant with rendered markdown, thinking blocks,
 * tool calls with inputs and results).
 */

import { marked } from "marked";
import { display, parseMessageContent } from "./fields.ts";
import type { ToolDetails, FileAttachment, NauBreakdown } from "./fields.ts";
import { analyzeConversation, analyzeMessage, formatTokenCount, formatEstimate } from "./tokenEstimation.ts";
import type { ConversationTokenUsage, MessageTokenInfo } from "./tokenEstimation.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExportConversationData {
  conversation: any;
  messages: any[];
  userCount: number;
  assistantCount: number;
  tokenUsage: ConversationTokenUsage | null;
  nauBreakdown: NauBreakdown | null;
}

interface ExportBTSMessage {
  sender: string;
  text: string;
  toolName?: string;
  tokenInfo?: MessageTokenInfo | null;
  toolDetails?: ToolDetails;
}

interface ExportBTSBlock {
  type: "behind-the-scenes";
  messages: ExportBTSMessage[];
}

interface ExportChatBubble {
  type: "user" | "assistant";
  text: string;
  tokenInfo?: MessageTokenInfo | null;
  images?: Array<{ url: string }>;
  files?: FileAttachment[];
}

type ExportItem = ExportBTSBlock | ExportChatBubble;

// ─── Grouping (same logic as ConversationDetail) ─────────────────────────────

function groupMessagesForExport(rawMessages: any[]): ExportItem[] {
  const items: ExportItem[] = [];
  let pendingBTS: ExportBTSMessage[] = [];

  function flushBTS() {
    if (pendingBTS.length > 0) {
      items.push({ type: "behind-the-scenes", messages: [...pendingBTS] });
      pendingBTS = [];
    }
  }

  for (const msg of rawMessages) {
    const parsed = parseMessageContent(msg.content);
    if (!parsed) continue;

    const tokenInfo = analyzeMessage(msg);

    if (parsed.sender === "user") {
      flushBTS();
      items.push({ type: "user", text: parsed.text, tokenInfo, images: parsed.images, files: parsed.files });
    } else if (parsed.sender === "assistant") {
      flushBTS();
      items.push({ type: "assistant", text: parsed.text, tokenInfo });
    } else {
      pendingBTS.push({
        sender: parsed.sender,
        text: parsed.text,
        toolName: parsed.toolName,
        tokenInfo,
        toolDetails: parsed.toolDetails,
      });
    }
  }
  flushBTS();
  return items;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function renderMarkdownToHtml(md: string): string {
  const renderer = new marked.Renderer();
  renderer.code = function (code: string, infostring: string) {
    const lang = (infostring || "").trim().split(/\s+/)[0];
    if (lang === "mermaid") {
      // In the export we can't render mermaid diagrams, show source
      return `<pre class="code-block"><code class="language-mermaid">${esc(code)}</code></pre>`;
    }
    const langClass = lang ? ` class="language-${lang}"` : "";
    return `<pre class="code-block"><code${langClass}>${esc(code)}</code></pre>`;
  };

  const result = marked(md, { renderer, gfm: true, breaks: true });
  return typeof result === "string" ? result : "";
}

function truncateStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

/** Get key tool input display fields (mirrored from ConversationDetail) */
function getToolInputFields(name: string, input: Record<string, any>): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  // Simplified — show the most interesting params
  const interesting: Record<string, string> = {
    path: "Path", sourcePath: "Source", destinationPath: "Dest",
    oldPath: "From", newPath: "To", pattern: "Pattern",
    search: "Search", replace: "Replace", glob: "Glob",
    search_string: "Search", table: "Table", encodedQuery: "Query",
    query: "Query", limit: "Limit", tables: "Tables",
    contentMode: "Mode", changeSummary: "Summary", files: "Files",
    tableName: "Table", name: "Name/Topic", packageName: "Package",
    apiType: "Types", action: "Action", title: "Title",
    question: "Question", step: "Step", type: "Type",
    prompt: "Prompt", intent: "Intent", scope: "Scope",
    script: "Script",
  };

  for (const [k, label] of Object.entries(interesting)) {
    if (input[k] !== undefined && input[k] !== null && input[k] !== "") {
      let val: string;
      if (Array.isArray(input[k])) {
        val = input[k].join(", ");
      } else if (typeof input[k] === "object") {
        val = JSON.stringify(input[k]).slice(0, 120);
      } else {
        val = String(input[k]);
      }
      // Truncate scripts at a reasonable size for the export
      if (k === "script") {
        val = truncateStr(val, 500);
      } else {
        val = truncateStr(val, 200);
      }
      fields.push({ label, value: val });
    }
  }
  return fields.slice(0, 8); // Max 8 fields
}

// ─── HTML Renderers ──────────────────────────────────────────────────────────

function renderUserBubble(item: ExportChatBubble): string {
  const textHtml = item.text ? esc(item.text) : "<em>Empty message</em>";
  let imagesHtml = "";
  if (item.images && item.images.length > 0) {
    imagesHtml = `<div class="attachments">${item.images.map((img, i) =>
      `<img src="${esc(img.url)}" alt="Attachment ${i + 1}" class="attachment-thumb" />`
    ).join("")}</div>`;
  }
  let filesHtml = "";
  if (item.files && item.files.length > 0) {
    filesHtml = `<div class="file-list">${item.files.map(f =>
      `<span class="file-chip">📎 ${esc(f.name)}</span>`
    ).join("")}</div>`;
  }
  const tokenLabel = item.tokenInfo && item.tokenInfo.tokens > 0
    ? `<span class="token-badge token-badge--${item.tokenInfo.bucket}">~${formatTokenCount(item.tokenInfo.tokens)} tok</span>`
    : "";

  return `
    <div class="msg msg--user">
      <div class="msg__header">
        <span class="msg__role msg__role--user">👤 User</span>
        ${tokenLabel}
      </div>
      <div class="msg__body">
        <p class="msg__text">${textHtml}</p>
        ${imagesHtml}
        ${filesHtml}
      </div>
    </div>`;
}

function renderAssistantBubble(item: ExportChatBubble): string {
  const contentHtml = item.text ? renderMarkdownToHtml(item.text) : "<em>Empty message</em>";
  const tokenLabel = item.tokenInfo && item.tokenInfo.tokens > 0
    ? `<span class="token-badge token-badge--${item.tokenInfo.bucket}">~${formatTokenCount(item.tokenInfo.tokens)} tok</span>`
    : "";

  return `
    <div class="msg msg--assistant">
      <div class="msg__header">
        <span class="msg__role msg__role--assistant">🤖 Assistant</span>
        ${tokenLabel}
      </div>
      <div class="msg__body markdown-content">
        ${contentHtml}
      </div>
    </div>`;
}

function renderToolResult(result: string): string {
  if (!result || result.length === 0) return "";
  const trimmed = result.trim();
  const isJson = (trimmed.startsWith("{") || trimmed.startsWith("[")) && (trimmed.endsWith("}") || trimmed.endsWith("]"));
  let displayResult: string;
  if (isJson) {
    try {
      const parsed = JSON.parse(trimmed);
      displayResult = JSON.stringify(parsed, null, 2);
    } catch {
      displayResult = trimmed;
    }
  } else {
    displayResult = trimmed;
  }
  // Cap result length for readability
  if (displayResult.length > 3000) {
    displayResult = displayResult.slice(0, 3000) + "\n\n… [truncated — " + (displayResult.length / 1024).toFixed(1) + "KB total]";
  }
  return `
    <details class="tool-result">
      <summary>📋 Result (${result.length > 1024 ? (result.length / 1024).toFixed(1) + "KB" : result.length + " chars"})</summary>
      <pre class="tool-result__content"><code>${esc(displayResult)}</code></pre>
    </details>`;
}

function renderBTSBlock(block: ExportBTSBlock): string {
  const thinkingCount = block.messages.filter(m => m.sender === "assistant-thinking").length;
  const toolCount = block.messages.filter(m => m.sender === "assistant-tool").length;
  const totalDuration = block.messages.reduce((sum, m) => sum + (m.toolDetails?.duration || 0), 0);
  const failedTools = block.messages.filter(m => m.toolDetails && !m.toolDetails.success).length;

  let summary = "";
  if (thinkingCount > 0 && toolCount > 0) {
    summary = `${thinkingCount} reasoning · ${toolCount} tool call${toolCount > 1 ? "s" : ""}`;
  } else if (thinkingCount > 0) {
    summary = `${thinkingCount} reasoning step${thinkingCount > 1 ? "s" : ""}`;
  } else {
    summary = `${toolCount} tool call${toolCount > 1 ? "s" : ""}`;
  }

  const failBadge = failedTools > 0 ? `<span class="bts-fail-badge">⚠ ${failedTools} failed</span>` : "";
  const durationBadge = totalDuration > 0 ? `<span class="bts-duration">${formatDuration(totalDuration)}</span>` : "";

  const itemsHtml = block.messages.map(m => {
    if (m.sender === "assistant-thinking") {
      const thinkText = m.text
        ? `<p class="thinking-text">${esc(truncateStr(m.text, 2000))}</p>`
        : "";
      return `
        <div class="bts-item bts-item--thinking">
          <span class="bts-item__icon">🧠</span>
          <div class="bts-item__body">
            <span class="bts-item__label">Thinking</span>
            ${thinkText}
          </div>
        </div>`;
    }
    // Tool call
    const td = m.toolDetails;
    if (!td) {
      return `
        <div class="bts-item bts-item--tool">
          <span class="bts-item__icon">🔧</span>
          <div class="bts-item__body">
            <span class="bts-item__label">${esc(m.toolName || "Tool Call")}</span>
            ${m.text ? `<p class="tool-text">${esc(truncateStr(m.text, 500))}</p>` : ""}
          </div>
        </div>`;
    }

    const statusIcon = td.success ? "✅" : "❌";
    const durationLabel = td.duration > 0 ? `<span class="tool-duration">${formatDuration(td.duration)}</span>` : "";
    const inputFields = getToolInputFields(td.toolActualName, td.toolInput);
    const inputHtml = inputFields.length > 0
      ? `<div class="tool-inputs">${inputFields.map(f =>
          `<div class="tool-param"><span class="tool-param__label">${esc(f.label)}:</span> <code class="tool-param__value">${esc(f.value)}</code></div>`
        ).join("")}</div>`
      : "";
    const resultHtml = renderToolResult(td.result);

    return `
      <div class="bts-item bts-item--tool ${!td.success ? "bts-item--failed" : ""}">
        <span class="bts-item__icon">🔧</span>
        <div class="bts-item__body">
          <div class="tool-header">
            <span class="tool-status">${statusIcon}</span>
            <code class="tool-name">${esc(td.toolActualName)}</code>
            ${durationLabel}
          </div>
          ${inputHtml}
          ${resultHtml}
        </div>
      </div>`;
  }).join("\n");

  return `
    <div class="bts-block">
      <div class="bts-block__header">
        <span class="bts-block__icon">⚙️</span>
        <span class="bts-block__label">Agent Processing</span>
        <span class="bts-block__summary">${summary}</span>
        ${failBadge}
        ${durationBadge}
      </div>
      <div class="bts-block__items">
        ${itemsHtml}
      </div>
    </div>`;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

function getEmbeddedCSS(): string {
  return `
    :root {
      --bg: #f8f9fc;
      --text: #1a1a2e;
      --muted: #6b7280;
      --accent: #4f46e5;
      --accent-light: #eef2ff;
      --user-bg: #e8f5e9;
      --user-border: #4caf50;
      --assistant-bg: #ffffff;
      --assistant-border: #6366f1;
      --bts-bg: #faf5ff;
      --bts-border: #c084fc;
      --success: #16a34a;
      --fail: #dc2626;
      --code-bg: #1e1e2e;
      --code-text: #cdd6f4;
      --card-shadow: 0 1px 3px rgba(0,0,0,0.08);
      --radius: 10px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.6;
      font-size: 14px;
      padding: 0;
    }

    .page {
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
    }

    /* ── Cover / Header ─────────────────────────────────── */
    .cover {
      text-align: center;
      padding: 2.5rem 2rem;
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #a855f7 100%);
      color: #fff;
      border-radius: var(--radius);
      margin-bottom: 2rem;
    }
    .cover__title {
      font-size: 1.75rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      line-height: 1.3;
    }
    .cover__subtitle {
      opacity: 0.85;
      font-size: 0.95rem;
    }
    .cover__meta {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 1.25rem;
      margin-top: 1.25rem;
      font-size: 0.85rem;
      opacity: 0.9;
    }
    .cover__meta-item {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    /* ── Detail Grid ────────────────────────────────────── */
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .detail-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 0.75rem 1rem;
    }
    .detail-card__label {
      display: block;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      margin-bottom: 0.2rem;
    }
    .detail-card__value {
      font-weight: 600;
      font-size: 0.9rem;
    }

    /* ── KPI Row ────────────────────────────────────────── */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .kpi-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }
    .kpi-card__value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent);
      display: block;
    }
    .kpi-card__label {
      font-size: 0.75rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /* ── Token Summary ──────────────────────────────────── */
    .token-box {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1.5rem;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 0.85rem;
    }
    .token-box__header {
      font-weight: 600;
      margin-bottom: 0.5rem;
      font-family: inherit;
      font-size: 0.9rem;
      color: var(--text);
    }
    .token-box__row { color: var(--muted); padding-left: 1rem; line-height: 1.8; }
    .token-box__val--input { color: #2563eb; }
    .token-box__val--output { color: #059669; }
    .token-box__val--thinking { color: #9333ea; }

    /* ── Section Headings ───────────────────────────────── */
    .section-title {
      font-size: 1.1rem;
      font-weight: 700;
      padding-bottom: 0.35rem;
      border-bottom: 2px solid var(--accent);
      margin-bottom: 1.25rem;
      color: var(--text);
    }

    /* ── Messages ───────────────────────────────────────── */
    .msg {
      border-radius: var(--radius);
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      box-shadow: var(--card-shadow);
      page-break-inside: avoid;
    }
    .msg__header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .msg__role {
      font-weight: 700;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .msg__role--user { color: var(--user-border); }
    .msg__role--assistant { color: var(--assistant-border); }
    .msg--user {
      background: var(--user-bg);
      border-left: 4px solid var(--user-border);
    }
    .msg--assistant {
      background: var(--assistant-bg);
      border-left: 4px solid var(--assistant-border);
    }
    .msg__text {
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .token-badge {
      font-size: 0.7rem;
      padding: 0.15rem 0.5rem;
      border-radius: 1rem;
      font-weight: 500;
    }
    .token-badge--input { background: #dbeafe; color: #1e40af; }
    .token-badge--output { background: #d1fae5; color: #065f46; }
    .token-badge--thinking { background: #ede9fe; color: #5b21b6; }

    /* ── Attachments ────────────────────────────────────── */
    .attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
    .attachment-thumb {
      max-width: 200px;
      max-height: 150px;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
    }
    .file-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.5rem;
    }
    .file-chip {
      background: #f3f4f6;
      padding: 0.2rem 0.6rem;
      border-radius: 1rem;
      font-size: 0.8rem;
      border: 1px solid #e5e7eb;
    }

    /* ── BTS Blocks ─────────────────────────────────────── */
    .bts-block {
      background: var(--bts-bg);
      border: 1px solid var(--bts-border);
      border-radius: var(--radius);
      margin-bottom: 1rem;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .bts-block__header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: rgba(192,132,252,0.1);
      border-bottom: 1px solid var(--bts-border);
      font-size: 0.85rem;
      font-weight: 600;
    }
    .bts-block__summary { color: var(--muted); font-weight: 400; }
    .bts-fail-badge { color: var(--fail); font-weight: 600; }
    .bts-duration { color: var(--muted); font-size: 0.8rem; }
    .bts-block__items { padding: 0.75rem 1rem; }

    .bts-item {
      display: flex;
      gap: 0.5rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(192,132,252,0.15);
    }
    .bts-item:last-child { border-bottom: none; }
    .bts-item__icon { font-size: 1rem; flex-shrink: 0; margin-top: 2px; }
    .bts-item__body { flex: 1; min-width: 0; }
    .bts-item__label { font-weight: 600; font-size: 0.85rem; }
    .bts-item--failed { background: rgba(220,38,38,0.05); border-radius: 6px; padding: 0.5rem; }

    .thinking-text {
      margin-top: 0.35rem;
      font-style: italic;
      color: var(--muted);
      font-size: 0.85rem;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .tool-text {
      margin-top: 0.25rem;
      font-size: 0.85rem;
      color: var(--muted);
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .tool-header {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .tool-status { font-size: 0.85rem; }
    .tool-name {
      font-size: 0.85rem;
      background: rgba(99,102,241,0.08);
      padding: 0.1rem 0.45rem;
      border-radius: 4px;
      font-weight: 600;
    }
    .tool-duration {
      font-size: 0.75rem;
      color: var(--muted);
      margin-left: auto;
    }

    .tool-inputs {
      margin-top: 0.35rem;
      padding-left: 0.25rem;
    }
    .tool-param {
      font-size: 0.8rem;
      line-height: 1.6;
      color: var(--muted);
    }
    .tool-param__label { font-weight: 600; color: #6b7280; }
    .tool-param__value {
      font-size: 0.78rem;
      background: rgba(0,0,0,0.04);
      padding: 0.05rem 0.3rem;
      border-radius: 3px;
      word-break: break-all;
    }

    .tool-result { margin-top: 0.35rem; }
    .tool-result summary {
      cursor: pointer;
      font-size: 0.8rem;
      color: var(--accent);
      font-weight: 500;
    }
    .tool-result__content {
      margin-top: 0.35rem;
      background: var(--code-bg);
      color: var(--code-text);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      font-size: 0.75rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-height: 400px;
      overflow-y: auto;
    }

    /* ── Markdown Content ───────────────────────────────── */
    .markdown-content h1, .markdown-content h2, .markdown-content h3,
    .markdown-content h4, .markdown-content h5, .markdown-content h6 {
      margin-top: 0.75em; margin-bottom: 0.35em;
      line-height: 1.3;
    }
    .markdown-content p { margin-bottom: 0.5em; }
    .markdown-content ul, .markdown-content ol {
      padding-left: 1.5em; margin-bottom: 0.5em;
    }
    .markdown-content li { margin-bottom: 0.2em; }
    .markdown-content blockquote {
      border-left: 3px solid #c7d2fe;
      padding: 0.25em 0.75em;
      margin: 0.5em 0;
      color: var(--muted);
      background: #f5f3ff;
      border-radius: 0 6px 6px 0;
    }
    .markdown-content a { color: var(--accent); text-decoration: underline; }
    .markdown-content table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.5em 0;
      font-size: 0.85rem;
    }
    .markdown-content th, .markdown-content td {
      border: 1px solid #e5e7eb;
      padding: 0.4em 0.75em;
      text-align: left;
    }
    .markdown-content th { background: #f9fafb; font-weight: 600; }
    .markdown-content code {
      background: #f3f4f6;
      padding: 0.1em 0.35em;
      border-radius: 3px;
      font-size: 0.9em;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    }
    .markdown-content pre { margin: 0.5em 0; }
    .code-block {
      background: var(--code-bg);
      color: var(--code-text);
      padding: 1rem 1.25rem;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 0.82rem;
      line-height: 1.5;
    }
    .code-block code {
      background: transparent;
      padding: 0;
      color: inherit;
      font-size: inherit;
    }
    .markdown-content img {
      max-width: 100%;
      border-radius: 6px;
    }

    /* ── Footer ─────────────────────────────────────────── */
    .export-footer {
      text-align: center;
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #e5e7eb;
      font-size: 0.75rem;
      color: var(--muted);
    }

    /* ── Toolbar (hidden in print) ──────────────────────── */
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(255,255,255,0.95);
      backdrop-filter: blur(8px);
      padding: 0.75rem 2rem;
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      border-bottom: 1px solid #e5e7eb;
    }
    .toolbar__btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid #d1d5db;
      background: #fff;
      color: var(--text);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .toolbar__btn:hover {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .toolbar__btn--primary {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .toolbar__btn--primary:hover {
      background: #4338ca;
    }

    /* ── Print ──────────────────────────────────────────── */
    @media print {
      body { background: #fff; font-size: 11px; }
      .toolbar { display: none !important; }
      .page { max-width: 100%; padding: 0; }
      .cover {
        background: #4f46e5 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .msg, .bts-block { box-shadow: none; page-break-inside: avoid; }
      .tool-result__content { max-height: none; }
      .code-block {
        background: #f3f4f6 !important;
        color: #1a1a2e !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .msg--user {
        background: #e8f5e9 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .bts-block {
        background: #faf5ff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .detail-card, .kpi-card, .token-box {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      a { color: var(--accent); text-decoration: none; }
      a[href]::after { content: none !important; }
      /* Open all details elements in print */
      details { display: block !important; }
      details[open] summary { margin-bottom: 0.35rem; }
      details > *:not(summary) { display: block !important; }
    }

    @page {
      margin: 1.5cm;
      size: A4;
    }
  `;
}

// ─── Main Export Function ────────────────────────────────────────────────────

export function exportConversationAsHtml(data: ExportConversationData): void {
  const { conversation, messages, userCount, assistantCount, tokenUsage, nauBreakdown } = data;

  const title = display(conversation.title) || "Untitled Conversation";
  const appName = display(conversation.application_name) || "—";
  const author = display(conversation.user) || "Unknown";
  const state = display(conversation.state) || "—";
  const client = display(conversation.client) || "—";
  const createdOn = display(conversation.sys_created_on) || "—";

  const NOWASSIST_UNIT_COST = 25;
  const nowAssistUnits = nauBreakdown ? nauBreakdown.totalNau : userCount * NOWASSIST_UNIT_COST;

  const items = groupMessagesForExport(messages);

  // Build conversation body
  const conversationHtml = items.map(item => {
    if (item.type === "user") return renderUserBubble(item as ExportChatBubble);
    if (item.type === "assistant") return renderAssistantBubble(item as ExportChatBubble);
    return renderBTSBlock(item as ExportBTSBlock);
  }).join("\n");

  // Token summary
  let tokenHtml = "";
  if (tokenUsage && tokenUsage.total > 0) {
    tokenHtml = `
      <div class="token-box">
        <div class="token-box__header">📊 Token Usage (est.) — ${formatEstimate(tokenUsage.total)} tokens</div>
        <div class="token-box__row">├─ input: <span class="token-box__val--input">${formatTokenCount(tokenUsage.input)}</span></div>
        <div class="token-box__row">├─ output: <span class="token-box__val--output">${formatTokenCount(tokenUsage.output)}</span></div>
        <div class="token-box__row">└─ thinking: <span class="token-box__val--thinking">${formatTokenCount(tokenUsage.thinking)}</span></div>
      </div>`;
  }

  // NAU breakdown
  let nauHtml = "";
  if (nauBreakdown && nauBreakdown.totalInteractions > 0) {
    const rows = [
      { label: "User Messages", count: nauBreakdown.userMessages, nau: nauBreakdown.userMessages * 25 },
      { label: "Installs", count: nauBreakdown.installs, nau: nauBreakdown.installs * 25 },
      { label: "Planning", count: nauBreakdown.planning, nau: nauBreakdown.planning * 25 },
      { label: "App Creations", count: nauBreakdown.appCreations, nau: nauBreakdown.appCreations * 25 },
      { label: "Interviews", count: nauBreakdown.interviews, nau: nauBreakdown.interviews * 25 },
    ].filter(r => r.count > 0);

    nauHtml = `
      <div class="token-box" style="margin-bottom: 1.5rem;">
        <div class="token-box__header">💰 NAU Breakdown — ${nowAssistUnits.toLocaleString("de-DE")} units total</div>
        ${rows.map(r => `<div class="token-box__row">· ${r.label}: ${r.count} × 25 = <strong>${r.nau.toLocaleString("de-DE")}</strong> NAU</div>`).join("\n")}
      </div>`;
  }

  const exportDate = new Date().toLocaleString("en-GB", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} — Conversation Export</title>
  <style>${getEmbeddedCSS()}</style>
</head>
<body>
  <div class="toolbar">
    <button class="toolbar__btn" onclick="window.close()" type="button">✕ Close</button>
    <button class="toolbar__btn toolbar__btn--primary" onclick="window.print()" type="button">🖨️ Print / Save PDF</button>
  </div>
  <div class="page">
    <div class="cover">
      <div class="cover__title">${esc(title)}</div>
      <div class="cover__subtitle">Build Agent Conversation Transcript</div>
      <div class="cover__meta">
        <span class="cover__meta-item">👤 ${esc(author)}</span>
        <span class="cover__meta-item">📱 ${esc(appName)}</span>
        <span class="cover__meta-item">📅 ${esc(createdOn)}</span>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-card">
        <span class="detail-card__label">Application</span>
        <span class="detail-card__value">${esc(appName)}</span>
      </div>
      <div class="detail-card">
        <span class="detail-card__label">Author</span>
        <span class="detail-card__value">${esc(author)}</span>
      </div>
      <div class="detail-card">
        <span class="detail-card__label">State</span>
        <span class="detail-card__value">${esc(state)}</span>
      </div>
      <div class="detail-card">
        <span class="detail-card__label">Client</span>
        <span class="detail-card__value">${esc(client)}</span>
      </div>
      <div class="detail-card">
        <span class="detail-card__label">Created</span>
        <span class="detail-card__value">${esc(createdOn)}</span>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card">
        <span class="kpi-card__value">${userCount}</span>
        <span class="kpi-card__label">User Messages</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-card__value">${assistantCount}</span>
        <span class="kpi-card__label">Assistant Messages</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-card__value">${messages.length}</span>
        <span class="kpi-card__label">Total Messages</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-card__value">${nowAssistUnits.toLocaleString("de-DE")}</span>
        <span class="kpi-card__label">NAU Units</span>
      </div>
    </div>

    ${tokenHtml}
    ${nauHtml}

    <h2 class="section-title">💬 Conversation Transcript</h2>
    ${conversationHtml}

    <div class="export-footer">
      Exported on ${esc(exportDate)} · Build Agent Analytics · ${messages.length} messages
    </div>
  </div>

  <script>
    // Auto-open all details elements for a complete view
    document.querySelectorAll('details').forEach(d => d.setAttribute('open', ''));
  </script>
</body>
</html>`;

  // Open in a new tab and write the HTML directly (avoids blob: URL CSP issues)
  const win = window.open("", "_blank");
  if (win) {
    win.document.open();
    win.document.write(fullHtml);
    win.document.close();
  }
}
