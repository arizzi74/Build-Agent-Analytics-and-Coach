import React, { useEffect, useState } from "react";
import { value, display } from "../utils/fields.ts";
import { fetchTaskTelemetry, fetchAllEventTelemetry } from "../services/api.ts";
import type { ToolErrorSummary } from "../services/api.ts";
import { useQueryTracker } from "../services/queryTracker.ts";
import { SkeletonPerformanceView } from "./Skeleton.tsx";
import KpiCard from "./KpiCard.tsx";
import DataTable from "./DataTable.tsx";
import type { Column } from "./DataTable.tsx";
import BuildErrorDisplay from "./BuildErrorDisplay.tsx";

declare const window: any;

interface TaskRecord {
  sys_id: any;
  user: any;
  request: any;
  task_type: any;
  status: any;
  agent_status: any;
  start_time: any;
  total_time: any;
  build_fix_cycles: any;
  build_fix_errors: any;
  rollbacks: any;
  lines_added: any;
  lines_edited: any;
  lines_deleted: any;
}

interface TaskRow {
  sysId: string;
  agentStatus: string;
  request: string;
  taskType: string;
  duration: string;
  durationSeconds: number;
  buildCycles: number;
  buildErrors: string;
  linesAdded: number;
  linesEdited: number;
  linesDeleted: number;
  rollbacks: number;
  date: string;
  dateRaw: string;
}

interface EventRecord {
  sys_id: any;
  name: any;
  status: any;
  errors: any;
  event_id: any;
}

function parseDurationSeconds(dur: string): number {
  if (!dur) return 0;
  const hmsMatch = dur.match(/(\d+):(\d+):(\d+)/);
  if (hmsMatch) {
    return parseInt(hmsMatch[1]) * 3600 + parseInt(hmsMatch[2]) * 60 + parseInt(hmsMatch[3]);
  }
  return 0;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getCurrentUserId(): string {
  return window.NOW?.user?.userID || window.g_user_id || "";
}

// ─── Pie Chart Colors ──────────────────────────────────────────────────────────

const PIE_COLORS = [
  "#e25c5c", // red
  "#f2a93b", // orange
  "#e6d84c", // yellow
  "#5cb85c", // green
  "#5bc0de", // light blue
  "#8e6cba", // purple
  "#d9534f", // dark red
  "#5a9bd5", // blue
  "#f0ad4e", // amber
  "#7b68ee", // medium slate blue
];

// ─── SVG Pie Chart Component ───────────────────────────────────────────────────

interface PieSlice {
  label: string;
  value: number;
  color: string;
}

function PieChart({ slices, size = 200 }: { slices: PieSlice[]; size?: number }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <div className="ba-pie-empty">No tool errors recorded</div>;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 10;
  let cumulativeAngle = -Math.PI / 2; // Start from top

  const paths = slices.map((slice, i) => {
    const angle = (slice.value / total) * 2 * Math.PI;
    const startX = cx + radius * Math.cos(cumulativeAngle);
    const startY = cy + radius * Math.sin(cumulativeAngle);
    cumulativeAngle += angle;
    const endX = cx + radius * Math.cos(cumulativeAngle);
    const endY = cy + radius * Math.sin(cumulativeAngle);
    const largeArcFlag = angle > Math.PI ? 1 : 0;

    const d = [
      `M ${cx} ${cy}`,
      `L ${startX} ${startY}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`,
      "Z",
    ].join(" ");

    const pct = Math.round((slice.value / total) * 100);
    return (
      <path
        key={i}
        d={d}
        fill={slice.color}
        stroke="rgba(var(--now-color--neutral-0, 255,255,255), 1)"
        strokeWidth="2"
      >
        <title>{`${slice.label}: ${slice.value} errors (${pct}%)`}</title>
      </path>
    );
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ba-pie-chart">
      {paths}
    </svg>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AgentPerformance() {
  const [allTasks, setAllTasks] = useState<TaskRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMyTasks, setFilterMyTasks] = useState(false);
  const { track, reset } = useQueryTracker();

  useEffect(() => {
    reset();
    loadData();
  }, []);

  async function loadData() {
    try {
      const [taskResult, eventResult] = await Promise.all([
        track("Fetching task telemetry", () => fetchTaskTelemetry()),
        track("Fetching tool events", () => fetchAllEventTelemetry()),
      ]);
      setAllTasks(taskResult);
      setEvents(eventResult);
    } catch (e) {
      console.error("AgentPerformance load error:", e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <SkeletonPerformanceView />;
  if (!allTasks.length) return <div className="ba-empty">No task telemetry data available yet.</div>;

  // ─── User Filter ─────────────────────────────────────────────────────────────

  const currentUserId = getCurrentUserId();
  const tasks = filterMyTasks
    ? allTasks.filter((t) => value(t.user) === currentUserId)
    : allTasks;

  const filteredTaskIds = new Set(tasks.map((t) => value(t.sys_id)));
  const filteredEvents = filterMyTasks
    ? events.filter((e) => filteredTaskIds.has(value(e.event_id)))
    : events;

  // ─── Compute KPIs ────────────────────────────────────────────────────────────

  const total = tasks.length;

  const successCount = tasks.filter((t) => value(t.agent_status) === "success").length;
  const failureCount = tasks.filter((t) => value(t.agent_status) === "failure").length;
  const errorCount = tasks.filter((t) => value(t.agent_status) === "error_internal").length;

  const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

  // Average duration
  const durations = tasks
    .map((t) => parseDurationSeconds(value(t.total_time)))
    .filter((d) => d > 0);
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  // Average build-fix cycles
  const cycles = tasks.map((t) => parseInt(value(t.build_fix_cycles)) || 0);
  const avgCycles = cycles.length > 0
    ? (cycles.reduce((a, b) => a + b, 0) / cycles.length).toFixed(1)
    : "0";

  // Rollback rate
  const rollbackTasks = tasks.filter((t) => (parseInt(value(t.rollbacks)) || 0) > 0).length;
  const rollbackRate = total > 0 ? Math.round((rollbackTasks / total) * 100) : 0;

  // ─── Task type breakdown ─────────────────────────────────────────────────────

  const createTasks = tasks.filter((t) => value(t.task_type) === "create");
  const editTasks = tasks.filter((t) => value(t.task_type) === "edit");

  const createSuccess = createTasks.filter((t) => value(t.agent_status) === "success").length;
  const editSuccess = editTasks.filter((t) => value(t.agent_status) === "success").length;

  const createRate = createTasks.length > 0 ? Math.round((createSuccess / createTasks.length) * 100) : 0;
  const editRate = editTasks.length > 0 ? Math.round((editSuccess / editTasks.length) * 100) : 0;

  // ─── Status distribution bar ─────────────────────────────────────────────────

  const successPct = total > 0 ? (successCount / total) * 100 : 0;
  const failurePct = total > 0 ? (failureCount / total) * 100 : 0;
  const errorPct = total > 0 ? (errorCount / total) * 100 : 0;

  // ─── Tool Error Aggregation ──────────────────────────────────────────────────

  const toolStats = new Map<string, ToolErrorSummary>();
  filteredEvents.forEach((evt) => {
    const toolName = value(evt.name) || "unknown";
    const status = value(evt.status);
    const errorText = value(evt.errors) || "";

    if (!toolStats.has(toolName)) {
      toolStats.set(toolName, { toolName, failureCount: 0, successCount: 0, totalCount: 0, errorSamples: [] });
    }
    const stat = toolStats.get(toolName)!;
    stat.totalCount++;
    if (status === "failure") {
      stat.failureCount++;
      if (errorText && stat.errorSamples.length < 3) {
        stat.errorSamples.push(errorText.length > 150 ? errorText.substring(0, 150) + "…" : errorText);
      }
    } else {
      stat.successCount++;
    }
  });

  const toolErrorList = Array.from(toolStats.values())
    .filter((t) => t.failureCount > 0)
    .sort((a, b) => b.failureCount - a.failureCount);

  const totalToolCalls = filteredEvents.length;
  const totalToolFailures = toolErrorList.reduce((sum, t) => sum + t.failureCount, 0);
  const toolFailureRate = totalToolCalls > 0 ? Math.round((totalToolFailures / totalToolCalls) * 100) : 0;

  // Pie chart slices (top 8 + "Other")
  const topTools = toolErrorList.slice(0, 8);
  const otherFailures = toolErrorList.slice(8).reduce((sum, t) => sum + t.failureCount, 0);
  const pieSlices: PieSlice[] = topTools.map((t, i) => ({
    label: t.toolName,
    value: t.failureCount,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));
  if (otherFailures > 0) {
    pieSlices.push({ label: "Other", value: otherFailures, color: "#999" });
  }

  // ─── Table rows ──────────────────────────────────────────────────────────────

  const rows: TaskRow[] = tasks.map((t) => ({
    sysId: value(t.sys_id),
    agentStatus: value(t.agent_status) || value(t.status),
    request: display(t.request),
    taskType: value(t.task_type),
    duration: formatDuration(parseDurationSeconds(value(t.total_time))),
    durationSeconds: parseDurationSeconds(value(t.total_time)),
    buildCycles: parseInt(value(t.build_fix_cycles)) || 0,
    buildErrors: value(t.build_fix_errors) || "",
    linesAdded: parseInt(value(t.lines_added)) || 0,
    linesEdited: parseInt(value(t.lines_edited)) || 0,
    linesDeleted: parseInt(value(t.lines_deleted)) || 0,
    rollbacks: parseInt(value(t.rollbacks)) || 0,
    date: display(t.start_time),
    dateRaw: value(t.start_time),
  }));

  const columns: Column[] = [
    {
      key: "agentStatus",
      label: "Status",
      render: (row: TaskRow) => {
        const cls = row.agentStatus === "success"
          ? "ba-status-badge--success"
          : row.agentStatus === "failure"
          ? "ba-status-badge--failure"
          : row.agentStatus === "error_internal"
          ? "ba-status-badge--error"
          : "ba-status-badge--in-progress";
        const label = row.agentStatus === "error_internal" ? "error" : row.agentStatus;
        return <span className={`ba-status-badge ${cls}`}>{label}</span>;
      },
    },
    {
      key: "request",
      label: "Request",
      render: (row: TaskRow) => (
        <span title={row.request}>
          {row.request.length > 80 ? row.request.substring(0, 80) + "…" : row.request}
        </span>
      ),
    },
    {
      key: "taskType",
      label: "Type",
      sortable: true,
      render: (row: TaskRow) => (
        <span className={`ba-type-badge ba-type-badge--${row.taskType}`}>
          {row.taskType}
        </span>
      ),
    },
    { key: "duration", label: "Duration", sortable: true, sortKey: "durationSeconds" },
    { key: "buildCycles", label: "Build Cycles", sortable: true,
      render: (row: TaskRow) => (
        <span className="ba-build-cycles">
          {row.buildCycles}
          {row.buildErrors && (
            <span className="ba-build-cycles__error-icon" title="Click row to see errors">⚠</span>
          )}
        </span>
      ),
    },
    {
      key: "linesChanged",
      label: "Lines",
      render: (row: TaskRow) => (
        <span className="ba-lines-indicator">
          <span className="ba-lines-indicator__add">+{row.linesAdded + row.linesEdited}</span>
          {row.linesDeleted > 0 && (
            <span className="ba-lines-indicator__del">−{row.linesDeleted}</span>
          )}
        </span>
      ),
    },
    { key: "date", label: "Date", sortable: true, sortKey: "dateRaw" },
  ];

  return (
    <div className="ba-view">
      <div className="ba-view__header-row">
        <div>
          <h1 className="ba-view__title">Agent Performance</h1>
          <p className="ba-view__subtitle">
            Task execution metrics, success rates, and build quality indicators.
          </p>
        </div>
        <div className="ba-perf-filter">
          <button
            className={`ba-perf-filter__btn ${!filterMyTasks ? "ba-perf-filter__btn--active" : ""}`}
            onClick={() => setFilterMyTasks(false)}
          >
            All Users
          </button>
          <button
            className={`ba-perf-filter__btn ${filterMyTasks ? "ba-perf-filter__btn--active" : ""}`}
            onClick={() => setFilterMyTasks(true)}
          >
            My Tasks
          </button>
        </div>
      </div>

      {filterMyTasks && tasks.length === 0 && (
        <div className="ba-empty">No task telemetry for your user yet. Showing empty state.</div>
      )}

      {/* KPI Row */}
      <div className="ba-kpi-row">
        <KpiCard title="Success Rate" value={`${successRate}%`} tooltip={`${successCount} of ${total} tasks succeeded`} />
        <KpiCard title="Total Tasks" value={total} />
        <KpiCard title="Avg Duration" value={formatDuration(avgDuration)} icon="duration" />
        <KpiCard title="Avg Build-Fix Cycles" value={avgCycles} tooltip="Lower is better — fewer retries needed" />
        <KpiCard title="Rollback Rate" value={`${rollbackRate}%`} tooltip={`${rollbackTasks} of ${total} tasks had rollbacks`} />
      </div>

      {/* Status Distribution Bar */}
      <div className="ba-perf-distribution">
        <div className="ba-perf-distribution__title">Status Distribution</div>
        <div className="ba-perf-bar">
          {successPct > 0 && (
            <div
              className="ba-perf-bar__segment ba-perf-bar__segment--success"
              style={{ flexBasis: `${successPct}%` }}
            >
              {successPct >= 10 && `${Math.round(successPct)}%`}
            </div>
          )}
          {failurePct > 0 && (
            <div
              className="ba-perf-bar__segment ba-perf-bar__segment--failure"
              style={{ flexBasis: `${failurePct}%` }}
            >
              {failurePct >= 10 && `${Math.round(failurePct)}%`}
            </div>
          )}
          {errorPct > 0 && (
            <div
              className="ba-perf-bar__segment ba-perf-bar__segment--error"
              style={{ flexBasis: `${errorPct}%` }}
            >
              {errorPct >= 10 && `${Math.round(errorPct)}%`}
            </div>
          )}
        </div>
        <div className="ba-perf-legend">
          <div className="ba-perf-legend__item">
            <span className="ba-perf-legend__dot ba-perf-legend__dot--success"></span>
            Success ({successCount})
          </div>
          <div className="ba-perf-legend__item">
            <span className="ba-perf-legend__dot ba-perf-legend__dot--failure"></span>
            Failure ({failureCount})
          </div>
          <div className="ba-perf-legend__item">
            <span className="ba-perf-legend__dot ba-perf-legend__dot--error"></span>
            Error ({errorCount})
          </div>
        </div>
      </div>

      {/* Tool Errors Section with Pie Chart */}
      <div className="ba-perf-tool-errors">
        <div className="ba-perf-tool-errors__header">
          <div className="ba-perf-tool-errors__title">Tool Error Analysis</div>
          <div className="ba-perf-tool-errors__summary">
            <span className="ba-perf-tool-errors__stat">
              <strong>{totalToolFailures}</strong> failures out of <strong>{totalToolCalls}</strong> tool calls
            </span>
            <span className={`ba-perf-tool-errors__rate ${toolFailureRate > 20 ? "ba-perf-tool-errors__rate--high" : ""}`}>
              {toolFailureRate}% failure rate
            </span>
          </div>
        </div>

        {toolErrorList.length > 0 ? (
          <div className="ba-perf-tool-errors__content">
            <div className="ba-perf-tool-errors__chart">
              <PieChart slices={pieSlices} size={220} />
              <div className="ba-perf-tool-errors__legend">
                {pieSlices.map((slice, i) => (
                  <div key={i} className="ba-perf-tool-errors__legend-item">
                    <span
                      className="ba-perf-tool-errors__legend-dot"
                      style={{ backgroundColor: slice.color }}
                    ></span>
                    <span className="ba-perf-tool-errors__legend-label">{slice.label}</span>
                    <span className="ba-perf-tool-errors__legend-value">{slice.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="ba-perf-tool-errors__table">
              <table className="ba-perf-tool-errors__grid">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Failures</th>
                    <th>Total</th>
                    <th>Fail %</th>
                    <th>Sample Error</th>
                  </tr>
                </thead>
                <tbody>
                  {toolErrorList.slice(0, 10).map((tool, i) => {
                    const failPct = tool.totalCount > 0 ? Math.round((tool.failureCount / tool.totalCount) * 100) : 0;
                    return (
                      <tr key={i}>
                        <td className="ba-perf-tool-errors__tool-name">{tool.toolName}</td>
                        <td className="ba-perf-tool-errors__fail-count">{tool.failureCount}</td>
                        <td>{tool.totalCount}</td>
                        <td>
                          <span className={`ba-perf-tool-errors__pct ${failPct > 50 ? "ba-perf-tool-errors__pct--high" : failPct > 20 ? "ba-perf-tool-errors__pct--medium" : ""}`}>
                            {failPct}%
                          </span>
                        </td>
                        <td className="ba-perf-tool-errors__sample">
                          {tool.errorSamples[0] || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="ba-perf-tool-errors__empty">
            ✅ No tool errors recorded — all tool calls succeeded!
          </div>
        )}
      </div>

      {/* Task Type Breakdown */}
      <div className="ba-perf-types">
        <div className="ba-perf-type-card">
          <div className="ba-perf-type-card__header">
            <span className="ba-perf-type-card__label">🆕 Create Tasks</span>
            <span className="ba-perf-type-card__count">{createTasks.length}</span>
          </div>
          <div className="ba-perf-type-card__bar">
            <div className="ba-perf-type-card__bar-fill" style={{ width: `${createRate}%` }}></div>
          </div>
          <span className="ba-perf-type-card__rate">
            {createRate}% success rate ({createSuccess}/{createTasks.length})
          </span>
        </div>
        <div className="ba-perf-type-card">
          <div className="ba-perf-type-card__header">
            <span className="ba-perf-type-card__label">✏️ Edit Tasks</span>
            <span className="ba-perf-type-card__count">{editTasks.length}</span>
          </div>
          <div className="ba-perf-type-card__bar">
            <div className="ba-perf-type-card__bar-fill" style={{ width: `${editRate}%` }}></div>
          </div>
          <span className="ba-perf-type-card__rate">
            {editRate}% success rate ({editSuccess}/{editTasks.length})
          </span>
        </div>
      </div>

      {/* Recent Tasks Table */}
      <div className="ba-section">
        <div className="ba-section__title">Recent Tasks</div>
        <DataTable
          columns={columns}
          rows={rows}
          emptyMessage="No tasks recorded yet"
          defaultSort={{ key: "dateRaw", direction: "desc" }}
          expandContent={(row: TaskRow) => {
            if (!row.buildErrors) return null;
            return <BuildErrorDisplay rawErrors={row.buildErrors} />;
          }}
        />
      </div>
    </div>
  );
}
