import type { ReactNode } from "react";

type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "violet";

const toneClassName: Record<BadgeTone, string> = {
  neutral: "border-slate-300/70 bg-white/80 text-slate-700",
  info: "border-sky-300/60 bg-sky-50/90 text-sky-800",
  success: "border-emerald-300/70 bg-emerald-50/90 text-emerald-800",
  warning: "border-amber-300/70 bg-amber-50/90 text-amber-900",
  danger: "border-rose-300/70 bg-rose-50/90 text-rose-800",
  violet: "border-violet-300/70 bg-violet-50/90 text-violet-800"
};

export const PlatformBadge = ({
  children,
  tone = "neutral",
  dense = false,
  uppercase = false
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dense?: boolean;
  uppercase?: boolean;
}) => (
  <span
    className={`inline-flex items-center rounded-full border shadow-sm ${toneClassName[tone]} ${
      dense ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
    } ${uppercase ? "font-data uppercase tracking-[0.18em]" : "font-medium"}`}
  >
    {children}
  </span>
);
