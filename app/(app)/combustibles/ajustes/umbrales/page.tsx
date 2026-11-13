import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { loadThresholdsData } from "../config-queries"
import { ThresholdsForm } from "./thresholds-form"

export const metadata: Metadata = { title: "Umbrales de revisión" }

export default async function AjustesUmbralesPage() {
  try { await requirePermission("combustibles:manage_control", FUEL_PATHS.ajustes) } catch { redirect("/forbidden") }

  const { settings, failed } = await loadThresholdsData()

  return (
    <PageContainer>
      <PageHeader
        title="Umbrales de revisión"
        description="¿Cuándo una carga pide revisión? Los umbrales que la marcan para que alguien la decida"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Ajustes", href: FUEL_PATHS.ajustes }, { label: "Umbrales de revisión" }]} />}
        actions={<FuelHeaderActions />}
      />
      <div className="space-y-4">
        <DegradedDataBanner degraded={failed ? ["umbrales"] : []} total={1} />
        <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">
          La plataforma deja una carga «por decidir» cuando algo no calza. Estos valores deciden cuándo pasa.
          Mientras nadie decide, sus litros cuentan, pero no entra a los promedios.
        </p>
        {/* Con la lectura caída el formulario partiría de los valores por defecto y guardaría encima de los reales. */}
        {failed ? null : <ThresholdsForm settings={settings} />}
      </div>
    </PageContainer>
  )
}
