import type { ReactNode } from "react";

export const PlatformEmptyState = ({
  message,
  action
}: {
  message: string;
  action?: ReactNode;
}) => (
  <div className="rounded-[20px] border border-dashed border-slate-300/80 bg-[rgba(241,245,249,0.82)] px-4 py-6 text-sm text-slate-500">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p>{message}</p>
      {action}
    </div>
  </div>
);
