export const PlatformMetricCard = ({
  label,
  value,
  dense = false
}: {
  label: string;
  value: string | number;
  dense?: boolean;
}) => (
  <article
    className={`rounded-2xl border border-slate-200 bg-slate-50 ${
      dense ? "px-3 py-2.5" : "px-4 py-3"
    }`}
  >
    <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`font-semibold text-slate-950 ${dense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
      {value}
    </p>
  </article>
);
