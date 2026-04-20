import type { ReactNode } from "react";

type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "violet";

const toneClassName: Record<BadgeTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700"
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
    className={`inline-flex items-center rounded-full border ${toneClassName[tone]} ${
      dense ? "px-2.5 py-1 text-[11px]" : "px-3 py-1 text-xs"
    } ${uppercase ? "uppercase tracking-[0.18em]" : ""}`}
  >
    {children}
  </span>
);
