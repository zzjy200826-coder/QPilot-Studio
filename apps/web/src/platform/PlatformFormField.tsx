import type { ReactNode } from "react";

export const PlatformFormField = ({
  label,
  children,
  hint,
  htmlFor
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
}) => (
  <div>
    <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-slate-700">
      {label}
    </label>
    {children}
    {hint ? <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p> : null}
  </div>
);
