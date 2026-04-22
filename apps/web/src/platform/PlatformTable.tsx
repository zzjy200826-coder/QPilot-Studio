import type { ReactNode } from "react";

export const PlatformTable = ({
  columns,
  children,
  emptyState,
  colSpan,
  dense = false
}: {
  columns: ReactNode[];
  children: ReactNode;
  emptyState?: ReactNode;
  colSpan?: number;
  dense?: boolean;
}) => (
  <div className="console-table-shell">
    <table className="min-w-full divide-y divide-slate-200/80 text-sm">
      <thead>
        <tr className="text-left font-data text-[11px] uppercase tracking-[0.24em] text-slate-400">
          {columns.map((column, index) => (
            <th
              key={index}
              className={index === columns.length - 1 ? "px-4 py-3" : "px-4 py-3 pr-4"}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100/90">{children}</tbody>
    </table>
    {emptyState && colSpan ? (
      <div className={dense ? "py-5" : "py-6"}>
        <table className="min-w-full text-sm">
          <tbody>
            <tr>
              <td colSpan={colSpan}>{emptyState}</td>
            </tr>
          </tbody>
        </table>
      </div>
    ) : null}
  </div>
);
