import { PageContainer } from "@/components/ui/page-container"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    </PageContainer>
  )
}
