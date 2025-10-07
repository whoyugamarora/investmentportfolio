export default function MetricBadge({ label, value, good }) {
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm
      ${good
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
        : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"}`}
    >
      {label && <span className="font-medium">{label}</span>}
      <span className="font-semibold">{value}</span>
    </div>
  );
}
