import type { ReactNode } from "react";

export const PlatformSectionHeader = ({
  eyebrow,
  title,
  description,
  actions,
  dense = false,
  variant = "section"
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  dense?: boolean;
  variant?: "summary" | "section" | "table" | "inspector" | "evidence" | "timeline";
}) => {
  const titleClassName =
    variant === "summary"
      ? dense
        ? "mt-2 text-[1.65rem]"
        : "mt-2 text-[1.95rem]"
      : variant === "table"
        ? dense
          ? "mt-1 text-lg"
          : "mt-1 text-[1.45rem]"
        : dense
          ? "mt-1 text-xl"
          : "mt-2 text-[1.7rem]";

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        {eyebrow ? (
          <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
            {eyebrow}
          </p>
        ) : null}
        <h3 className={`font-semibold tracking-tight text-slate-950 ${titleClassName}`}>
          {title}
        </h3>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
};
