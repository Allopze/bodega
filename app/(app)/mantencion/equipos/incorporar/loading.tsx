import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Incorporar desde la flota" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Equipos", href: "/mantencion/equipos" }, { label: "Incorporar desde la flota" }]} />
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
