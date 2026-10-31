import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { loadSupplyMediaData } from "../config-queries"
import { NewSupplyMediumButton, SupplyMediaTable } from "./supply-media-table"

export const metadata: Metadata = { title: "¿Por dónde llega el combustible?" }

export default async function AjustesMediosPage() {
  try { await requirePermission("combustibles:manage_control", FUEL_PATHS.ajustes) } catch { redirect("/forbidden") }

  const { media, suppliers, degraded, total } = await loadSupplyMediaData()

  return (
    <PageContainer>
      <PageHeader
        title="¿Por dónde llega el combustible?"
        description="Los medios de suministro y sus reglas"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Ajustes", href: FUEL_PATHS.ajustes }, { label: "¿Por dónde llega el combustible?" }]} />}
        actions={<FuelHeaderActions><NewSupplyMediumButton suppliers={suppliers} /></FuelHeaderActions>}
      />
      <div className="space-y-4">
        <DegradedDataBanner degraded={Array.from({ length: degraded }, () => "fuente")} total={total} />
        <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">
          Los medios de suministro aparecen en el formulario en terreno y ordenan la cuadratura: tarjetas, estaciones, surtidores del mandante y estanques propios.
          Los alias traducen cómo los escribe la planilla de cargas.
        </p>
        {degraded > 0 && media.length === 0 ? null : (
          <SupplyMediaTable
            media={media}
            suppliers={suppliers}
            emptyAction={<NewSupplyMediumButton suppliers={suppliers} label="Crear el primer medio" withIcon={false} />}
          />
        )}
      </div>
    </PageContainer>
  )
}
