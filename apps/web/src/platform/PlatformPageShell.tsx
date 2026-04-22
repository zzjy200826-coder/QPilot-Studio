import type { ReactNode } from "react";

export const PlatformPageShell = ({
  badge,
  projectLabel,
  title,
  description,
  actions,
  metrics,
  children,
  dense = false,
  accent = "sky"
}: {
  badge: ReactNode;
  projectLabel?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  metrics?: ReactNode;
  children: ReactNode;
  dense?: boolean;
  accent?: "sky" | "emerald" | "rose";
}) => {
  const accentLine =
    accent === "emerald"
      ? "from-emerald-500/90 via-emerald-300/45 to-emerald-100/10"
      : accent === "rose"
        ? "from-rose-500/90 via-rose-300/45 to-rose-100/10"
        : "from-sky-500/90 via-sky-300/45 to-sky-100/10";

  return (
    <div className={dense ? "space-y-4" : "space-y-6"}>
      <section className={`console-masthead ${dense ? "px-5 py-5" : "px-6 py-6"}`}>
        <div className={`absolute inset-y-0 left-0 w-2 bg-gradient-to-b ${accentLine}`} />
        <div className="relative space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {badge}
              {projectLabel}
            </div>
          </div>

          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 max-w-5xl flex-1">
              <h2
                className={`font-semibold tracking-tight text-slate-950 ${
                  dense ? "text-[1.9rem]" : "text-[2.45rem]"
                }`}
              >
                {title}
              </h2>
              {description ? (
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{description}</p>
              ) : null}
              {actions ? <div className="mt-4 flex flex-wrap gap-3">{actions}</div> : null}
            </div>

            {metrics ? (
              <aside
                className={`console-panel-subtle grid shrink-0 gap-3 ${
                  dense ? "p-3" : "p-4"
                } sm:grid-cols-2 xl:min-w-[360px] xl:max-w-[440px]`}
              >
                {metrics}
              </aside>
            ) : null}
          </div>
        </div>
      </section>
      {children}
    </div>
  );
};
