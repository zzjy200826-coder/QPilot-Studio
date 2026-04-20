import type { ReactNode } from "react";

export const PlatformEmptyState = ({
  message,
  action
}: {
  message: string;
  action?: ReactNode;
}) => (
  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p>{message}</p>
      {action}
    </div>
  </div>
);
