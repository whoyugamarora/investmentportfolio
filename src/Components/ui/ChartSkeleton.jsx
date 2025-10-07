import Skeleton from "./Skeleton";

export default function ChartSkeleton({ className = "" }) {
  return (
    <div className={`h-[220px] md:h-[320px] w-full relative ${className}`}>
      <Skeleton className="absolute inset-0 rounded-xl" />
      {/* fake axes & lines */}
      <div className="absolute inset-0 p-4 md:p-6">
        <div className="h-full grid grid-rows-6 gap-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-[1px] w-full opacity-60" />
          ))}
        </div>
        <div className="absolute inset-0 p-6 flex items-end gap-2">
          {[...Array(12)].map((_, i) => (
            <Skeleton key={i} className="h-[20%] md:h-[35%] w-4 md:w-6" />
          ))}
        </div>
      </div>
    </div>
  );
}
