import { PageContainer } from "@/components/ui/page-container"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <div className="grid gap-5">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-28 w-full rounded-[var(--radius-2xl)]" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-36 rounded-[var(--radius-2xl)]" />
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <Skeleton className="h-96 rounded-[var(--radius-2xl)]" />
          <Skeleton className="h-96 rounded-[var(--radius-2xl)]" />
        </div>
      </div>
    </PageContainer>
  )
}
