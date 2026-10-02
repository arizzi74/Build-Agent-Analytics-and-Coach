import React, { useEffect, useState, useCallback, useMemo } from "react";
import { display, value } from "../utils/fields.ts";
import {
  fetchConversations,
  fetchAggregateCountByGroup,
  fetchAppDetails,
  fetchTableCount,
  fetchDistinctCount,
  fetchTotalNauConsumed,
} from "../services/api.ts";
import { useQueryTracker } from "../services/queryTracker.ts";
import { SkeletonApplicationsView } from "./Skeleton.tsx";
import DataTable from "./DataTable.tsx";
import type { Column } from "./DataTable.tsx";
import KpiCard from "./KpiCard.tsx";

interface ApplicationsProps {
  onNavigate: (view: string, id?: string) => void;
}

interface AppStat {
  id: string;
  name: string;
  description: string;
  conversations: number;
  messages: number;
  checkpoints: number;
  lastActivity: string;
  lastActivityRaw: string;
  isFavorite: boolean;
}

const FAVORITES_KEY = "ba_favorite_apps";

/** Module-level constant: a fresh object literal would break DataTable's React.memo. */
const DEFAULT_SORT = { key: "lastActivityRaw", direction: "desc" as const };

function loadFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* ignore parse errors */ }
  return new Set();
}

function saveFavorites(favorites: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favorites)));
}

export default function Applications({ onNavigate }: ApplicationsProps) {
  const [apps, setApps] = useState<AppStat[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [loading, setLoading] = useState(true);

  // KPI counts — sourced from the Aggregate API for accurate platform data
  const [kpiConversations, setKpiConversations] = useState<number>(0);
  const [kpiMessages, setKpiMessages] = useState<number>(0);
  const [kpiApps, setKpiApps] = useState<number>(0);
  const [kpiNau, setKpiNau] = useState<number>(0);
  const [kpiUsers, setKpiUsers] = useState<number>(0);
  const [kpiLoading, setKpiLoading] = useState(true);

  const [sortKey, setSortKey] = useState<string>("lastActivityRaw");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [searchQuery, setSearchQuery] = useState("");

  const { track, reset } = useQueryTracker();

  useEffect(() => {
    reset();
    loadKpis();
    loadTableData();
  }, []);

  /** Load KPI counts from the Aggregate (Stats) API — fast and accurate */
  async function loadKpis() {
    setKpiLoading(true);
    try {
      const [convos, msgs, apps, nau, users] = await Promise.all([
        track("Counting conversations", () => fetchTableCount("sn_build_agent_conversation")),
        track("Counting messages", () => fetchTableCount("sn_build_agent_message")),
        track("Counting apps", () => fetchDistinctCount("sn_build_agent_conversation", "application_id", "application_idISNOTEMPTY")),
        track("Counting NAU consumed", () => fetchTotalNauConsumed()),
        track("Counting users", () => fetchDistinctCount("sn_build_agent_conversation", "user", "userISNOTEMPTY")),
      ]);
      setKpiConversations(convos);
      setKpiMessages(msgs);
      setKpiApps(apps);
      setKpiNau(nau);
      setKpiUsers(users);
    } catch (e) {
      console.error("KPI load error:", e);
    } finally {
      setKpiLoading(false);
    }
  }

  /** Individual refresh handlers for each KPI card */
  const refreshConversations = useCallback(async () => {
    const count = await fetchTableCount("sn_build_agent_conversation");
    setKpiConversations(count);
  }, []);

  const refreshMessages = useCallback(async () => {
    const count = await fetchTableCount("sn_build_agent_message");
    setKpiMessages(count);
  }, []);

  const refreshApps = useCallback(async () => {
    const count = await fetchDistinctCount("sn_build_agent_conversation", "application_id", "application_idISNOTEMPTY");
    setKpiApps(count);
  }, []);

  const refreshNau = useCallback(async () => {
    const count = await fetchTotalNauConsumed();
    setKpiNau(count);
  }, []);

  const refreshUsers = useCallback(async () => {
    const count = await fetchDistinctCount("sn_build_agent_conversation", "user", "userISNOTEMPTY");
    setKpiUsers(count);
  }, []);

  const toggleFavorite = useCallback((appId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  /** Load full table data for the DataTable (per-app breakdown) */
  async function loadTableData() {
    try {
      // Message and checkpoint counts come from the Aggregate (Stats) API grouped
      // by `conversation` — a DIRECT foreign key, so we stay clear of the
      // dot-walked group_by ordering ambiguity. Previously the whole message and
      // checkpoint tables were downloaded just to count rows client-side.
      // The per-app rollup stays client-side, using the conversation→app map
      // built from the conversation list below.
      const [convos, msgByConvo, chkByConvo] = await Promise.all([
        track("Fetching conversations", () => fetchConversations("ORDERBYDESClast_message_at")),
        track("Counting messages per conversation", () =>
          fetchAggregateCountByGroup("sn_build_agent_message", "conversation")
        ),
        track("Counting checkpoints per conversation", () =>
          fetchAggregateCountByGroup("sn_build_agent_checkpoint", "conversation")
        ),
      ]);

      // Build preliminary app map
      const appMap = new Map<string, AppStat>();
      const storedFavorites = loadFavorites();

      convos.forEach((c: any) => {
        const appId = value(c.application_id);
        if (!appId) return;
        const convoId = value(c.sys_id);
        const existingName = display(c.application_name);
        const existing = appMap.get(appId) || {
          id: appId,
          name: existingName || "",
          description: "",
          conversations: 0,
          messages: 0,
          checkpoints: 0,
          lastActivity: "",
          lastActivityRaw: "",
          isFavorite: storedFavorites.has(appId),
        };
        existing.conversations += 1;
        // A conversation with no messages/checkpoints simply has no group in the
        // aggregate result: treat the absence as 0 (never undefined/NaN).
        existing.messages += msgByConvo.get(convoId) || 0;
        existing.checkpoints += chkByConvo.get(convoId) || 0;
        if (!existing.lastActivity) {
          existing.lastActivity = display(c.last_message_at);
          existing.lastActivityRaw = value(c.last_message_at);
        }
        // Track the best name available
        if (existingName && !existing.name) {
          existing.name = existingName;
        }
        appMap.set(appId, existing);
      });

      // Resolve app details (name + description) from sys_app for ALL apps
      const allAppIds = Array.from(appMap.keys());
      if (allAppIds.length > 0) {
        const resolvedDetails = await track("Resolving app details", () => fetchAppDetails(allAppIds));
        resolvedDetails.forEach((info, id) => {
          const stat = appMap.get(id);
          if (stat) {
            if (!stat.name && info.name) stat.name = info.name;
            stat.description = info.description;
          }
        });
      }

      // Final fallback for any still unnamed
      appMap.forEach((stat) => {
        if (!stat.name) stat.name = `App (${stat.id.substring(0, 8)}...)`;
      });

      setApps(Array.from(appMap.values()));
    } catch (e) {
      console.error("Applications load error:", e);
    } finally {
      setLoading(false);
    }
  }

  // Stable identities: DataTable is wrapped in React.memo, so an inline arrow or
  // object literal here would defeat the memoization on every render.
  const handleSortChange = useCallback((key: string, direction: "asc" | "desc") => {
    setSortKey(key);
    setSortDir(direction);
  }, []);

  const handleRowClick = useCallback(
    (row: AppStat) => onNavigate("app-detail", row.id),
    [onNavigate]
  );

  // Sort: favorites pinned at top, then by user-selected column.
  // Memoized: without this the whole sort ran on every keystroke of the search box.
  const sortedApps = useMemo(() => {
    return [...apps]
      .map((app) => ({
        ...app,
        isFavorite: favorites.has(app.id),
      }))
      .sort((a, b) => {
        // Favorites always on top
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        // Sort by selected column
        const aVal = (a as any)[sortKey];
        const bVal = (b as any)[sortKey];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        let comparison = 0;
        if (typeof aVal === "number" && typeof bVal === "number") {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }
        return sortDir === "asc" ? comparison : -comparison;
      });
  }, [apps, favorites, sortKey, sortDir]);

  // Apply search filter on name and description
  const filteredApps = useMemo(() => {
    if (!searchQuery.trim()) return sortedApps;
    const q = searchQuery.toLowerCase();
    return sortedApps.filter(
      (app) =>
        app.name.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q)
    );
  }, [sortedApps, searchQuery]);

  const columns: Column[] = useMemo(
    () => [
      {
        key: "favorite",
        label: "★",
        render: (row: AppStat) => (
          <button
            className={`ba-star-btn ${row.isFavorite ? "ba-star-btn--active" : ""}`}
            onClick={(e) => toggleFavorite(row.id, e)}
            title={row.isFavorite ? "Remove from favorites" : "Add to favorites"}
            aria-label={row.isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            {row.isFavorite ? "★" : "☆"}
          </button>
        ),
      },
      { key: "name", label: "Application", sortable: true },
      { key: "conversations", label: "Conversations", sortable: true },
      { key: "messages", label: "Total Messages", sortable: true },
      { key: "checkpoints", label: "Checkpoints", sortable: true },
      { key: "lastActivity", label: "Last Activity", sortable: true, sortKey: "lastActivityRaw" },
    ],
    [toggleFavorite]
  );

  if (loading && kpiLoading) return <SkeletonApplicationsView />;

  return (
    <div className="ba-view">
      <h1 className="ba-view__title">Applications</h1>
      <p className="ba-view__subtitle">
        All applications built with Build Agent — click ★ to mark favorites, click a row to explore.
      </p>
      <div className="ba-kpi-row">
        <KpiCard
          title="Conversations"
          value={kpiConversations}
          loading={kpiLoading}
          onRefresh={refreshConversations}
        />
        <KpiCard
          title="Messages"
          value={kpiMessages}
          loading={kpiLoading}
          onRefresh={refreshMessages}
        />
        <KpiCard
          title="Apps Managed"
          value={kpiApps}
          loading={kpiLoading}
          onRefresh={refreshApps}
        />
        <KpiCard
          title="Now Assist Units"
          value={kpiNau}
          loading={kpiLoading}
          onRefresh={refreshNau}
        />
        <KpiCard
          title="Total Users"
          value={kpiUsers}
          loading={kpiLoading}
          onRefresh={refreshUsers}
        />
      </div>
      <p className="ba-kpi-disclaimer">
        ℹ️ KPI totals include <strong>all</strong> conversations — even those not linked to any application.
        The table below only shows conversations associated with a specific app.
      </p>
      <div className="ba-search">
        <span className="ba-search__icon">🔍</span>
        <input
          className="ba-search__input"
          type="text"
          placeholder="Search by name or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search applications"
        />
        {searchQuery && (
          <button
            className="ba-search__clear"
            onClick={() => setSearchQuery("")}
            type="button"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={filteredApps}
        onRowClick={handleRowClick}
        emptyMessage={searchQuery ? "No applications match your search" : "No applications found"}
        defaultSort={DEFAULT_SORT}
        onSort={handleSortChange}
      />
    </div>
  );
}
