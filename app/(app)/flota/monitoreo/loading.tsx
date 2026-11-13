import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

/** Propio de Monitoreo: heredaba el esqueleto «Vehículos» de `/flota` y la TopBar mostraba otro título mientras cargaba. */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Monitoreo GPS"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Monitoreo GPS" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
