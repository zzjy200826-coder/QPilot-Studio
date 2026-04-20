import type { ReactNode } from "react";

export const PlatformAdvancedPanel = ({
  open,
  onToggle,
  title,
  description,
  label,
  hideLabel,
  children
}: {
  open: boolean;
  onToggle: () => void;
  title?: string;
  description?: string;
  label?: string;
  hideLabel?: string;
  children: ReactNode;
}) => (
  <div className="space-y-3">
    <button
      type="button"
      onClick={onToggle}
      className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
    >
      {open ? hideLabel ?? "Hide advanced" : label ?? title ?? "Advanced"}
    </button>

    {open ? (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        {title || description ? (
          <div className="mb-3">
            {title ? <p className="text-sm font-medium text-slate-900">{title}</p> : null}
            {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    ) : null}
  </div>
);
