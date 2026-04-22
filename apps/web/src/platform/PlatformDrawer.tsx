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
  <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[3px]">
    <div className="flex h-full w-full max-w-[620px] flex-col border-l border-slate-200/80 bg-[rgba(248,250,252,0.98)] shadow-[0_24px_64px_rgba(2,6,23,0.24)]">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-6 py-5">
        <div>
          <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
            {subtitle ?? description ?? ""}
          </p>
          <h3 className="mt-2 text-[1.8rem] font-semibold tracking-tight text-slate-950">
            {title}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="console-button-secondary text-sm"
        >
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      {footer ? (
        <div className="flex items-center justify-end gap-3 border-t border-slate-200/80 px-6 py-4">
          {footer}
        </div>
      ) : null}
    </div>
  </div>
);
