import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { loadEquipmentFamiliesData } from "../config-queries"
import { EquipmentFamiliesTable } from "./equipment-families-table"

export const metadata: Metadata = { title: "Familias de equipos" }

export default async function AjustesFamiliasPage() {
  let session
  try { session = await requirePermission("combustibles:manage_control", FUEL_PATHS.ajustes) } catch { redirect("/forbidden") }

  const { types, degraded, total } = await loadEquipmentFamiliesData()

  return (
    <PageContainer>
      <PageHeader
        title="Familias de equipos"
        description="Cómo se agrupan los equipos para comparar su rendimiento"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Ajustes", href: FUEL_PATHS.ajustes }, { label: "Familias de equipos" }]} />}
        actions={<FuelHeaderActions />}
      />
      <div className="space-y-4">
        <DegradedDataBanner degraded={degraded} total={total} />
        <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">
          La familia define con quién se compara cada tipo de equipo en «Consumo › Rendimiento». Un tipo fuera de las familias no aparece en esas vistas, pero sus litros siguen contando en el resto del módulo.
        </p>
        {degraded.length > 0 && types.length === 0 ? null : <EquipmentFamiliesTable types={types} catalogHref={can(session, "admin:fleet_catalog") ? "/admin/flota-catalogos/tipos-equipo" : null} />}
      </div>
    </PageContainer>
  )
}
