import type { ReactNode } from "react";

export const PlatformFiltersBar = ({
  filters,
  actions,
  dense = false
}: {
  filters?: ReactNode;
  actions?: ReactNode;
  dense?: boolean;
}) => (
  <div
    className={`flex flex-wrap items-center justify-between gap-3 ${
      dense ? "pb-3" : "pb-4"
    }`}
  >
    <div className="flex flex-wrap items-center gap-2">{filters}</div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);
