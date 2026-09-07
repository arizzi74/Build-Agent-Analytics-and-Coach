import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { display, value, countMessagesBySender } from "../utils/fields.ts";
import { formatImplDuration, getImplMinutes, calculateDurationMetrics, formatDurationMs } from "../utils/workingDuration.ts";
import type { DurationMetrics } from "../utils/workingDuration.ts";
import { fetchConversations, fetchMessages, fetchCheckpoints, fetchAppNames, fetchAppComposition, fetchSettings, saveSettings } from "../services/api.ts";
import type { AppComposition, ComponentItem } from "../services/api.ts";
import { analyzeConversation, aggregateApplicationUsage, formatTokenCount } from "../utils/tokenEstimation.ts";
import type { ConversationTokenUsage, ApplicationTokenUsage } from "../utils/tokenEstimation.ts";
import {
  calculateComplexity,
  complexityLabel,
  calculateManualHours,
  calculateROI,
  DEFAULT_WEIGHTS,
  DEFAULT_PARTNER_ESTIMATES,
  ALL_COMPOSITION_KEYS,
  COMPONENT_LABELS,
  COMPONENT_ICONS,
  COMPOSITION_CATEGORIES,
  getTotalComponentCount,
  mergeWithDefaults,
} from "../utils/complexity.ts";
import type { ComplexityWeights, PartnerEstimates, ROIResult, CompositionKey } from "../utils/complexity.ts";
import { useQueryTracker } from "../services/queryTracker.ts";
import { SkeletonAppDetailView } from "./Skeleton.tsx";
import KpiCard from "./KpiCard.tsx";
import KpiInfoModal, { KPI_DESCRIPTIONS } from "./KpiInfoModal.tsx";
import type { KpiInfo } from "./KpiInfoModal.tsx";
import DataTable from "./DataTable.tsx";

interface AppDetailProps {
  appId: string;
  onNavigate: (view: string, id?: string) => void;
}

interface ConvoWithCounts {
  raw: any;
  userMessages: number;
  assistantMessages: number;
  totalMessages: number;
  checkpoints: number;
  tokenUsage: ConversationTokenUsage;
}

interface UserAggregate {
  user: string;
  conversations: number;
  userMessages: number;
  assistantMessages: number;
  totalMessages: number;
  tokens: number;
  checkpoints: number;
}

/** Group conversations by user and compute aggregates */
function aggregateByUser(convoData: ConvoWithCounts[]): UserAggregate[] {
  const map = new Map<string, UserAggregate>();
  for (const c of convoData) {
    const user = display(c.raw.user) || "Unknown";
    if (!map.has(user)) {
      map.set(user, {
        user,
        conversations: 0,
        userMessages: 0,
        assistantMessages: 0,
        totalMessages: 0,
        tokens: 0,
        checkpoints: 0,
      });
    }
    const agg = map.get(user)!;
    agg.conversations += 1;
    agg.userMessages += c.userMessages;
    agg.assistantMessages += c.assistantMessages;
    agg.totalMessages += c.totalMessages;
    agg.tokens += c.tokenUsage.total;
    agg.checkpoints += c.checkpoints;
  }
  // Sort by total messages descending
  return Array.from(map.values()).sort((a, b) => b.totalMessages - a.totalMessages);
}

const NOWASSIST_UNIT_COST = 25;

/** Sub-component that renders a composition category tile (click opens modal) */
function CompositionTile({ icon, label, items, onOpen }: { icon: string; label: string; items: ComponentItem[]; onOpen: () => void }) {
  const count = items.length;

  return (
    <div className={`ba-composition-item ${count > 0 ? "ba-composition-item--has-items" : ""}`}>
      <button
        className="ba-composition-item__header"
        onClick={() => count > 0 && onOpen()}
        type="button"
        disabled={count === 0}
      >
        <span className="ba-composition-item__icon">{icon}</span>
        <span className="ba-composition-item__value">{count}</span>
        <span className="ba-composition-item__label">{label}</span>
        {count > 0 && <span className="ba-composition-item__chevron">▸</span>}
      </button>
    </div>
  );
}

/** Modal that shows the list of items for a composition category */
function CompositionModal({ icon, label, items, onClose }: { icon: string; label: string; items: ComponentItem[]; onClose: () => void }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <div className="ba-modal-overlay" onClick={onClose}>
      <div className="ba-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ba-modal__header">
          <span className="ba-modal__header-icon">{icon}</span>
          <span className="ba-modal__title">{label}</span>
          <span className="ba-modal__count">{items.length}</span>
          <button className="ba-modal__close" onClick={onClose} type="button" title="Close">✕</button>
        </div>
        <div className="ba-modal__body">
          <ul className="ba-modal__list">
            {items.map((item) => (
              <li key={item.sysId} className="ba-modal__list-item">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ba-modal__link"
                  title={`Open: ${item.name}`}
                >
                  <span className="ba-modal__link-name">{item.name}</span>
                  <span className="ba-modal__link-icon">↗</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Modal settings editor for weights or estimates */
function SettingsEditor({
  title,
  values,
  labels,
  onSave,
  onCancel,
}: {
  title: string;
  values: Record<string, number>;
  labels: Record<string, string>;
  onSave: (vals: Record<string, number>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, number>>({ ...values });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  function handleChange(key: string, val: string) {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 0) {
      setDraft((prev) => ({ ...prev, [key]: num }));
    }
  }

  // Only show keys that have corresponding items in composition (non-zero weight is always shown in settings)
  const visibleKeys = Object.keys(values).filter((k) => labels[k]);

  return createPortal(
    <div className="ba-modal-overlay" onClick={onCancel}>
      <div className="ba-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ba-settings-modal__header">
          <span className="ba-settings-modal__icon">⚙️</span>
          <span className="ba-settings-modal__title">{title}</span>
          <button className="ba-modal__close" onClick={onCancel} type="button" title="Close">✕</button>
        </div>
        <div className="ba-settings-modal__body">
          {visibleKeys.map((key) => (
            <div className="ba-settings-modal__row" key={key}>
              <span className="ba-settings-modal__label">{labels[key] || key}</span>
              <input
                className="ba-settings-modal__input"
                type="number"
                min="0"
                value={draft[key]}
                onChange={(e) => handleChange(key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="ba-settings-modal__footer">
          <button className="ba-settings-modal__cancel" onClick={onCancel} type="button">Cancel</button>
          <button className="ba-settings-modal__save" onClick={() => onSave(draft)} type="button">Save</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function AppDetail({ appId, onNavigate }: AppDetailProps) {
  const [appName, setAppName] = useState("");
  const [convoData, setConvoData] = useState<ConvoWithCounts[]>([]);
  const [totalUser, setTotalUser] = useState(0);
  const [totalAssistant, setTotalAssistant] = useState(0);
  const [totalCheckpoints, setTotalCheckpoints] = useState(0);
  const [implDuration, setImplDuration] = useState("");
  const [implMinutes, setImplMinutes] = useState(0);
  const [durationMetrics, setDurationMetrics] = useState<DurationMetrics | null>(null);
  const [appTokenUsage, setAppTokenUsage] = useState<ApplicationTokenUsage | null>(null);
  const [loading, setLoading] = useState(true);

  // App composition scan state
  const [composition, setComposition] = useState<AppComposition | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");

  // Composition modal state
  const [modalData, setModalData] = useState<{ icon: string; label: string; items: ComponentItem[] } | null>(null);

  // KPI info modal state
  const [kpiInfoKey, setKpiInfoKey] = useState<string | null>(null);

  // Complexity & ROI state
  const [weights, setWeights] = useState<ComplexityWeights>(DEFAULT_WEIGHTS);
  const [estimates, setEstimates] = useState<PartnerEstimates>(DEFAULT_PARTNER_ESTIMATES);
  const [editingWeights, setEditingWeights] = useState(false);
  const [editingEstimates, setEditingEstimates] = useState(false);
  const [roiOpen, setRoiOpen] = useState(false);

  const { track, reset } = useQueryTracker();

  useEffect(() => {
    reset();
    loadData();
    loadUserSettings();
  }, [appId]);

  async function loadUserSettings() {
    try {
      const savedWeights = await track("Loading settings", () => fetchSettings("complexity_weights"));
      if (savedWeights) setWeights(mergeWithDefaults(savedWeights, DEFAULT_WEIGHTS));
      const savedEstimates = await track("Loading estimates", () => fetchSettings("partner_estimates"));
      if (savedEstimates) setEstimates(mergeWithDefaults(savedEstimates, DEFAULT_PARTNER_ESTIMATES));
    } catch (e) {
      // Use defaults if settings fetch fails
    }
  }

  async function loadData() {
    try {
      const convos = await track("Fetching conversations", () =>
        fetchConversations(`application_id=${appId}^ORDERBYDESClast_message_at`)
      );

      // Resolve app name
      let resolvedName = "";
      if (convos.length > 0) {
        resolvedName = display(convos[0].application_name);
      }
      if (!resolvedName) {
        const nameMap = await track("Resolving app name", () => fetchAppNames([appId]));
        resolvedName = nameMap.get(appId) || `App (${appId.substring(0, 8)}...)`;
      }
      setAppName(resolvedName);

      // Fetch messages and checkpoints per conversation
      let userTotal = 0;
      let assistantTotal = 0;
      let chkTotal = 0;
      const convoResults: ConvoWithCounts[] = [];
      const convoTokenUsages: ConversationTokenUsage[] = [];
      const allConvoMessages: any[][] = [];

      for (const c of convos) {
        const cId = value(c.sys_id);
        const [msgs, chks] = await track(`Conv ${convoResults.length + 1}/${convos.length}`, () =>
          Promise.all([
            fetchMessages(cId),
            fetchCheckpoints(cId),
          ])
        );
        const counts = countMessagesBySender(msgs);
        userTotal += counts.user;
        assistantTotal += counts.assistant;
        chkTotal += chks.length;

        const tokenUsage = analyzeConversation(msgs);
        convoTokenUsages.push(tokenUsage);

        allConvoMessages.push(msgs);

        convoResults.push({
          raw: c,
          userMessages: counts.user,
          assistantMessages: counts.assistant,
          totalMessages: counts.total,
          checkpoints: chks.length,
          tokenUsage,
        });
      }

      setTotalUser(userTotal);
      setTotalAssistant(assistantTotal);
      setTotalCheckpoints(chkTotal);
      setConvoData(convoResults);

      const appUsage = aggregateApplicationUsage(convoTokenUsages);
      setAppTokenUsage(appUsage);

      const duration = formatImplDuration(allConvoMessages);
      setImplDuration(duration);

      const minutes = getImplMinutes(allConvoMessages);
      setImplMinutes(minutes);

      const metrics = calculateDurationMetrics(allConvoMessages);
      setDurationMetrics(metrics);
    } catch (e) {
      console.error("AppDetail load error:", e);
    } finally {
      setLoading(false);
    }
  }

  async function scanApplication() {
    setScanning(true);
    setScanError("");
    try {
      const result = await fetchAppComposition(appId);
      setComposition(result);
    } catch (e: any) {
      console.error("Scan error:", e);
      setScanError("Failed to scan application. Please try again.");
    } finally {
      setScanning(false);
    }
  }

  async function handleSaveWeights(vals: Record<string, number>) {
    const newWeights = vals as unknown as ComplexityWeights;
    setWeights(newWeights);
    setEditingWeights(false);
    try {
      await saveSettings("complexity_weights", newWeights);
    } catch (e) {
      console.error("Failed to save weights:", e);
    }
  }

  async function handleSaveEstimates(vals: Record<string, number>) {
    const newEstimates = vals as unknown as PartnerEstimates;
    setEstimates(newEstimates);
    setEditingEstimates(false);
    try {
      await saveSettings("partner_estimates", newEstimates);
    } catch (e) {
      console.error("Failed to save estimates:", e);
    }
  }

  if (loading) return <SkeletonAppDetailView />;

  const nowAssistUnits = totalUser * NOWASSIST_UNIT_COST;

  // Complexity & ROI calculations
  const complexScore = composition ? calculateComplexity(composition, weights) : 0;
  const complexLabel = composition ? complexityLabel(complexScore) : null;
  const manualHours = composition ? calculateManualHours(composition, estimates) : 0;
  const roi: ROIResult | null = composition && implMinutes > 0
    ? calculateROI(manualHours, implMinutes)
    : null;
  const totalComponents = composition ? getTotalComponentCount(composition) : 0;

  // Compute user aggregates
  const userAggregates = aggregateByUser(convoData);

  const userAggColumns = [
    { key: "user", label: "Author", render: (r: UserAggregate) => r.user },
    { key: "conversations", label: "Conversations", render: (r: UserAggregate) => r.conversations },
    { key: "userMessages", label: "User Msgs", render: (r: UserAggregate) => r.userMessages },
    { key: "assistantMessages", label: "Assistant Msgs", render: (r: UserAggregate) => r.assistantMessages },
    { key: "tokens", label: "Est. Tokens", render: (r: UserAggregate) => `~${formatTokenCount(r.tokens)}` },
    { key: "nowAssistUnits", label: "NowAssist Units", render: (r: UserAggregate) => (r.userMessages * NOWASSIST_UNIT_COST).toLocaleString("de-DE") },
  ];

  const columns = [
    { key: "title", label: "Conversation", render: (r: ConvoWithCounts) => display(r.raw.title) || "Untitled" },
    { key: "author", label: "Author", render: (r: ConvoWithCounts) => display(r.raw.user) || "—" },
    { key: "userMessages", label: "User Msgs", render: (r: ConvoWithCounts) => r.userMessages },
    { key: "assistantMessages", label: "Assistant Msgs", render: (r: ConvoWithCounts) => r.assistantMessages },
    { key: "tokens", label: "Est. Tokens", render: (r: ConvoWithCounts) => `~${formatTokenCount(r.tokenUsage.total)}` },
    { key: "checkpoints", label: "Checkpoints", render: (r: ConvoWithCounts) => r.checkpoints },
    { key: "state", label: "State", render: (r: ConvoWithCounts) => display(r.raw.state) },
    { key: "date", label: "Last Activity", render: (r: ConvoWithCounts) => display(r.raw.last_message_at) },
  ];

  return (
    <div className="ba-view">
      <button
        className="ba-back-btn"
        onClick={() => onNavigate("applications")}
        type="button"
      >
        ← Back to Applications
      </button>
      <h1 className="ba-view__title">{appName}</h1>
      <p className="ba-view__subtitle">
        {convoData.length} conversation{convoData.length !== 1 ? "s" : ""} over time
      </p>
      <div className="ba-kpi-row">
        <KpiCard title="User Messages" value={totalUser} icon="user" onClick={() => setKpiInfoKey("user")} />
        <KpiCard title="Assistant Messages" value={totalAssistant} icon="assistant" onClick={() => setKpiInfoKey("assistant")} />
        <KpiCard title="Impl. Duration" value={implDuration || "—"} icon="duration" onClick={() => setKpiInfoKey("duration")} />
        <KpiCard
          title="NowAssist Units"
          value={nowAssistUnits.toLocaleString("de-DE")}
          icon="cost"
          tooltip={`${totalUser} user messages × ${NOWASSIST_UNIT_COST} NowAssist units = ${nowAssistUnits.toLocaleString("de-DE")}`}
          onClick={() => setKpiInfoKey("cost")}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION: USER AGGREGATE
          ═══════════════════════════════════════════════════════════════════════ */}
      {userAggregates.length > 0 && (
        <div className="ba-section">
          <h2 className="ba-section__title">👤 Usage by Author</h2>
          <DataTable
            columns={userAggColumns}
            rows={userAggregates}
            emptyMessage="No user data available"
          />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1: APPLICATION SCAN
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="ba-section">
        <div className="ba-section__header">
          <h2 className="ba-section__title">🔍 Application Scan</h2>
          <button
            className="ba-scan-btn"
            onClick={scanApplication}
            disabled={scanning}
            type="button"
          >
            {scanning ? "Scanning..." : composition ? "Rescan" : "Scan Application"}
          </button>
        </div>
        {scanError && <p className="ba-scan-error">{scanError}</p>}
        {composition && (
          <>
            <p className="ba-scan-summary">
              Found <strong>{totalComponents}</strong> component{totalComponents !== 1 ? "s" : ""} across{" "}
              {COMPOSITION_CATEGORIES.filter((cat) => cat.keys.some((k) => composition[k].length > 0)).length} categories
            </p>
            <div className="ba-composition-categories">
              {COMPOSITION_CATEGORIES.map((cat) => {
                const catTotal = cat.keys.reduce((sum, k) => sum + composition[k].length, 0);
                if (catTotal === 0) return null;
                return (
                  <div className="ba-composition-category" key={cat.label}>
                    <h3 className="ba-composition-category__title">{cat.label} <span className="ba-composition-category__count">{catTotal}</span></h3>
                    <div className="ba-composition-grid">
                      {cat.keys.map((key) => (
                        <CompositionTile
                          key={key}
                          icon={COMPONENT_ICONS[key]}
                          label={COMPONENT_LABELS[key]}
                          items={composition[key]}
                          onOpen={() => setModalData({ icon: COMPONENT_ICONS[key], label: COMPONENT_LABELS[key], items: composition[key] })}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {!composition && !scanning && (
          <p className="ba-scan-hint">
            Click "Scan Application" to discover all metadata components that make up this app.
          </p>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2: EFFORT ESTIMATION (only visible after scan)
          ═══════════════════════════════════════════════════════════════════════ */}
      {composition && (
        <div className="ba-section ba-section--effort">
          <div className="ba-section__header">
            <h2 className="ba-section__title">📊 Effort Estimation</h2>
          </div>

          {/* Complexity Score Panel */}
          <div className="ba-complexity" style={{ '--ba-complexity-color': complexLabel?.color } as React.CSSProperties}>
            <div className="ba-complexity__header">
              <span className="ba-complexity__score">{complexScore}</span>
              <div>
                <span className="ba-complexity__label">{complexLabel?.label}</span>
              </div>
              <button
                className="ba-scan-btn ba-scan-btn--compact"
                onClick={() => setEditingWeights(!editingWeights)}
                type="button"
              >
                {editingWeights ? "Cancel" : "Edit Weights"}
              </button>
            </div>
            {editingWeights && (
              <SettingsEditor
                title="Complexity Weights"
                values={weights as unknown as Record<string, number>}
                labels={COMPONENT_LABELS as unknown as Record<string, string>}
                onSave={handleSaveWeights}
                onCancel={() => setEditingWeights(false)}
              />
            )}
            <div className="ba-complexity__breakdown">
              {ALL_COMPOSITION_KEYS.map((key) => {
                const count = composition[key].length;
                const weight = weights[key];
                const subtotal = count * weight;
                if (count === 0) return null;
                return (
                  <div className="ba-complexity__row" key={key}>
                    <span>{count} {COMPONENT_LABELS[key]} × {weight}</span>
                    <span className="ba-complexity__row-value">{subtotal}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ROI / Savings Panel — Collapsible */}
          {roi && (
            <div className={`ba-roi ${roiOpen ? "ba-roi--open" : ""}`}>
              <button
                className="ba-roi__toggle"
                onClick={() => setRoiOpen(!roiOpen)}
                type="button"
              >
                <span className="ba-roi__toggle-icon">{roiOpen ? "▾" : "▸"}</span>
                <span className="ba-roi__title">💰 ROI — Build Agent Savings</span>
                <span className="ba-roi__toggle-preview">
                  {roi.savedHours.toFixed(1)}h saved · {roi.savingsPercent.toFixed(0)}%
                </span>
              </button>
              {roiOpen && (
                <div className="ba-roi__body">
                  <div className="ba-roi__header">
                    <button
                      className="ba-scan-btn ba-scan-btn--compact"
                      onClick={() => setEditingEstimates(!editingEstimates)}
                      type="button"
                    >
                      {editingEstimates ? "Cancel" : "Edit Estimates"}
                    </button>
                  </div>
                  {editingEstimates && (
                    <SettingsEditor
                      title="Partner Hour Estimates"
                      values={estimates as unknown as Record<string, number>}
                      labels={Object.fromEntries(
                        ALL_COMPOSITION_KEYS.map((k) => [k, `${COMPONENT_LABELS[k]} (hrs)`])
                      )}
                      onSave={handleSaveEstimates}
                      onCancel={() => setEditingEstimates(false)}
                    />
                  )}
                  <div className="ba-roi__savings">
                    <div>
                      <div className="ba-roi__savings-value">{roi.savedHours.toFixed(1)}h saved</div>
                      <div className="ba-roi__savings-label">Time Savings</div>
                    </div>
                    <div className="ba-roi__savings-percent">{roi.savingsPercent.toFixed(0)}%</div>
                  </div>
                  <div className="ba-roi__comparison">
                    <div className="ba-roi__metric">
                      <div className="ba-roi__metric-value ba-roi__metric-value--manual">{roi.manualHours}h</div>
                      <div className="ba-roi__metric-label">Manual Estimate</div>
                    </div>
                    <div className="ba-roi__metric">
                      <div className="ba-roi__metric-value ba-roi__metric-value--agent">
                        {Math.floor(roi.buildAgentHours)}h {Math.round((roi.buildAgentHours % 1) * 60)}m
                      </div>
                      <div className="ba-roi__metric-label">Build Agent Time</div>
                    </div>
                  </div>
                  <div className="ba-roi__breakdown">
                    {ALL_COMPOSITION_KEYS.map((key) => {
                      const count = composition[key].length;
                      const hrs = estimates[key];
                      const total = count * hrs;
                      if (count === 0) return null;
                      return (
                        <div className="ba-roi__breakdown-row" key={key}>
                          <span>{count} {COMPONENT_LABELS[key]} × {hrs}h</span>
                          <span className="ba-roi__breakdown-value">{total}h manual</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Conversations Timeline */}
      <div className="ba-section">
        <h2 className="ba-section__title">Conversations Timeline</h2>
        <DataTable
          columns={columns}
          rows={convoData}
          onRowClick={(row) => onNavigate("conversation", value(row.raw.sys_id))}
        />
      </div>

      {/* Composition Modal */}
      {modalData && (
        <CompositionModal
          icon={modalData.icon}
          label={modalData.label}
          items={modalData.items}
          onClose={() => setModalData(null)}
        />
      )}

      {/* KPI Info Modal */}
      {kpiInfoKey && KPI_DESCRIPTIONS[kpiInfoKey] && (() => {
        const info: KpiInfo = { ...KPI_DESCRIPTIONS[kpiInfoKey] };
        // Inject token consumption detail metrics into the NowAssist Units KPI modal
        if (kpiInfoKey === "cost" && appTokenUsage && appTokenUsage.total > 0) {
          info.details = [
            {
              icon: "🔢",
              label: "Token Totali",
              value: `~${formatTokenCount(appTokenUsage.total)}`,
              tooltip: "Stima dei token totali (input + output + thinking) consumati per la produzione dell'applicazione",
            },
            {
              icon: "⬇️",
              label: "Input",
              value: `~${formatTokenCount(appTokenUsage.input)}`,
              tooltip: "Token del messaggio utente e del contesto inviati all'LLM",
            },
            {
              icon: "⬆️",
              label: "Output",
              value: `~${formatTokenCount(appTokenUsage.output)}`,
              tooltip: "Token generati dall'agente nelle risposte",
            },
            {
              icon: "💭",
              label: "Thinking",
              value: `~${formatTokenCount(appTokenUsage.thinking)}`,
              tooltip: "Token usati per i ragionamenti interni dell'agente",
            },
          ];
        }
        // Inject duration detail metrics when showing the duration KPI
        if (kpiInfoKey === "duration" && durationMetrics) {
          info.details = [
            {
              icon: "🕐",
              label: "Wall-Clock",
              value: formatDurationMs(durationMetrics.wallClockMs),
              tooltip: `Tempo totale trascorso dal primo all'ultimo messaggio (${durationMetrics.turnCount} turni)`,
            },
            {
              icon: "⚡",
              label: "Avg Interaction",
              value: formatDurationMs(durationMetrics.avgInteractionMs),
              tooltip: `Media su ${durationMetrics.turnCount} turni`,
            },
            {
              icon: "☕",
              label: "Avg Pause",
              value: formatDurationMs(durationMetrics.avgPauseMs),
              tooltip: "Tempo medio di riflessione dell'utente tra un turno e il successivo",
            },
          ];
        }
        return (
          <KpiInfoModal
            info={info}
            onClose={() => setKpiInfoKey(null)}
          />
        );
      })()}
    </div>
  );
}
