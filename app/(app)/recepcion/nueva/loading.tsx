import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Nueva recepción"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Recepción", href: "/recepcion" },
            { label: "Nueva" },
          ]} />
        }
      />
      <SkeletonPage rows={5} />
    </>
  )
}
