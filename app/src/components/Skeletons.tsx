import clsx from "clsx";
import { Card } from "./ui/Card";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx("animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-800", className)}
      aria-hidden="true"
    />
  );
}

export function StatCardSkeleton() {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-9 rounded-lg" />
      </div>
      <Skeleton className="mt-4 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-24" />
    </Card>
  );
}

export function GaugeSkeleton() {
  return (
    <Card className="flex flex-col items-center justify-center gap-4 p-8">
      <Skeleton className="h-56 w-56 rounded-full" />
      <Skeleton className="h-4 w-40" />
    </Card>
  );
}

export function ChartSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-4 h-64 w-full" />
    </Card>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card className="p-5">
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Card>
  );
}
