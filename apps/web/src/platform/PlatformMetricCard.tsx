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
    className={`console-kpi ${
      dense ? "px-3 py-3" : "px-4 py-4"
    }`}
  >
    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{label}</p>
    <p
      className={`console-kpi-value font-semibold text-slate-950 ${
        dense ? "mt-1 text-xl" : "mt-2 text-[1.7rem]"
      }`}
    >
      {value}
    </p>
  </article>
);
