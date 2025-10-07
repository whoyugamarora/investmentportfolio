import Skeleton from "./Skeleton";

export default function TableSkeleton({ rows = 7 }) {
  return (
    <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
      <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800">
        <Skeleton className="h-4 w-1/3" />
      </div>
      <div className="divide-y divide-black/5 dark:divide-white/10">
        {[...Array(rows)].map((_, i) => (
          <div key={i} className="grid grid-cols-4 gap-3 px-3 py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16 justify-self-end" />
          </div>
        ))}
      </div>
    </div>
  );
}
