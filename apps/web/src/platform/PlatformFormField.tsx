import type { ReactNode } from "react";

export const PlatformFormField = ({
  label,
  children,
  hint
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) => (
  <div>
    <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
    {children}
    {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
  </div>
);
