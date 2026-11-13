import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Forma del formulario de alta: tres tarjetas de campos. */
export default function Loading() {
  return (
    <PageContainer width="form">
      <PageHeader
        title="Nueva factura"
        description="Registra una carga facturada con su neto, IEC e IVA"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Facturas y pagos", href: FUEL_PATHS.pagos }, { label: "Nueva factura" }]} />}
      />
      <div className="space-y-6">
        <Skeleton className="h-72 w-full rounded-[var(--radius-2xl)]" />
        <Skeleton className="h-48 w-full rounded-[var(--radius-2xl)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-2xl)]" />
      </div>
    </PageContainer>
  )
}
