import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader title="Registro firmado" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Registros firmados", href: "/mantencion/registros" }]} />
      <SkeletonPage rows={8} />
    </>
  )
}
