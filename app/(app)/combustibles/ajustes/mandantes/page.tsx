import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { loadMandantesData } from "../config-queries"
import { MandantesTable, NewMandanteButton } from "./mandantes-table"

export const metadata: Metadata = { title: "Mandantes y tolerancias" }

export default async function AjustesMandantesPage() {
  let session
  try { session = await requirePermission("combustibles:manage_control", FUEL_PATHS.ajustes) } catch { redirect("/forbidden") }

  const { mandantes, worksites, clients, degraded, total } = await loadMandantesData(session)

  return (
    <PageContainer>
      <PageHeader
        title="Mandantes y tolerancias"
        description="La diferencia aceptada en la cuadratura de cada mandante"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Ajustes", href: FUEL_PATHS.ajustes }, { label: "Mandantes y tolerancias" }]} />}
        actions={<FuelHeaderActions><NewMandanteButton worksites={worksites} clients={clients} /></FuelHeaderActions>}
      />
      <div className="space-y-4">
        <DegradedDataBanner degraded={Array.from({ length: degraded }, () => "fuente")} total={total} />
        <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">
          Cada faena pertenece a lo más a un mandante. La tolerancia es la diferencia aceptada entre lo que entró y lo que se entregó, en porcentaje de lo que entró.
        </p>
        {/* Con la lectura caída una lista vacía no significa «no hay mandantes»: el aviso de arriba ya lo dice. */}
        {degraded > 0 && mandantes.length === 0 ? null : (
          <MandantesTable
            mandantes={mandantes}
            worksites={worksites}
            clients={clients}
            emptyAction={<NewMandanteButton worksites={worksites} clients={clients} label="Crear el primer mandante" withIcon={false} />}
          />
        )}
      </div>
    </PageContainer>
  )
}
