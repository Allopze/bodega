import { cn } from "@/lib/utils"

/** Skeleton shimmer — matches layout shape, not a generic spinner in the center. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-2)]",
        "relative overflow-hidden",
        // Subtle shimmer sweep
        "after:absolute after:inset-0 after:-translate-x-full",
        "after:bg-gradient-to-r after:from-transparent after:via-[oklch(1_0_0/0.5)] after:to-transparent",
        "after:animate-[shimmer_1.5s_infinite]",
        className,
      )}
      {...props}
    />
  )
}

/** Row skeleton for table loading states */
function SkeletonRow({ cols = 4, className }: { cols?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 py-3 px-4", className)}>
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          style={{ width: `${[20, 30, 25, 15][i % 4]}%` }}
        />
      ))}
    </div>
  )
}

/** Page-level skeleton for initial load */
function SkeletonPage({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-0 divide-y divide-[var(--color-border)]">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} cols={4} />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonRow, SkeletonPage }
