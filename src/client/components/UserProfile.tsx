import React, { useEffect, useMemo, useState } from "react";
import { fetchUserProfile } from "../services/api.ts";
import type { UserProfileData } from "../services/api.ts";
import { useQueryTracker } from "../services/queryTracker.ts";
import { SkeletonUserProfileView } from "./Skeleton.tsx";
import KpiCard from "./KpiCard.tsx";
import { NauBreakdownPanel } from "./NauBreakdown.tsx";

interface UserProfileProps {
  userId: string;
  onNavigate: (view: string, id?: string, month?: string | null) => void;
}

const PIE_COLORS = [
  "#059669", "#0d9488", "#f59e0b", "#84cc16", "#fb7185",
  "#7c3aed", "#2dd4bf", "#fbbf24", "#a3e635", "#f472b6",
];

const OTHER_COLOR = "#9ca3af";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── SVG Donut Pie Chart (Top 5 + "Altro") ──────────────────────────────────
function PieChart({ data }: { data: UserProfileData["appBreakdown"] }) {
  // Memoized ABOVE the empty-data early return so the hook order never changes.
  // Same logic as before: sort by percentage descending to get the true top 5 by
  // consumption, then collapse everything else into a single "Altro" slice.
  const chartData = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.percentage - a.percentage);
    const top5 = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const result = [...top5];
    if (rest.length > 0) {
      result.push({
        appId: "__other__",
        appName: "Altro",
        messages: rest.reduce((sum, app) => sum + app.messages, 0),
        conversations: rest.reduce((sum, app) => sum + app.conversations, 0),
        percentage: rest.reduce((sum, app) => sum + app.percentage, 0),
        lastActivity: "",
      });
    }
    return result;
  }, [data]);

  if (data.length === 0) {
    return <div className="ba-chart__empty">No application data available</div>;
  }

  const size = 200;
  const strokeWidth = 38;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  let cumulativeOffset = 0;

  return (
    <div className="ba-pie-chart">
      <div className="ba-pie-chart__container">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ba-pie-chart__svg">
          {chartData.map((app, i) => {
            const segmentLength = (app.percentage / 100) * circumference;
            const offset = cumulativeOffset;
            cumulativeOffset += segmentLength;
            const color = app.appId === "__other__" ? OTHER_COLOR : PIE_COLORS[i % PIE_COLORS.length];
            return (
              <circle
                key={app.appId}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
                className="ba-pie-chart__segment"
              />
            );
          })}
          {/* Center text */}
          <text x={cx} y={cy - 6} textAnchor="middle" className="ba-pie-chart__center-value">
            {data.length}
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" className="ba-pie-chart__center-label">
            Apps
          </text>
        </svg>
      </div>
      <div className="ba-pie-chart__legend">
        {chartData.map((app, i) => (
          <div key={app.appId} className="ba-pie-chart__legend-item">
            <span
              className="ba-pie-chart__legend-swatch"
              style={{ background: app.appId === "__other__" ? OTHER_COLOR : PIE_COLORS[i % PIE_COLORS.length] }}
            />
            <span className="ba-pie-chart__legend-name">{app.appName}</span>
            <span className="ba-pie-chart__legend-pct">{app.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SVG Timeline Bar Chart ──────────────────────────────────────────────────
// Static geometry, hoisted out of the component: it never depends on props.
const TL_WIDTH = 900;
const TL_HEIGHT = 180;
const TL_PADDING = { top: 20, right: 20, bottom: 40, left: 45 };
const TL_CHART_WIDTH = TL_WIDTH - TL_PADDING.left - TL_PADDING.right;
const TL_CHART_HEIGHT = TL_HEIGHT - TL_PADDING.top - TL_PADDING.bottom;
const TL_Y_TICKS = 4;

function TimelineChart({ data }: { data: UserProfileData["timeline"] }) {
  // Memoized ABOVE the empty-data early return (stable hook order). All values
  // derive from `data` only, with the exact same formulas as before.
  const { maxMessages, barWidth, barGap, yStep, labelInterval } = useMemo(() => {
    const max = Math.max(...data.map((d) => d.messages), 1);
    const bw = Math.max(2, Math.min(14, (TL_CHART_WIDTH / data.length) - 2));
    return {
      maxMessages: max,
      barWidth: bw,
      barGap: (TL_CHART_WIDTH - bw * data.length) / Math.max(data.length - 1, 1),
      yStep: Math.ceil(max / TL_Y_TICKS),
      // Show limited x-axis labels
      labelInterval: Math.max(1, Math.floor(data.length / 10)),
    };
  }, [data]);

  if (data.length === 0) {
    return <div className="ba-chart__empty">No timeline data available</div>;
  }

  const width = TL_WIDTH;
  const height = TL_HEIGHT;
  const padding = TL_PADDING;
  const chartWidth = TL_CHART_WIDTH;
  const chartHeight = TL_CHART_HEIGHT;
  const yTicks = TL_Y_TICKS;

  return (
    <div className="ba-timeline-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="ba-chart__svg"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const y = padding.top + chartHeight - (i * chartHeight) / yTicks;
          return (
            <g key={`grid-${i}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                className="ba-chart__grid"
              />
              <text
                x={padding.left - 8}
                y={y + 3}
                textAnchor="end"
                className="ba-chart__axis"
              >
                {i * yStep}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((point, i) => {
          const barHeight = (point.messages / maxMessages) * chartHeight;
          const x = padding.left + i * (barWidth + barGap);
          const y = padding.top + chartHeight - barHeight;
          return (
            <g key={point.date}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={Math.min(barWidth / 2, 3)}
                className="ba-timeline-chart__bar"
              />
              {i % labelInterval === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={height - padding.bottom + 18}
                  textAnchor="middle"
                  className="ba-chart__axis"
                >
                  {formatDate(point.date)}
                </text>
              )}
            </g>
          );
        })}

        {/* Axis labels */}
        <text
          x={padding.left - 8}
          y={padding.top - 6}
          textAnchor="end"
          className="ba-chart__axis ba-chart__axis-label"
        >
          msgs
        </text>
      </svg>
    </div>
  );
}

type SortColumn = "appName" | "lastActivity" | "messages" | "conversations" | "percentage";
type SortDirection = "asc" | "desc";

/** Static header definition for the per-application table (was an inline literal in the JSX). */
const APP_TABLE_HEADERS: [SortColumn, string][] = [
  ["appName", "Application"],
  ["lastActivity", "Last Activity"],
  ["messages", "Messages"],
  ["conversations", "Conversations"],
  ["percentage", "% of Total"],
];

// ─── Main UserProfile Component ──────────────────────────────────────────────
export default function UserProfile({ userId, onNavigate }: UserProfileProps) {
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("lastActivity");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const { track, reset } = useQueryTracker();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      reset();
      try {
        const data = await track("Loading user profile", () => fetchUserProfile(userId));
        if (!cancelled) setProfile(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load user profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Per-application table ordering, extracted from the table JSX and memoized.
  // Declared before the early returns below so the hook order stays stable
  // across the skeleton / error / loaded renders. The comparator is unchanged.
  const sortedAppBreakdown = useMemo(() => {
    const rows = profile?.appBreakdown;
    if (!rows) return [];
    return [...rows].sort((a, b) => {
      const dir = sortDirection === "desc" ? -1 : 1;
      if (sortColumn === "appName") {
        return dir * a.appName.localeCompare(b.appName);
      } else if (sortColumn === "lastActivity") {
        return dir * a.lastActivity.localeCompare(b.lastActivity);
      } else if (sortColumn === "messages") {
        return dir * (a.messages - b.messages);
      } else if (sortColumn === "conversations") {
        return dir * (a.conversations - b.conversations);
      } else {
        return dir * (a.percentage - b.percentage);
      }
    });
  }, [profile, sortColumn, sortDirection]);

  if (loading) {
    return <SkeletonUserProfileView />;
  }

  if (error) {
    return (
      <div className="ba-view">
        <button
          className="ba-back-btn"
          onClick={() => onNavigate("consumption")}
          type="button"
        >
          ← Back to Consumption
        </button>
        <div className="ba-scan-error">Error: {error}</div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="ba-view ba-user-profile">
      {/* Back button */}
      <button
        className="ba-back-btn"
        onClick={() => onNavigate("consumption")}
        type="button"
      >
        ← Back to Consumption
      </button>

      {/* Profile Header */}
      <div className="ba-consumption-header">
        <div className="ba-user-profile__header">
          <div className="ba-user-profile__avatar">
            {profile.userName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="ba-view__title">{profile.userName}</h1>
            <p className="ba-view__subtitle">
              User activity analytics — detailed breakdown of Build Agent usage
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="ba-kpi-row">
        <KpiCard
          title="User Messages"
          value={profile.totalMessages.toLocaleString()}
          icon="user"
        />
        <KpiCard
          title="Conversations"
          value={profile.totalConversations.toLocaleString()}
          icon="assistant"
        />
        <KpiCard
          title="Now Assist Units"
          value={profile.nauUnits.toLocaleString()}
          icon="cost"
        />
        <KpiCard
          title="Applications"
          value={profile.appBreakdown.length}
          icon="tokens"
        />
      </div>

      {/* Activity Timeline — Full Width */}
      <div className="ba-chart ba-user-profile__timeline-full">
        <h3 className="ba-section__title">NAU Breakdown</h3>
        <NauBreakdownPanel breakdown={profile.breakdown} />
      </div>

      {/* Activity Timeline — Full Width */}
      <div className="ba-chart ba-user-profile__timeline-full">
        <h3 className="ba-section__title">Activity Timeline</h3>
        <TimelineChart data={profile.timeline} />
      </div>

      {/* Row: Donut (Top 5) | Per-Application Breakdown */}
      <div className="ba-user-profile__charts">
        {/* Pie Chart — Top 5 */}
        <div className="ba-chart ba-user-profile__chart-card">
          <h3 className="ba-section__title">Top 5 Applications</h3>
          <PieChart data={profile.appBreakdown} />
        </div>

        {/* App Breakdown Table */}
        <div className="ba-chart ba-user-profile__chart-card ba-user-profile__chart-card--wide">
          <h3 className="ba-section__title">Per-Application Breakdown</h3>
          <p style={{ fontSize: "12px", color: "var(--ba-text-secondary, #6b7280)", margin: "0 0 8px 0" }}>
            Sorted by {sortColumn === "appName" ? "application name" : sortColumn === "lastActivity" ? "last activity" : sortColumn === "messages" ? "messages" : sortColumn === "conversations" ? "conversations" : "% of total"} ({sortDirection === "desc" ? "↓" : "↑"})
          </p>
          <div className="ba-table-wrapper ba-user-profile__table-inline ba-user-profile__table-scroll" style={{ maxHeight: "400px", overflowY: "auto" }}>
            <table className="ba-table">
              <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#fff" }}>
                <tr>
                  {APP_TABLE_HEADERS.map(([col, label]) => (
                    <th
                      key={col}
                      onClick={() => {
                        if (sortColumn === col) {
                          setSortDirection(sortDirection === "desc" ? "asc" : "desc");
                        } else {
                          setSortColumn(col);
                          setSortDirection(col === "appName" ? "asc" : "desc");
                        }
                      }}
                      style={{ cursor: "pointer", userSelect: "none" }}
                      className={sortColumn === col ? "ba-th--active" : ""}
                    >
                      {label} {sortColumn === col ? (sortDirection === "desc" ? "▼" : "▲") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedAppBreakdown.map((app) => (
                  <tr key={app.appId}>
                    <td>
                      <span className="ba-user-profile__app-name">{app.appName}</span>
                    </td>
                    <td style={{ whiteSpace: "nowrap", fontSize: "13px", color: "var(--ba-text-secondary, #6b7280)" }}>
                      {app.lastActivity ? new Date(app.lastActivity).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </td>
                    <td>{app.messages.toLocaleString()}</td>
                    <td>{app.conversations}</td>
                    <td>
                      <div className="ba-user-profile__pct-bar-container">
                        <div
                          className="ba-user-profile__pct-bar"
                          style={{ width: `${Math.max(app.percentage, 2)}%` }}
                        />
                        <span className="ba-user-profile__pct-label">{app.percentage}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {profile.appBreakdown.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--ba-text-secondary)" }}>
                      No application data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>


    </div>
  );
}
