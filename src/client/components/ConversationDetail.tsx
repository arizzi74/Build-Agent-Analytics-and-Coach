import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { display, value, parseMessageContent, countMessagesBySender, computeNauBreakdown } from "../utils/fields.ts";
import type { ToolDetails, FileAttachment, NauBreakdown } from "../utils/fields.ts";
import { fetchConversation, fetchMessages } from "../services/api.ts";
import { analyzeConversation, analyzeMessage, formatEstimate, formatTokenCount } from "../utils/tokenEstimation.ts";
import type { ConversationTokenUsage, MessageTokenInfo } from "../utils/tokenEstimation.ts";
import KpiCard from "./KpiCard.tsx";
import MarkdownRenderer from "./MarkdownRenderer.tsx";
import { NauBreakdownPanel } from "./NauBreakdown.tsx";
import RunScriptModal from "./RunScriptModal.tsx";
import { exportConversationAsHtml } from "../utils/conversationExport.ts";
import ConversationCoaching from "./ConversationCoaching.tsx";

interface ConversationDetailProps {
  conversationId: string;
  onNavigate: (view: string, id?: string) => void;
}

/** Represents a grouped block of behind-the-scenes messages */
interface BehindTheScenesBlock {
  type: "behind-the-scenes";
  messages: Array<{ sender: string; text: string; toolName?: string; tokenInfo?: MessageTokenInfo | null; toolDetails?: ToolDetails }>;
}

/** Represents a visible chat message (user or assistant) */
interface ChatBubble {
  type: "user" | "assistant";
  text: string;
  tokenInfo?: MessageTokenInfo | null;
  images?: Array<{ url: string }>;
  files?: FileAttachment[];
}

type ConversationItem = BehindTheScenesBlock | ChatBubble;

/**
 * Groups raw messages into conversation items with token info:
 * - user/assistant messages become ChatBubbles
 * - consecutive thinking/tool messages are grouped into BehindTheScenesBlocks
 */
function groupMessages(rawMessages: any[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  let pendingBTS: BehindTheScenesBlock["messages"] = [];

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
      // assistant-thinking or assistant-tool
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

/** Inline token badge component */
function TokenBadge({ info }: { info: MessageTokenInfo | null | undefined }) {
  if (!info || info.tokens === 0) return null;
  return (
    <span className={`token-badge token-badge--${info.bucket}`}>
      {info.bucket}: ~{formatTokenCount(info.tokens)}
    </span>
  );
}

/** Copy message button component */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy message:", err);
    }
  }

  return (
    <button
      className={`chat-copy-btn ${copied ? "chat-copy-btn--copied" : ""}`}
      onClick={handleCopy}
      type="button"
      title={copied ? "Copied!" : "Copy message"}
      aria-label={copied ? "Copied!" : "Copy message"}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

/** Token usage summary tree component */
function TokenUsageSummary({ usage }: { usage: ConversationTokenUsage }) {
  return (
    <div className="token-summary">
      <div className="token-summary__header">
        <span className="token-summary__icon">📊</span>
        <span className="token-summary__title">Token Usage (est.)</span>
        <span className="token-summary__total">{formatEstimate(usage.total)} tokens</span>
      </div>
      <div className="token-summary__tree">
        <div className="token-summary__row">
          <span className="token-summary__branch">├─</span>
          <span className="token-summary__label">input:</span>
          <span className="token-summary__value token-summary__value--input">{formatTokenCount(usage.input)}</span>
        </div>
        <div className="token-summary__row">
          <span className="token-summary__branch">├─</span>
          <span className="token-summary__label">output:</span>
          <span className="token-summary__value token-summary__value--output">{formatTokenCount(usage.output)}</span>
        </div>
        <div className="token-summary__row">
          <span className="token-summary__branch">└─</span>
          <span className="token-summary__label">thinking:</span>
          <span className="token-summary__value token-summary__value--thinking">{formatTokenCount(usage.thinking)}</span>
        </div>
      </div>
    </div>
  );
}

/** Format duration in ms to human readable */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Get the category for a tool to decide what to show */
function getToolCategory(name: string): "filesystem" | "query" | "build" | "docs" | "planning" | "agent" | "script" | "external" | "other" {
  if (name.startsWith("fs_") || name === "local_search") return "filesystem";
  if (["run_query", "keyword_search", "semantic_search", "get_table_schema"].includes(name)) return "query";
  if (["build", "install", "run_diagnostics", "install_dependencies", "ui_diagnostics"].includes(name)) return "build";
  if (["explain_fluent_doc", "search_fluent_docs", "get_knowledge_source", "package_docs"].includes(name)) return "docs";
  if (["planning", "interview"].includes(name)) return "planning";
  if (name === "agent") return "agent";
  if (["run_script", "rollback_script"].includes(name)) return "script";
  if (name.includes("__")) return "external";
  return "other";
}

/** Parse an external tool name (server__tool pattern) into server and tool parts */
function parseExternalToolName(name: string): { server: string; tool: string } | null {
  const idx = name.indexOf("__");
  if (idx <= 0) return null;
  return {
    server: name.slice(0, idx),
    tool: name.slice(idx + 2),
  };
}

/** Get key input fields to display based on tool type */
function getToolInputDisplay(name: string, input: Record<string, any>): Array<{ label: string; value: string; mono?: boolean }> {
  const fields: Array<{ label: string; value: string; mono?: boolean }> = [];
  const category = getToolCategory(name);

  switch (category) {
    case "filesystem":
      if (input.path) fields.push({ label: "Path", value: input.path, mono: true });
      if (input.sourcePath) fields.push({ label: "Source", value: input.sourcePath, mono: true });
      if (input.destinationPath) fields.push({ label: "Dest", value: input.destinationPath, mono: true });
      if (input.oldPath) fields.push({ label: "From", value: input.oldPath, mono: true });
      if (input.newPath) fields.push({ label: "To", value: input.newPath, mono: true });
      if (input.pattern) fields.push({ label: "Pattern", value: input.pattern, mono: true });
      if (input.search) fields.push({ label: "Search", value: truncateStr(input.search, 80), mono: true });
      if (input.replace !== undefined) fields.push({ label: "Replace", value: truncateStr(input.replace, 80), mono: true });
      if (input.glob) fields.push({ label: "Glob", value: input.glob, mono: true });
      if (input.search_string) fields.push({ label: "Search", value: input.search_string });
      if (input.maxDepth) fields.push({ label: "Depth", value: String(input.maxDepth) });
      break;
    case "query":
      if (input.table) fields.push({ label: "Table", value: input.table, mono: true });
      if (input.encodedQuery) fields.push({ label: "Query", value: input.encodedQuery, mono: true });
      if (input.query) fields.push({ label: "Query", value: input.query });
      if (input.limit) fields.push({ label: "Limit", value: String(input.limit) });
      if (input.tables) fields.push({ label: "Tables", value: input.tables, mono: true });
      if (input.contentMode) fields.push({ label: "Mode", value: input.contentMode });
      break;
    case "build":
      if (input.path && input.path !== ".") fields.push({ label: "Path", value: input.path, mono: true });
      if (input.changeSummary) fields.push({ label: "Summary", value: truncateStr(input.changeSummary, 120) });
      if (input.files) fields.push({ label: "Files", value: Array.isArray(input.files) ? input.files.join(", ") : input.files, mono: true });
      if (input.tableName) fields.push({ label: "Table", value: input.tableName, mono: true });
      break;
    case "docs":
      if (input.name) fields.push({ label: "Topic", value: input.name });
      if (input.query) fields.push({ label: "Query", value: input.query });
      if (input.packageName) fields.push({ label: "Package", value: input.packageName, mono: true });
      if (input.apiType) fields.push({ label: "Types", value: Array.isArray(input.apiType) ? input.apiType.join(", ") : input.apiType });
      break;
    case "planning":
      if (input.action) fields.push({ label: "Action", value: input.action });
      if (input.title) fields.push({ label: "Title", value: input.title });
      if (input.question) fields.push({ label: "Question", value: truncateStr(input.question, 100) });
      if (input.step) fields.push({ label: "Step", value: String(input.step) });
      if (input.steps && Array.isArray(input.steps)) fields.push({ label: "Steps", value: `${input.steps.length} steps` });
      break;
    case "agent":
      if (input.type) fields.push({ label: "Type", value: input.type });
      if (input.name) fields.push({ label: "Name", value: input.name });
      if (input.prompt) fields.push({ label: "Prompt", value: truncateStr(input.prompt, 100) });
      break;
    case "script":
      if (input.intent) fields.push({ label: "Intent", value: truncateStr(input.intent, 120) });
      if (input.scope) fields.push({ label: "Scope", value: input.scope });
      break;
    case "external": {
      // Show all input params generically (up to 6)
      Object.entries(input).slice(0, 6).forEach(([k, v]) => {
        const val = typeof v === "string" ? truncateStr(v, 80) : JSON.stringify(v).slice(0, 80);
        fields.push({ label: k, value: val });
      });
      break;
    }
    default:
      // For unknown tools, show all keys as-is (up to 5)
      Object.entries(input).slice(0, 5).forEach(([k, v]) => {
        const val = typeof v === "string" ? truncateStr(v, 80) : JSON.stringify(v).slice(0, 80);
        fields.push({ label: k, value: val });
      });
  }
  return fields;
}

function truncateStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

/** Detect if a string is valid JSON */
function isJsonString(s: string): boolean {
  const trimmed = s.trim();
  if ((!trimmed.startsWith("{") && !trimmed.startsWith("[")) || (!trimmed.endsWith("}") && !trimmed.endsWith("]"))) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Collapsible JSON tree node */
function JsonNode({ keyName, value: val, depth }: { keyName?: string; value: any; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2);

  if (val === null) {
    return (
      <div className="json-tree__leaf" style={{ paddingLeft: `${depth * 16}px` }}>
        {keyName !== undefined && <span className="json-tree__key">{keyName}: </span>}
        <span className="json-tree__null">null</span>
      </div>
    );
  }

  if (typeof val === "boolean") {
    return (
      <div className="json-tree__leaf" style={{ paddingLeft: `${depth * 16}px` }}>
        {keyName !== undefined && <span className="json-tree__key">{keyName}: </span>}
        <span className="json-tree__boolean">{val ? "true" : "false"}</span>
      </div>
    );
  }

  if (typeof val === "number") {
    return (
      <div className="json-tree__leaf" style={{ paddingLeft: `${depth * 16}px` }}>
        {keyName !== undefined && <span className="json-tree__key">{keyName}: </span>}
        <span className="json-tree__number">{val}</span>
      </div>
    );
  }

  if (typeof val === "string") {
    const display = val.length > 200 ? val.slice(0, 200) + "…" : val;
    return (
      <div className="json-tree__leaf" style={{ paddingLeft: `${depth * 16}px` }}>
        {keyName !== undefined && <span className="json-tree__key">{keyName}: </span>}
        <span className="json-tree__string">"{display}"</span>
      </div>
    );
  }

  if (Array.isArray(val)) {
    const count = val.length;
    return (
      <div className="json-tree__node" style={{ paddingLeft: `${depth * 16}px` }}>
        <button className="json-tree__toggle" onClick={() => setCollapsed(!collapsed)} type="button">
          <span className="json-tree__arrow">{collapsed ? "▸" : "▾"}</span>
          {keyName !== undefined && <span className="json-tree__key">{keyName}: </span>}
          <span className="json-tree__bracket">[</span>
          {collapsed && <span className="json-tree__preview">{count} items</span>}
          {collapsed && <span className="json-tree__bracket">]</span>}
        </button>
        {!collapsed && (
          <div className="json-tree__children">
            {val.map((item, i) => (
              <JsonNode key={i} keyName={String(i)} value={item} depth={depth + 1} />
            ))}
            <div className="json-tree__closing" style={{ paddingLeft: `${depth * 16}px` }}>
              <span className="json-tree__bracket">]</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (typeof val === "object") {
    const keys = Object.keys(val);
    return (
      <div className="json-tree__node" style={{ paddingLeft: `${depth * 16}px` }}>
        <button className="json-tree__toggle" onClick={() => setCollapsed(!collapsed)} type="button">
          <span className="json-tree__arrow">{collapsed ? "▸" : "▾"}</span>
          {keyName !== undefined && <span className="json-tree__key">{keyName}: </span>}
          <span className="json-tree__bracket">{"{"}</span>
          {collapsed && <span className="json-tree__preview">{keys.length} keys</span>}
          {collapsed && <span className="json-tree__bracket">{"}"}</span>}
        </button>
        {!collapsed && (
          <div className="json-tree__children">
            {keys.map((k) => (
              <JsonNode key={k} keyName={k} value={val[k]} depth={depth + 1} />
            ))}
            <div className="json-tree__closing" style={{ paddingLeft: `${depth * 16}px` }}>
              <span className="json-tree__bracket">{"}"}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="json-tree__leaf" style={{ paddingLeft: `${depth * 16}px` }}>
      {keyName !== undefined && <span className="json-tree__key">{keyName}: </span>}
      <span>{String(val)}</span>
    </div>
  );
}

/** Modal for displaying tool result content — portalled to document.body for true full-page overlay */
function ToolResultModal({ toolName, result, onClose }: { toolName: string; result: string; onClose: () => void }) {
  const isJson = isJsonString(result);
  let parsedJson: any = null;
  if (isJson) {
    try { parsedJson = JSON.parse(result.trim()); } catch { /* noop */ }
  }

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return createPortal(
    <div className="ba-modal-overlay" onClick={onClose}>
      <div className="tool-result-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tool-result-modal__header">
          <span className="tool-result-modal__icon">{isJson ? "🔖" : "📄"}</span>
          <span className="tool-result-modal__title">{toolName}</span>
          <span className="tool-result-modal__badge">{isJson ? "JSON" : "Text"}</span>
          <button className="ba-modal__close" onClick={onClose} type="button" aria-label="Close">✕</button>
        </div>
        <div className="tool-result-modal__body">
          {isJson && parsedJson !== null ? (
            <div className="json-tree">
              <JsonNode value={parsedJson} depth={0} />
            </div>
          ) : (
            <div className="tool-result-modal__markdown">
              <MarkdownRenderer content={"```\n" + result + "\n```"} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Render tool details: inputs, status, duration, modal result */
function ToolDetailsView({ details }: { details: ToolDetails }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [rsModalOpen, setRsModalOpen] = useState(false);
  const { toolActualName, toolInput, success, duration, result } = details;

  const inputFields = getToolInputDisplay(toolActualName, toolInput);
  const category = getToolCategory(toolActualName);
  const isRunScript = toolActualName === "run_script";
  const externalParts = category === "external" ? parseExternalToolName(toolActualName) : null;

  // Category-based icons
  const categoryIcons: Record<string, string> = {
    filesystem: "📁",
    query: "🔍",
    build: "🏗️",
    docs: "📖",
    planning: "📋",
    agent: "🤖",
    script: "⚡",
    external: "🔌",
    other: "⚡",
  };

  const resultLength = result?.length || 0;

  return (
    <div className={`tool-details ${!success ? "tool-details--failed" : ""}`}>
      {/* Header row: status + name + duration */}
      <div className="tool-details__header">
        <span className={`tool-details__status ${success ? "tool-details__status--ok" : "tool-details__status--fail"}`}>
          {success ? "✓" : "✗"}
        </span>
        <span className="tool-details__category-icon">{categoryIcons[category]}</span>
        {externalParts ? (
          <>
            <span className="tool-details__ext-server">{externalParts.server}</span>
            <span className="tool-details__ext-arrow">→</span>
            <code className="tool-details__name">{externalParts.tool}</code>
          </>
        ) : (
          <code className="tool-details__name">{toolActualName}</code>
        )}
        {duration > 0 && (
          <span className="tool-details__duration">{formatDuration(duration)}</span>
        )}
      </div>

      {/* Input parameters */}
      {inputFields.length > 0 && (
        <div className="tool-details__inputs">
          {inputFields.map((f, i) => (
            <div key={i} className="tool-details__param">
              <span className="tool-details__param-label">{f.label}:</span>
              {f.mono ? (
                <code className="tool-details__param-value tool-details__param-value--mono">{f.value}</code>
              ) : (
                <span className="tool-details__param-value">{f.value}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* run_script special trigger */}
      {isRunScript && toolInput.script && (
        <button
          className="rs-trigger"
          onClick={() => setRsModalOpen(true)}
          type="button"
        >
          <span className="rs-trigger__icon">⚡</span>
          <span>View Script &amp; Result</span>
        </button>
      )}

      {/* Result — opens modal (for non-run_script tools) */}
      {!isRunScript && result && resultLength > 0 && (
        <div className="tool-details__result">
          <button
            className="tool-details__result-toggle"
            onClick={() => setModalOpen(true)}
            type="button"
          >
            <span>📋</span>
            <span>View Result</span>
            <span className="tool-details__result-size">({resultLength > 1024 ? `${(resultLength / 1024).toFixed(1)}KB` : `${resultLength} chars`})</span>
          </button>
        </div>
      )}

      {/* Generic result modal */}
      {modalOpen && result && (
        <ToolResultModal toolName={toolActualName} result={result} onClose={() => setModalOpen(false)} />
      )}

      {/* RunScript modal */}
      {rsModalOpen && isRunScript && (
        <RunScriptModal
          script={toolInput.script || ""}
          result={result || ""}
          intent={toolInput.intent}
          scope={toolInput.scope}
          success={success}
          duration={duration}
          onClose={() => setRsModalOpen(false)}
        />
      )}
    </div>
  );
}

/** Collapsible "behind the scenes" block */
function BehindTheScenes({ messages }: { messages: BehindTheScenesBlock["messages"] }) {
  const [expanded, setExpanded] = useState(false);

  const thinkingCount = messages.filter(m => m.sender === "assistant-thinking").length;
  const toolCount = messages.filter(m => m.sender === "assistant-tool").length;

  // Sum tokens in this block
  const blockTokens = messages.reduce((sum, m) => sum + (m.tokenInfo?.tokens || 0), 0);

  // Sum durations from tool details
  const totalDuration = messages.reduce((sum, m) => sum + (m.toolDetails?.duration || 0), 0);
  const failedTools = messages.filter(m => m.toolDetails && !m.toolDetails.success).length;

  let summary = "";
  if (thinkingCount > 0 && toolCount > 0) {
    summary = `${thinkingCount} reasoning · ${toolCount} tool call${toolCount > 1 ? "s" : ""}`;
  } else if (thinkingCount > 0) {
    summary = `${thinkingCount} reasoning step${thinkingCount > 1 ? "s" : ""}`;
  } else {
    summary = `${toolCount} tool call${toolCount > 1 ? "s" : ""}`;
  }

  return (
    <div className="chat-bts">
      <button
        className="chat-bts__toggle"
        onClick={() => setExpanded(!expanded)}
        type="button"
        aria-expanded={expanded}
      >
        <span className="chat-bts__icon">{expanded ? "▾" : "▸"}</span>
        <span className="chat-bts__label">⚙️ Agent Processing</span>
        <span className="chat-bts__summary">{summary}</span>
        {failedTools > 0 && (
          <span className="chat-bts__failures">⚠ {failedTools} failed</span>
        )}
        {totalDuration > 0 && (
          <span className="chat-bts__duration">{formatDuration(totalDuration)}</span>
        )}
        {blockTokens > 0 && (
          <span className="chat-bts__tokens">~{formatTokenCount(blockTokens)} tok</span>
        )}
      </button>
      {expanded && (
        <div className="chat-bts__content">
          {messages.map((m, i) => (
            <div key={i} className={`chat-bts__item chat-bts__item--${m.sender === "assistant-thinking" ? "thinking" : "tool"}`}>
              <span className="chat-bts__item-icon">
                {m.sender === "assistant-thinking" ? "🧠" : "🔧"}
              </span>
              <div className="chat-bts__item-body">
                <span className="chat-bts__item-label">
                  {m.sender === "assistant-thinking" ? "Thinking" : (m.toolName || "Tool Call")}
                  {m.tokenInfo && m.tokenInfo.tokens > 0 && (
                    <TokenBadge info={m.tokenInfo} />
                  )}
                </span>
                {m.toolDetails && <ToolDetailsView details={m.toolDetails} />}
                {!m.toolDetails && m.text && (
                  <p className="chat-bts__item-text">{m.text}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Image Modal — portalled to document.body for full-page overlay */
function ImageModal({ imageUrl, onClose }: { imageUrl: string; onClose: () => void }) {
  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return createPortal(
    <div className="ba-modal-overlay" onClick={onClose}>
      <div className="image-modal" onClick={(e) => e.stopPropagation()}>
        <div className="image-modal__header">
          <span className="image-modal__icon">🖼️</span>
          <span className="image-modal__title">Image Attachment</span>
          <button className="ba-modal__close" onClick={onClose} type="button" aria-label="Close">✕</button>
        </div>
        <div className="image-modal__body">
          <img
            className="image-modal__img"
            src={imageUrl}
            alt="Attached image"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Get file extension icon and color based on file type */
function getFileExtensionInfo(fileName: string): { icon: string; color: string; extension: string } {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, { icon: string; color: string }> = {
    pdf: { icon: "📕", color: "#e74c3c" },
    doc: { icon: "📘", color: "#2b5797" },
    docx: { icon: "📘", color: "#2b5797" },
    xls: { icon: "📗", color: "#217346" },
    xlsx: { icon: "📗", color: "#217346" },
    csv: { icon: "📗", color: "#217346" },
    ppt: { icon: "📙", color: "#d24726" },
    pptx: { icon: "📙", color: "#d24726" },
    txt: { icon: "📄", color: "#6c757d" },
    zip: { icon: "🗜️", color: "#f39c12" },
    rar: { icon: "🗜️", color: "#f39c12" },
    "7z": { icon: "🗜️", color: "#f39c12" },
    json: { icon: "📋", color: "#f1c40f" },
    xml: { icon: "📋", color: "#e67e22" },
    html: { icon: "🌐", color: "#e44d26" },
    css: { icon: "🎨", color: "#264de4" },
    js: { icon: "⚡", color: "#f7df1e" },
    ts: { icon: "⚡", color: "#3178c6" },
    py: { icon: "🐍", color: "#3776ab" },
    java: { icon: "☕", color: "#007396" },
    mp3: { icon: "🎵", color: "#1db954" },
    wav: { icon: "🎵", color: "#1db954" },
    mp4: { icon: "🎬", color: "#9b59b6" },
    avi: { icon: "🎬", color: "#9b59b6" },
    mov: { icon: "🎬", color: "#9b59b6" },
    svg: { icon: "🖼️", color: "#ffb13b" },
    md: { icon: "📝", color: "#083fa1" },
    yaml: { icon: "⚙️", color: "#cb171e" },
    yml: { icon: "⚙️", color: "#cb171e" },
  };

  const info = map[ext] || { icon: "📎", color: "#6c757d" };
  return { ...info, extension: ext.toUpperCase() || "FILE" };
}

/** Format file size to human readable */
function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** File attachment card component — shows icon + name + download link */
function FileAttachmentCard({ file }: { file: FileAttachment }) {
  const { icon, color, extension } = getFileExtensionInfo(file.name);
  const sizeLabel = formatFileSize(file.size);

  return (
    <a
      className="file-attachment-card"
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      download={file.name}
      title={`Download ${file.name}`}
    >
      <div className="file-attachment-card__icon" style={{ backgroundColor: color }}>
        <span className="file-attachment-card__emoji">{icon}</span>
        <span className="file-attachment-card__ext">{extension}</span>
      </div>
      <div className="file-attachment-card__info">
        <span className="file-attachment-card__name">{file.name}</span>
        {sizeLabel && <span className="file-attachment-card__size">{sizeLabel}</span>}
      </div>
      <span className="file-attachment-card__download" aria-label="Download">⬇️</span>
    </a>
  );
}

/** User message bubble with local state for image modal */
function UserBubble({ text, images, files, tokenInfo, messageSearch }: {
  text: string;
  images?: Array<{ url: string }>;
  files?: FileAttachment[];
  tokenInfo?: MessageTokenInfo | null;
  messageSearch: string;
}) {
  const [selectedImage, setSelectedImage] = useState<{ url: string } | null>(null);

  return (
    <div className="chat-bubble chat-bubble--user">
      <p className="chat-bubble__text">
        {messageSearch.trim()
          ? highlightText(text || "", messageSearch)
          : (text || <em>Empty message</em>)}
      </p>
      {images && images.length > 0 && (
        <div className="chat-attachments">
          {images.map((img, i) => (
            <img
              key={i}
              className="chat-attachment-thumb"
              src={img.url}
              alt={`Attachment ${i + 1}`}
              onClick={() => setSelectedImage(img)}
            />
          ))}
        </div>
      )}
      {files && files.length > 0 && (
        <div className="chat-file-attachments">
          {files.map((file, i) => (
            <FileAttachmentCard key={i} file={file} />
          ))}
        </div>
      )}
      <div className="chat-bubble__footer">
        <TokenBadge info={tokenInfo} />
        {text && <CopyButton text={text} />}
      </div>
      {selectedImage && (
        <ImageModal
          imageUrl={selectedImage.url}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </div>
  );
}

/**
 * Memoized highlight RegExp: `highlightText` runs once per rendered message, so
 * without this cache a brand new RegExp was compiled for every message on every
 * keystroke. The cache is keyed on the raw query, so the produced pattern is
 * byte-for-byte the one the old inline `new RegExp(...)` built.
 *
 * Reusing a /g/ RegExp across `String.prototype.split` calls is safe: split
 * internally clones the regex (per spec) and never mutates `lastIndex` on the
 * instance handed to it.
 */
let highlightCacheQuery: string | null = null;
let highlightCacheRegex: RegExp | null = null;

function getHighlightRegex(query: string): RegExp {
  if (highlightCacheRegex === null || highlightCacheQuery !== query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    highlightCacheRegex = new RegExp(`(${escaped})`, "gi");
    highlightCacheQuery = query;
  }
  return highlightCacheRegex;
}

/** Highlight matching text within a string */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const regex = getHighlightRegex(query);
  const parts = text.split(regex);
  // Hoisted out of the map: the comparison target is constant for the whole call.
  const lowerQuery = query.toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lowerQuery ? (
          <mark key={i} className="ba-highlight">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default function ConversationDetail({
  conversationId,
  onNavigate,
}: ConversationDetailProps) {
  const NOWASSIST_UNIT_COST = 25;

  const [conversation, setConversation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [userCount, setUserCount] = useState(0);
  const [assistantCount, setAssistantCount] = useState(0);
  const [tokenUsage, setTokenUsage] = useState<ConversationTokenUsage | null>(null);
  const [nauBreakdown, setNauBreakdown] = useState<NauBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [messageSearch, setMessageSearch] = useState("");

  useEffect(() => {
    loadData();
  }, [conversationId]);

  async function loadData() {
    try {
      const [convo, msgs] = await Promise.all([
        fetchConversation(conversationId),
        fetchMessages(conversationId),
      ]);
      setConversation(convo);
      setMessages(msgs);

      const counts = countMessagesBySender(msgs);
      setUserCount(counts.user);
      setAssistantCount(counts.assistant);

      // Compute token usage
      const usage = analyzeConversation(msgs);
      setTokenUsage(usage);

      // Compute NAU breakdown
      const breakdown = computeNauBreakdown(msgs);
      setNauBreakdown(breakdown);
    } catch (e) {
      console.error("ConversationDetail load error:", e);
    } finally {
      setLoading(false);
    }
  }

  // --- Memoized derivations -------------------------------------------------
  // These hooks MUST stay above the early returns below, otherwise the hook
  // order would differ between the loading and the loaded render.

  // groupMessages() runs JSON.parse per message (parseMessageContent) plus a
  // token estimate (analyzeMessage). It only depends on the fetched messages,
  // so typing in the search box no longer re-parses the whole conversation.
  const conversationItems = useMemo(() => groupMessages(messages), [messages]);

  // Search term lowercased once instead of once per item per render. Empty
  // string when the query is blank, which mirrors the old `messageSearch.trim()`
  // guards exactly (note: not trimmed otherwise, same as before).
  const messageSearchLower = useMemo(
    () => (messageSearch.trim() ? messageSearch.toLowerCase() : ""),
    [messageSearch]
  );

  // Result counter shown above the chat: depends on the parsed items and the
  // query, never on unrelated re-renders (e.g. opening a tool result modal).
  const searchMatchCount = useMemo(() => {
    if (!messageSearchLower) return 0;
    return conversationItems.filter((item) => {
      if (item.type === "behind-the-scenes") return false;
      return item.text?.toLowerCase().includes(messageSearchLower);
    }).length;
  }, [conversationItems, messageSearchLower]);

  if (loading) return <div className="ba-loading">Loading conversation...</div>;
  if (!conversation) return <div className="ba-empty">Conversation not found</div>;

  const nowAssistUnits = nauBreakdown ? nauBreakdown.totalNau : userCount * NOWASSIST_UNIT_COST;

  // Determine back navigation based on whether we know the app
  const appId = value(conversation.application_id);
  const backTarget = appId ? "app-detail" : "applications";
  const backId = appId || undefined;
  const backLabel = appId ? "← Back to Application" : "← Back to Applications";

  function handleExport() {
    exportConversationAsHtml({
      conversation,
      messages,
      userCount,
      assistantCount,
      tokenUsage,
      nauBreakdown,
    });
  }

  return (
    <div className="ba-view">
      <div className="ba-header-row">
        <button
          className="ba-back-btn"
          onClick={() => onNavigate(backTarget, backId)}
          type="button"
        >
          {backLabel}
        </button>
        <button
          className="ba-export-btn"
          onClick={handleExport}
          type="button"
          title="Export conversation as printable HTML / PDF"
        >
          🖨️ Export / Print
        </button>
      </div>
      <h1 className="ba-view__title">{display(conversation.title) || "Untitled"}</h1>
      <p className="ba-view__subtitle" style={{ margin: "0.25rem 0 0.75rem 0" }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          padding: "0.25rem 0.75rem",
          background: "rgba(99,102,241,0.08)",
          border: "1px solid rgba(99,102,241,0.2)",
          borderRadius: "1rem",
          fontSize: "0.875rem",
          fontWeight: 500,
          color: "#4f46e5",
        }}>👤 {display(conversation.user)}</span>
      </p>
      <div className="ba-detail-grid">
        <div className="ba-detail-item">
          <span className="ba-detail-item__label">Application</span>
          <span className="ba-detail-item__value">{display(conversation.application_name) || "—"}</span>
        </div>
        <div className="ba-detail-item">
          <span className="ba-detail-item__label">Author</span>
          <span className="ba-detail-item__value">{display(conversation.user)}</span>
        </div>
        <div className="ba-detail-item">
          <span className="ba-detail-item__label">State</span>
          <span className="ba-detail-item__value">{display(conversation.state)}</span>
        </div>
        <div className="ba-detail-item">
          <span className="ba-detail-item__label">Client</span>
          <span className="ba-detail-item__value">{display(conversation.client)}</span>
        </div>
        <div className="ba-detail-item">
          <span className="ba-detail-item__label">Created</span>
          <span className="ba-detail-item__value">{display(conversation.sys_created_on)}</span>
        </div>
      </div>
      <div className="ba-kpi-row">
        <KpiCard title="User Messages" value={userCount} icon="user" />
        <KpiCard title="Assistant Messages" value={assistantCount} icon="assistant" />
        <KpiCard title="Total Messages" value={messages.length} />
        <KpiCard
          title="NowAssist Units"
          value={nowAssistUnits.toLocaleString("de-DE")}
          icon="cost"
          tooltip={nauBreakdown ? `${nauBreakdown.totalInteractions} interactions × ${NOWASSIST_UNIT_COST} = ${nowAssistUnits.toLocaleString("de-DE")} NAU` : `${userCount} user messages × ${NOWASSIST_UNIT_COST} NowAssist units = ${nowAssistUnits.toLocaleString("de-DE")}`}
        />
      </div>

      {/* Token Usage Summary */}
      {tokenUsage && tokenUsage.total > 0 && (
        <div className="ba-section">
          <TokenUsageSummary usage={tokenUsage} />
        </div>
      )}

      {/* NAU Breakdown */}
      {nauBreakdown && nauBreakdown.totalInteractions > 0 && (
        <div className="ba-section">
          <h2 className="ba-section__title">NAU Breakdown</h2>
          <NauBreakdownPanel breakdown={nauBreakdown} />
        </div>
      )}

      <ConversationCoaching conversationId={conversationId} />

      {/* Chat-style conversation */}
      <div className="ba-section">
        <h2 className="ba-section__title">Conversation</h2>
        <div className="ba-search">
          <span className="ba-search__icon">🔍</span>
          <input
            className="ba-search__input"
            type="text"
            placeholder="Search messages..."
            value={messageSearch}
            onChange={(e) => setMessageSearch(e.target.value)}
            aria-label="Search messages"
          />
          {messageSearch && (
            <button
              className="ba-search__clear"
              onClick={() => setMessageSearch("")}
              type="button"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        {messageSearchLower && (
          <div className="ba-search__results-count">
            {searchMatchCount} message(s) found
          </div>
        )}
        <div className="chat-container">
          {conversationItems.map((item, idx) => {
            // When searching, filter to only show matching user/assistant messages.
            // Kept as an in-place map + null return (instead of pre-filtering the
            // array) so the `key={idx}` values stay identical to before.
            if (messageSearchLower) {
              if (item.type === "behind-the-scenes") return null;
              if (!item.text?.toLowerCase().includes(messageSearchLower)) return null;
            }

            if (item.type === "behind-the-scenes") {
              return <BehindTheScenes key={idx} messages={item.messages} />;
            }
            if (item.type === "user") {
              return (
                <div key={idx} className="chat-row chat-row--user">
                  <UserBubble
                    text={item.text || ""}
                    images={item.images}
                    files={item.files}
                    tokenInfo={item.tokenInfo}
                    messageSearch={messageSearch}
                  />
                </div>
              );
            }
            // assistant
            return (
              <div key={idx} className="chat-row chat-row--assistant">
                <div className="chat-bubble chat-bubble--assistant">
                  {item.text ? (
                    messageSearch.trim()
                      ? <div className="chat-bubble__text">{highlightText(item.text, messageSearch)}</div>
                      : <MarkdownRenderer content={item.text} />
                  ) : (
                    <p className="chat-bubble__text"><em>Empty message</em></p>
                  )}
                  <div className="chat-bubble__footer">
                    <TokenBadge info={item.tokenInfo} />
                    {item.text && <CopyButton text={item.text} />}
                  </div>
                </div>
              </div>
            );
          })}
          {conversationItems.length === 0 && (
            <div className="chat-empty">No messages in this conversation</div>
          )}
        </div>
      </div>

    </div>
  );
}
