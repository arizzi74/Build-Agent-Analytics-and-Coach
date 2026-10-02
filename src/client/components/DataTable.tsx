import React, { useMemo, useState } from "react";

export interface Column {
  key: string;
  label: string;
  render?: (row: any) => React.ReactNode;
  sortable?: boolean;
  sortKey?: string;
}

interface DataTableProps {
  columns: Column[];
  rows: any[];
  onRowClick?: (row: any) => void;
  expandContent?: (row: any) => React.ReactNode | null;
  emptyMessage?: string;
  defaultSort?: { key: string; direction: "asc" | "desc" };
  onSort?: (key: string, direction: "asc" | "desc") => void;
}

function DataTable({
  columns,
  rows,
  onRowClick,
  expandContent,
  emptyMessage = "No data available",
  defaultSort,
  onSort,
}: DataTableProps) {
  const [sortColumn, setSortColumn] = useState<string | null>(defaultSort?.key || null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(defaultSort?.direction || "asc");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  function handleHeaderClick(col: Column) {
    if (!col.sortable) return;
    const key = col.sortKey || col.key;
    let newDirection: "asc" | "desc" = "asc";
    if (sortColumn === key) {
      newDirection = sortDirection === "asc" ? "desc" : "asc";
    }
    setSortColumn(key);
    setSortDirection(newDirection);
    if (onSort) {
      onSort(key, newDirection);
    }
  }

  // If no external onSort handler, sort internally.
  // Memoized only — the internal-vs-external decision and the comparator are
  // untouched, so the resulting order is identical to before.
  const sortedRows = useMemo(
    () => (onSort ? rows : getSortedRows(rows, sortColumn, sortDirection)),
    [onSort, rows, sortColumn, sortDirection]
  );

  if (!sortedRows.length) {
    return <div className="ba-empty">{emptyMessage}</div>;
  }

  return (
    <div className="ba-table-wrapper">
      <table className="ba-table">
        <thead>
          <tr>
            {columns.map((col) => {
              const isActive = sortColumn === (col.sortKey || col.key);
              const classes = [
                col.sortable ? "ba-table__th--sortable" : "",
                isActive ? "ba-table__th--active" : "",
              ].filter(Boolean).join(" ");
              return (
                <th
                  key={col.key}
                  className={classes || undefined}
                  onClick={() => handleHeaderClick(col)}
                >
                  {col.label}
                  {col.sortable && isActive && (
                    <span className="ba-table__sort-indicator">
                      {sortDirection === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, idx) => {
            const content = expandContent ? expandContent(row) : null;
            const isExpanded = expandedRow === idx;
            return (
              <React.Fragment key={idx}>
                <tr
                  className={[
                    onRowClick ? "ba-table__row--clickable" : "",
                    content ? "ba-table__row--expandable" : "",
                    isExpanded ? "ba-table__row--expanded" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    if (content) {
                      setExpandedRow(isExpanded ? null : idx);
                    }
                    onRowClick?.(row);
                  }}
                >
                  {columns.map((col) => (
                    <td key={col.key}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
                {isExpanded && content && (
                  <tr className="ba-table__row--detail">
                    <td colSpan={columns.length}>
                      {content}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function getSortedRows(rows: any[], sortColumn: string | null, sortDirection: "asc" | "desc"): any[] {
  if (!sortColumn) return rows;
  return [...rows].sort((a, b) => {
    const aVal = a[sortColumn];
    const bVal = b[sortColumn];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    let comparison = 0;
    if (typeof aVal === "number" && typeof bVal === "number") {
      comparison = aVal - bVal;
    } else {
      comparison = String(aVal).localeCompare(String(bVal));
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });
}

/**
 * Memoized: the table re-rendered on every parent render even when neither the
 * columns nor the rows changed (e.g. opening a modal elsewhere in the view).
 * Consumers keep importing the default export under the same name.
 */
export default React.memo(DataTable);
