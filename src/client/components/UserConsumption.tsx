import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  fetchUserConsumption,
  fetchConsumptionMonths,
} from "../services/api.ts";
import type { UserConsumptionRow } from "../services/api.ts";
import { useQueryTracker } from "../services/queryTracker.ts";
import { SkeletonConsumptionView } from "./Skeleton.tsx";
import DataTable from "./DataTable.tsx";
import type { Column } from "./DataTable.tsx";
import KpiCard from "./KpiCard.tsx";
import { NauBreakdownPanel } from "./NauBreakdown.tsx";

interface UserConsumptionProps {
  onNavigate: (view: string, id?: string, month?: string | null) => void;
}

/**
 * Hoisted to module scope: DataTable is memoized, and an inline object literal
 * would hand it a brand new `defaultSort` reference on every render. DataTable
 * only reads it to seed its initial sort state, so sharing one frozen object
 * changes nothing behaviourally.
 */
const DEFAULT_SORT = { key: "nauUnits", direction: "desc" } as const;

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(parseInt(year), parseInt(m) - 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function UserConsumption({ onNavigate }: UserConsumptionProps) {
  const [users, setUsers] = useState<UserConsumptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
  const [searchQuery, setSearchQuery] = useState("");

  // KPI totals
  const [kpiUsers, setKpiUsers] = useState(0);
  const [kpiConversations, setKpiConversations] = useState(0);
  const [kpiUserMessages, setKpiUserMessages] = useState(0);
  const [kpiNau, setKpiNau] = useState(0);
  const [kpiLoading, setKpiLoading] = useState(true);

  const [sortKey, setSortKey] = useState<string>("nauUnits");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { track, reset } = useQueryTracker();

  useEffect(() => {
    reset();
    loadMonths();
  }, []);

  useEffect(() => {
    loadData(selectedMonth);
  }, [selectedMonth]);

  async function loadMonths() {
    try {
      const available = await track("Fetching available months", () => fetchConsumptionMonths());
      setMonths(available);
      // If current month is not in the list, default to the most recent month
      if (available.length > 0 && !available.includes(selectedMonth)) {
        setSelectedMonth(available[0]);
      }
    } catch (e) {
      console.error("Error loading months:", e);
    }
  }

  async function loadData(month: string) {
    setLoading(true);
    setKpiLoading(true);
    try {
      const data = await track("Fetching consumption data", () => fetchUserConsumption(month));
      setUsers(data);

      // Compute KPIs from the data
      const totalUsers = data.length;
      const totalConvos = data.reduce((sum, u) => sum + u.conversations, 0);
      const totalUserMsgs = data.reduce((sum, u) => sum + u.userMessages, 0);
      const totalNau = data.reduce((sum, u) => sum + u.nauUnits, 0);

      setKpiUsers(totalUsers);
      setKpiConversations(totalConvos);
      setKpiUserMessages(totalUserMsgs);
      setKpiNau(totalNau);
    } catch (e) {
      console.error("Error loading consumption data:", e);
    } finally {
      setLoading(false);
      setKpiLoading(false);
    }
  }

  const refreshData = useCallback(async () => {
    await loadData(selectedMonth);
  }, [selectedMonth]);

  const handleSort = useCallback((key: string, direction: "asc" | "desc") => {
    setSortKey(key);
    setSortDir(direction);
  }, []);

  const handleRowClick = useCallback(
    (row: any) => {
      onNavigate("user-profile", row.userId);
    },
    [onNavigate]
  );

  // Sort users — memoized so typing in the search box no longer re-sorts the
  // whole list (and so DataTable gets a stable `rows` reference).
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
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
  }, [users, sortKey, sortDir]);

  // Apply search filter
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return sortedUsers;
    const q = searchQuery.toLowerCase();
    return sortedUsers.filter((user) => user.userName.toLowerCase().includes(q));
  }, [sortedUsers, searchQuery]);

  const columns: Column[] = useMemo(
    () => [
      { key: "userName", label: "User Name", sortable: true },
      { key: "conversations", label: "Conversations", sortable: true },
      { key: "userMessages", label: "User Messages", sortable: true },
      {
        key: "nauUnits",
        label: "Now Assist Units",
        sortable: true,
        render: (row: any) => (
          <NauBreakdownPanel breakdown={row.breakdown} compact />
        ),
      },
    ],
    []
  );

  if (loading && kpiLoading) return <SkeletonConsumptionView />;

  return (
    <div className="ba-view">
      <div className="ba-consumption-header">
        <div>
          <h1 className="ba-view__title">User Consumption</h1>
          <p className="ba-view__subtitle">
            Now Assist Unit consumption by user — each user message = 25 NAU.
          </p>
        </div>
        <div className="ba-month-nav">
          <button
            className="ba-month-nav__arrow"
            onClick={() => {
              const idx = months.indexOf(selectedMonth);
              if (idx < months.length - 1) setSelectedMonth(months[idx + 1]);
            }}
            disabled={months.indexOf(selectedMonth) >= months.length - 1}
            aria-label="Previous month"
            type="button"
          >
            ◀
          </button>
          <span className="ba-month-nav__label">{formatMonthLabel(selectedMonth)}</span>
          <button
            className="ba-month-nav__arrow"
            onClick={() => {
              const idx = months.indexOf(selectedMonth);
              if (idx > 0) setSelectedMonth(months[idx - 1]);
            }}
            disabled={months.indexOf(selectedMonth) <= 0}
            aria-label="Next month"
            type="button"
          >
            ▶
          </button>
        </div>
      </div>

      <div className="ba-kpi-row">
        <KpiCard
          title="Total Users"
          value={kpiUsers}
          loading={kpiLoading}
          onRefresh={refreshData}
        />
        <KpiCard
          title="Total Conversations"
          value={kpiConversations}
          loading={kpiLoading}
          onRefresh={refreshData}
        />
        <KpiCard
          title="User Messages"
          value={kpiUserMessages}
          loading={kpiLoading}
          onRefresh={refreshData}
        />
        <KpiCard
          title="Now Assist Units"
          value={kpiNau}
          loading={kpiLoading}
          onRefresh={refreshData}
        />
      </div>

      <div className="ba-search">
        <span className="ba-search__icon">🔍</span>
        <input
          className="ba-search__input"
          type="text"
          placeholder="Search by user name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search users"
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
        rows={filteredUsers}
        onRowClick={handleRowClick}
        emptyMessage={searchQuery ? "No users match your search" : "No consumption data for this period"}
        defaultSort={DEFAULT_SORT}
        onSort={handleSort}
      />
    </div>
  );
}
