import React, { useState, useEffect, useCallback } from "react";
import {
  fetchTimeSeriesCache,
  saveTimeSeriesPoint,
  fetchMessagesForTimeSeries,
  fetchTimeSeriesApps,
} from "../services/api.ts";
import type { TimeSeriesPoint, TimeSeriesApp } from "../services/api.ts";
import { analyzeMessage } from "../utils/tokenEstimation.ts";
import { value } from "../utils/fields.ts";
import KpiCard from "./KpiCard.tsx";

// ─── Chart Constants ─────────────────────────────────────────────────────────

const CHART_PADDING = { top: 30, right: 60, bottom: 50, left: 70 };
const COLOR_TOKENS = "#059669"; // emerald
const COLOR_MESSAGES = "#0d9488"; // teal

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`;
  return dateStr;
}

// ─── SVG Chart Component ─────────────────────────────────────────────────────

interface ChartProps {
  data: TimeSeriesPoint[];
}

function TimeSeriesChart({ data }: ChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; point: TimeSeriesPoint } | null>(null);

  if (data.length === 0) {
    return (
      <div className="ba-chart__empty">
        No data available. Click <strong>Refresh Data</strong> to compute time series from messages.
      </div>
    );
  }

  const width = 900;
  const height = 360;
  const chartW = width - CHART_PADDING.left - CHART_PADDING.right;
  const chartH = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const maxTokens = Math.max(...data.map((d) => d.tokenCount), 1);
  const maxMessages = Math.max(...data.map((d) => d.messageCount), 1);

  // Scale functions
  const xScale = (i: number) => CHART_PADDING.left + (i / Math.max(data.length - 1, 1)) * chartW;
  const yTokens = (v: number) => CHART_PADDING.top + chartH - (v / maxTokens) * chartH;
  const yMessages = (v: number) => CHART_PADDING.top + chartH - (v / maxMessages) * chartH;

  // Build path strings
  const tokenPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yTokens(d.tokenCount)}`)
    .join(" ");
  const messagePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yMessages(d.messageCount)}`)
    .join(" ");

  // Y-axis tick values
  const tokenTicks = [0, Math.round(maxTokens * 0.25), Math.round(maxTokens * 0.5), Math.round(maxTokens * 0.75), maxTokens];
  const messageTicks = [0, Math.round(maxMessages * 0.25), Math.round(maxMessages * 0.5), Math.round(maxMessages * 0.75), maxMessages];

  // X-axis labels (show ~6 labels max)
  const labelInterval = Math.max(1, Math.floor(data.length / 6));

  return (
    <div className="ba-chart">
      <svg
        className="ba-chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines */}
        {tokenTicks.map((tick) => (
          <line
            key={`grid-${tick}`}
            className="ba-chart__grid"
            x1={CHART_PADDING.left}
            x2={width - CHART_PADDING.right}
            y1={yTokens(tick)}
            y2={yTokens(tick)}
          />
        ))}

        {/* Y-axis left (tokens) */}
        {tokenTicks.map((tick) => (
          <text
            key={`ytick-${tick}`}
            className="ba-chart__axis ba-chart__axis--left"
            x={CHART_PADDING.left - 8}
            y={yTokens(tick) + 4}
            textAnchor="end"
          >
            {formatNumber(tick)}
          </text>
        ))}

        {/* Y-axis right (messages) */}
        {messageTicks.map((tick) => (
          <text
            key={`ymtick-${tick}`}
            className="ba-chart__axis ba-chart__axis--right"
            x={width - CHART_PADDING.right + 8}
            y={yMessages(tick) + 4}
            textAnchor="start"
          >
            {formatNumber(tick)}
          </text>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) =>
          i % labelInterval === 0 || i === data.length - 1 ? (
            <text
              key={`xlabel-${i}`}
              className="ba-chart__axis"
              x={xScale(i)}
              y={height - CHART_PADDING.bottom + 20}
              textAnchor="middle"
            >
              {formatDate(d.date)}
            </text>
          ) : null
        )}

        {/* Axis labels */}
        <text
          className="ba-chart__axis-label"
          x={CHART_PADDING.left - 50}
          y={CHART_PADDING.top + chartH / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${CHART_PADDING.left - 50} ${CHART_PADDING.top + chartH / 2})`}
          fill={COLOR_TOKENS}
        >
          Tokens
        </text>
        <text
          className="ba-chart__axis-label"
          x={width - CHART_PADDING.right + 45}
          y={CHART_PADDING.top + chartH / 2}
          textAnchor="middle"
          transform={`rotate(90 ${width - CHART_PADDING.right + 45} ${CHART_PADDING.top + chartH / 2})`}
          fill={COLOR_MESSAGES}
        >
          Messages
        </text>

        {/* Token line */}
        <path
          className="ba-chart__line ba-chart__line--tokens"
          d={tokenPath}
          fill="none"
          stroke={COLOR_TOKENS}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Message line */}
        <path
          className="ba-chart__line ba-chart__line--messages"
          d={messagePath}
          fill="none"
          stroke={COLOR_MESSAGES}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="6 3"
        />

        {/* Token dots */}
        {data.map((d, i) => (
          <circle
            key={`tdot-${i}`}
            className="ba-chart__dot ba-chart__dot--tokens"
            cx={xScale(i)}
            cy={yTokens(d.tokenCount)}
            r="4"
            fill={COLOR_TOKENS}
            onMouseEnter={() => {
              setTooltip({ x: xScale(i), y: yTokens(d.tokenCount) - 12, point: d });
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}

        {/* Message dots */}
        {data.map((d, i) => (
          <circle
            key={`mdot-${i}`}
            className="ba-chart__dot ba-chart__dot--messages"
            cx={xScale(i)}
            cy={yMessages(d.messageCount)}
            r="4"
            fill={COLOR_MESSAGES}
            onMouseEnter={() => {
              setTooltip({ x: xScale(i), y: yMessages(d.messageCount) - 12, point: d });
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}

        {/* Tooltip */}
        {tooltip && (
          <g>
            <rect
              x={tooltip.x - 70}
              y={tooltip.y - 48}
              width="140"
              height="44"
              rx="6"
              fill="rgba(2, 44, 34, 0.9)"
            />
            <text x={tooltip.x} y={tooltip.y - 32} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="600">
              {tooltip.point.date}
            </text>
            <text x={tooltip.x} y={tooltip.y - 18} textAnchor="middle" fill="#34d399" fontSize="10">
              Tokens: {formatNumber(tooltip.point.tokenCount)}
            </text>
            <text x={tooltip.x} y={tooltip.y - 6} textAnchor="middle" fill="#2dd4bf" fontSize="10">
              Messages: {tooltip.point.messageCount}
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="ba-chart__legend">
        <div className="ba-chart__legend-item">
          <span className="ba-chart__legend-swatch ba-chart__legend-swatch--tokens" />
          Token Count
        </div>
        <div className="ba-chart__legend-item">
          <span className="ba-chart__legend-swatch ba-chart__legend-swatch--messages" />
          Message Count
        </div>
      </div>
    </div>
  );
}

// ─── Main View Component ─────────────────────────────────────────────────────

export default function TimeSeriesView() {
  const [apps, setApps] = useState<TimeSeriesApp[]>([]);
  const [selectedAppId, setSelectedAppId] = useState("");
  const [loadingApps, setLoadingApps] = useState(true);
  const [data, setData] = useState<TimeSeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Load available apps on mount
  useEffect(() => {
    (async () => {
      try {
        const appList = await fetchTimeSeriesApps();
        setApps(appList);
        if (appList.length > 0) {
          setSelectedAppId(appList[0].id);
        }
      } catch (err: any) {
        setError(err.message || "Failed to load applications");
      } finally {
        setLoadingApps(false);
      }
    })();
  }, []);

  // Load cached data when selected app changes
  const loadCache = useCallback(async (appId: string) => {
    if (!appId) return;
    setLoading(true);
    setError("");
    try {
      const cached = await fetchTimeSeriesCache(appId);
      setData(cached);
    } catch (err: any) {
      setError(err.message || "Failed to load cache");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAppId) {
      loadCache(selectedAppId);
    } else {
      setData([]);
    }
  }, [selectedAppId, loadCache]);

  async function handleRefresh() {
    if (!selectedAppId) return;
    setRefreshing(true);
    setError("");
    try {
      // 1. Fetch messages for the selected app
      const messages = await fetchMessagesForTimeSeries(selectedAppId);

      // 2. Group by date and compute tokens
      const dayMap = new Map<string, { tokens: number; messages: number }>();

      for (const msg of messages) {
        const createdOn = value(msg.sys_created_on);
        if (!createdOn) continue;
        // Extract YYYY-MM-DD from ServiceNow datetime (YYYY-MM-DD HH:MM:SS)
        const dateStr = createdOn.substring(0, 10);
        if (!dateStr || dateStr.length !== 10) continue;

        const existing = dayMap.get(dateStr) || { tokens: 0, messages: 0 };
        existing.messages += 1;

        const info = analyzeMessage(msg);
        if (info) {
          existing.tokens += info.tokens;
        }

        dayMap.set(dateStr, existing);
      }

      // 3. Build sorted points
      const points: TimeSeriesPoint[] = Array.from(dayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, agg]) => ({
          date,
          tokenCount: agg.tokens,
          messageCount: agg.messages,
        }));

      // 4. Save each point to cache (in parallel batches of 5)
      for (let i = 0; i < points.length; i += 5) {
        const batch = points.slice(i, i + 5);
        await Promise.all(batch.map((p) => saveTimeSeriesPoint(p, selectedAppId)));
      }

      // 5. Update UI
      setData(points);
    } catch (err: any) {
      setError(err.message || "Failed to refresh data");
    } finally {
      setRefreshing(false);
    }
  }

  // ─── Compute KPIs ───────────────────────────────────────────────────────────

  const totalTokens = data.reduce((sum, d) => sum + d.tokenCount, 0);
  const totalMessages = data.reduce((sum, d) => sum + d.messageCount, 0);
  const avgTokensPerDay = data.length > 0 ? Math.round(totalTokens / data.length) : 0;
  const peakDay = data.length > 0
    ? data.reduce((peak, d) => (d.tokenCount > peak.tokenCount ? d : peak), data[0])
    : null;

  // Get selected app name for subtitle
  const selectedAppName = apps.find((a) => a.id === selectedAppId)?.name || "";

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loadingApps) {
    return <div className="ba-loading">Loading applications…</div>;
  }

  return (
    <div className="ba-view">
      <div className="ba-view__title">📈 TimeSeries Analytics</div>
      <div className="ba-view__subtitle">
        {selectedAppName
          ? `Daily token consumption and message volume for ${selectedAppName}`
          : "Select an application to view token and message usage over time"}
      </div>

      {/* App Selector */}
      <select
        className="ba-app-selector"
        value={selectedAppId}
        onChange={(e) => setSelectedAppId(e.target.value)}
      >
        <option value="">Select an application</option>
        {apps.map((app) => (
          <option key={app.id} value={app.id}>
            {app.name}
          </option>
        ))}
      </select>

      {selectedAppId && (
        <>
          {/* KPI Cards */}
          <div className="ba-kpi-row">
            <KpiCard title="Total Tokens" value={formatNumber(totalTokens)} icon="tokens" />
            <KpiCard title="Total Messages" value={formatNumber(totalMessages)} icon="assistant" />
            <KpiCard title="Avg Tokens/Day" value={formatNumber(avgTokensPerDay)} icon="cost" />
            <KpiCard
              title="Peak Day"
              value={peakDay ? formatDate(peakDay.date) : "—"}
              icon="duration"
              tooltip={peakDay ? `${formatNumber(peakDay.tokenCount)} tokens` : undefined}
            />
          </div>

          {/* Refresh button */}
          <div className="ba-section__header">
            <h2 className="ba-section__title">Daily Activity</h2>
            <button
              className="ba-scan-btn"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Computing…" : "⟳ Refresh Data"}
            </button>
          </div>

          {error && <div className="ba-scan-error">{error}</div>}

          {/* Chart */}
          {loading ? (
            <div className="ba-loading">Loading time series data…</div>
          ) : (
            <TimeSeriesChart data={data} />
          )}
        </>
      )}

      {!selectedAppId && (
        <div className="ba-chart__empty">
          Please select an application above to view its time series analytics.
        </div>
      )}
    </div>
  );
}
