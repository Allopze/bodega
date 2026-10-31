import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { OperationsImportWizard } from "../../../importar/operations-import-wizard"

export const metadata: Metadata = { title: "Agregar planilla de cargas" }

export default async function AgregarPlanillaPage() {
  // La planilla abarca varias faenas por archivo: sólo la importa un rol con acceso a todas.
  try {
    const session = await requirePermission("combustibles:import", FUEL_PATHS.fuentes)
    if (!isGlobalRole(session)) throw new Error("Se requiere acceso global")
  } catch { redirect("/forbidden") }

  return (
    <PageContainer width="form">
      <PageHeader
        title="Agregar planilla de cargas"
        description="El consolidado con una fila por carga; se revisa antes de guardar"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Planilla de cargas" }]} />}
        actions={
          <FuelHeaderActions>
            <Button asChild variant="ghost" size="sm"><Link href={`${FUEL_PATHS.fuentesArchivos}?tipo=planilla`}>Ver archivos importados</Link></Button>
          </FuelHeaderActions>
        }
      />
      <OperationsImportWizard />
    </PageContainer>
  )
}
