import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Registrar carga"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Cargas", href: "/combustibles/bitacora" }, { label: "Registrar carga" }]} />}
      />
      <PageContainer width="form">
        <Skeleton className="mb-4 h-14 w-full" />
        <Skeleton className="mb-4 h-14 w-full" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    </>
  )
}
