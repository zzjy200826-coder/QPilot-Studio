import type { ReactNode } from "react";

export const PlatformPageShell = ({
  badge,
  projectLabel,
  title,
  actions,
  metrics,
  children,
  dense = false,
  accent = "sky"
}: {
  badge: ReactNode;
  projectLabel?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  metrics?: ReactNode;
  children: ReactNode;
  dense?: boolean;
  accent?: "sky" | "emerald" | "rose";
}) => {
  const accentGradient =
    accent === "emerald"
      ? "bg-[radial-gradient(circle_at_top_left,#dcfce7,transparent_35%),linear-gradient(135deg,#ffffff,#f8fafc)]"
      : accent === "rose"
        ? "bg-[radial-gradient(circle_at_top_left,#fee2e2,transparent_35%),linear-gradient(135deg,#ffffff,#f8fafc)]"
        : "bg-[radial-gradient(circle_at_top_left,#e0f2fe,transparent_35%),linear-gradient(135deg,#ffffff,#f8fafc)]";

  return (
    <div className={dense ? "space-y-4" : "space-y-6"}>
      <div className={`rounded-[32px] border border-slate-200 shadow-sm ${accentGradient} ${dense ? "p-5" : "p-6"}`}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              {badge}
              {projectLabel}
            </div>
            <h2 className={`font-semibold tracking-tight text-slate-950 ${dense ? "mt-3 text-2xl" : "mt-4 text-3xl"}`}>
              {title}
            </h2>
            {actions ? <div className="mt-4 flex flex-wrap gap-3">{actions}</div> : null}
          </div>
          {metrics ? (
            <aside className="grid gap-3 rounded-[28px] border border-slate-200 bg-white/90 p-5 sm:grid-cols-3">
              {metrics}
            </aside>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
};
