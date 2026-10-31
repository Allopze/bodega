import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { TaeImportReportForm } from "../../../tae/importar/tae-import-report-form"

export const metadata: Metadata = { title: "Agregar histórico de sellos" }

export default async function AgregarSellosPage() {
  try { await requirePermission("combustibles:tae_import", FUEL_PATHS.fuentes) } catch { redirect("/forbidden") }

  return (
    <PageContainer width="form">
      <PageHeader
        title="Agregar histórico de sellos"
        description="La planilla antigua del formulario de sellos. Revisa el reporte de equivalencias antes de confirmar la importación"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Histórico de sellos" }]} />}
        actions={
          <FuelHeaderActions>
            <Button asChild variant="ghost" size="sm"><Link href={`${FUEL_PATHS.fuentesArchivos}?tipo=sellos`}>Ver archivos importados</Link></Button>
          </FuelHeaderActions>
        }
      />
      <TaeImportReportForm />
    </PageContainer>
  )
}
