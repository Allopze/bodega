import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole, resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { ImportWizard } from "../../../importar/import-wizard"

export const metadata: Metadata = { title: "Agregar reporte de tarjeta" }

export default async function AgregarTarjetaPage() {
  let session
  try { session = await requirePermission("combustibles:import", FUEL_PATHS.fuentes) } catch { redirect("/forbidden") }

  // Un rol acotado sólo ofrece sus faenas; uno global puede cargar «todas» y repartir según la patente.
  const scope = resolveWorksiteScope(session)
  const worksitesList = scope.mode === "none"
    ? []
    : await db.query.worksites.findMany({
        where: scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined,
        orderBy: [worksites.name],
      })

  return (
    <PageContainer width="form">
      <PageHeader
        title="Agregar reporte de tarjeta"
        description="Totales por patente y mes de Copec o Aramco. Normalmente llegan solos cada mañana; sube un reporte sólo si falta alguno"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Reporte de tarjeta" }]} />}
        actions={
          <FuelHeaderActions>
            <Button asChild variant="ghost" size="sm"><Link href={`${FUEL_PATHS.fuentesArchivos}?tipo=tarjeta`}>Ver archivos importados</Link></Button>
          </FuelHeaderActions>
        }
      />
      <ImportWizard worksites={worksitesList} canImportAllWorksites={isGlobalRole(session)} />
    </PageContainer>
  )
}
