import type { ReactNode } from "react";

export const PlatformDrawer = ({
  open = true,
  title,
  subtitle,
  description,
  onClose,
  footer,
  children
}: {
  open?: boolean;
  title: string;
  subtitle?: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) =>
  !open ? null : (
  <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[1px]">
    <div className="flex h-full w-full max-w-[560px] flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
            {subtitle ?? description ?? ""}
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-slate-950">{title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
        >
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      {footer ? (
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
          {footer}
        </div>
      ) : null}
    </div>
  </div>
);
