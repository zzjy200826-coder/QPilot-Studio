import type { ReactNode } from "react";

export const PlatformSectionHeader = ({
  eyebrow,
  title,
  description,
  actions,
  dense = false
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  dense?: boolean;
}) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      {eyebrow ? (
        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{eyebrow}</p>
      ) : null}
      <h3 className={`font-semibold text-slate-950 ${dense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
        {title}
      </h3>
      {description ? <p className="mt-2 text-sm text-slate-500">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
  </div>
);
