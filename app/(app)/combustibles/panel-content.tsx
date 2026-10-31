import type { Session } from "next-auth"
import Link from "next/link"
import { can } from "@/lib/auth/can"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { AddFuelDataButton } from "@/components/combustibles/add-fuel-data-button"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { ConsultaPanel } from "@/components/combustibles/panel/panel-consulta"
import { PanelDueCard } from "@/components/combustibles/panel/panel-due-card"
import { FieldPanel } from "@/components/combustibles/panel/panel-field"
import { PanelFiguresCard } from "@/components/combustibles/panel/panel-figures-card"
import { PanelProgress, PanelStepsStrip } from "@/components/combustibles/panel/panel-steps"
import { loadPanelData, panelLinker } from "@/lib/combustibles/panel/data"
import { panelVariantForSession, type PanelVariant } from "@/lib/combustibles/panel/role-variant"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"

type SearchParams = Record<string, string | string[] | undefined>

const DESCRIPTIONS: Record<PanelVariant, string> = {
  jefatura: "Cómo va el período y qué falta para cerrarlo",
  contrato: "Tus cargas, tus archivos y lo que falta vincular",
  terreno: "Tus cargas y lo que te toca corregir",
  consulta: "El combustible de tus faenas, en tres frases",
}

/** El Panel con sus datos; `page.tsx` ya resolvió el permiso y las URL viejas. */
export async function PanelContent({ session, searchParams: sp }: { session: Session; searchParams: SearchParams }) {
  const period = await resolveFuelPeriodForPage(session, sp)

  const variant = panelVariantForSession(session)
  const data = await loadPanelData(session, period, variant)
  const link = panelLinker(period)

  const canRegister = can(session, "combustibles:register_load")
  const addDataOptions = fuelAddDataOptions(session)

  return (
    <PageContainer width={variant === "consulta" ? "form" : "wide"}>
      <PageHeader
        title="Panel de combustible"
        description={DESCRIPTIONS[variant]}
        breadcrumb={<FuelBreadcrumbs />}
        actions={
          <FuelHeaderActions period={period}>
            {addDataOptions.some((option) => option.allowed) ? <AddFuelDataButton options={addDataOptions} /> : null}
            {/* En terreno y contrato el bloque «Registrar una carga» ya es la acción principal. */}
            {canRegister && variant === "jefatura" ? (
              <Button asChild size="sm">
                <Link href={FUEL_PATHS.registrar}>Registrar carga</Link>
              </Button>
            ) : null}
          </FuelHeaderActions>
        }
      />

      {data.degraded.length > 0 ? (
        <div className="mb-4">
          <DegradedDataBanner degraded={data.degraded} total={data.total} />
        </div>
      ) : null}

      {data.variant === "jefatura" ? (
        <>
          <PanelProgress label={period.label} status={period.status} ready={data.steps.readyCount} total={data.steps.total} />
          <PanelStepsStrip steps={data.steps.steps} />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <PanelDueCard due={data.due} period={period} userId={session.user.id} link={link} />
            <PanelFiguresCard figures={data.figures} period={period} link={link} />
          </div>
        </>
      ) : data.variant === "consulta" ? (
        <ConsultaPanel data={data} period={period} canLinkPlates={can(session, "combustibles:manage_vehicles")} withPeriod={link} />
      ) : (
        <FieldPanel data={data} period={period} userId={session.user.id} canRegister={canRegister} link={link} />
      )}
    </PageContainer>
  )
}
