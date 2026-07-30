import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return <PageContainer><PageHeader title="Actividades del programa preventivo" /><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></PageContainer>
}
