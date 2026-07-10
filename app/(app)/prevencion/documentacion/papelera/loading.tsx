import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Papelera"
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación", href: "/prevencion/documentacion" }, { label: "Papelera" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
