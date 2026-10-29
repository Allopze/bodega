import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader title="Registro de mantención" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Registros", href: "/mantencion/registros" }]} />
      <SkeletonPage rows={8} />
    </>
  )
}
