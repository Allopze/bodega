import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listTrainingComplianceSlots,
  listTrainingOccurrences,
  listTrainingOccurrenceWorksites,
  resolveTrainingOccurrenceYear,
} from "@/lib/services/prevention-training-occurrences"
import { resolveProgramActivationPeriod, resolveProgramActivationPeriods } from "@/lib/services/prevention-program-slots"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { buildSlotCalendar, parseCalendarMonth } from "@/lib/prevention/slot-compliance-calendar"
import { ProgramComplianceSection } from "@/components/prevention/program-compliance-section"
import { TrainingOccurrenceList } from "./training-occurrence-list"
import { PdtpScheduledActivityPanelServer } from "@/components/prevention/pdtp-scheduled-activity-panel-server"

export const metadata: Metadata = { title: "Campañas y Capacitación" }

export default async function CapacitacionPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("prevention:training:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const params = await searchParams
  // PREV-C03.4/C03.7: el año pedido (?year o ?anio) si tiene catálogo; si no,
  // el año operativo del programa, que en enero puede seguir siendo el anterior.
  const year = await resolveTrainingOccurrenceYear(params?.year ?? params?.anio)
  const rawWorksiteId = params?.faena
  const worksiteId =
    typeof rawWorksiteId === "string"
      ? rawWorksiteId.trim()
      : Array.isArray(rawWorksiteId)
        ? (rawWorksiteId[0]?.trim() ?? "")
        : ""
  // `?mes=` es el mes que el usuario eligió en el calendario de cumplimiento.
  const month = parseCalendarMonth(params?.mes)
  const exportParams = new URLSearchParams({ year: String(year) })
  if (worksiteId) exportParams.set("faena", worksiteId)
  const [occurrences, worksites, activationPeriod, complianceSlots] = await Promise.all([
    listTrainingOccurrences(access, {
      year,
      worksiteId: worksiteId || undefined,
      includeInactiveWorksites: Boolean(worksiteId),
    }),
    listTrainingOccurrenceWorksites(access),
    resolveProgramActivationPeriod(worksiteId || undefined, year),
    // El calendario muestra todas las faenas del alcance aunque la lista esté
    // filtrada a una: por eso tiene su propia consulta.
    listTrainingComplianceSlots(access, { year, includeWorksiteId: worksiteId || undefined }),
  ])
  const calendarWorksites = [...new Map(complianceSlots.map((slot) => [slot.worksiteId, { id: slot.worksiteId, label: slot.worksiteName }])).values()]
  const calendar = buildSlotCalendar({
    year,
    today: currentPdtpPeriod(),
    rows: calendarWorksites,
    slots: complianceSlots.map((slot) => ({
      rowId: slot.worksiteId,
      month: slot.scheduledMonth,
      week: slot.scheduledWeek,
      status: slot.status,
    })),
    activationByRow: await resolveProgramActivationPeriods(calendarWorksites.map((row) => row.id), year),
  })
  const viewHref = (view: { faena?: string; mes?: number | null }) => {
    const query = new URLSearchParams()
    if (view.faena) query.set("faena", view.faena)
    query.set("year", String(year))
    if (view.mes) query.set("mes", String(view.mes))
    return `/prevencion/capacitacion?${query.toString()}`
  }

  return (
    <PageContainer>
      <PageHeader
        title="Campañas y Capacitación"
        description="Control anual de campañas y capacitaciones por faena. Marca cada actividad como hecha o no hecha y conserva su evidencia."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Campañas y Capacitación" },
        ]} />}
        actions={
          session.user.permissions.includes("prevention:training:export") ? (
            <Button asChild variant="secondary">
              <a href={`/api/prevencion/capacitacion/export?${exportParams.toString()}`} download>Exportar Excel</a>
            </Button>
          ) : undefined
        }
      />
      {/* Sin casillas el calendario no se dibuja ni explica nada: la lista de
        * abajo ya dice qué falta y ofrece la salida, y repetirlo sería ruido. */}
      <ProgramComplianceSection
        title={`Cumplimiento del programa ${year}`}
        caption={`Cumplimiento mensual de campañas y capacitaciones ${year}, por faena`}
        calendar={calendar}
        noun={{ singular: "faena", plural: "faenas" }}
        hrefFor={(rowId, cellMonth) => viewHref({ faena: rowId, mes: cellMonth })}
        clearHref={viewHref({ faena: worksiteId, mes: null })}
        selected={worksiteId && month ? { rowId: worksiteId, month } : null}
        className="mb-4"
      />
      <TrainingOccurrenceList
        rows={occurrences}
        worksites={worksites}
        selectedYear={year}
        selectedWorksiteId={worksiteId}
        selectedMonth={month}
        canRecord={session.user.permissions.includes("prevention:training:record")}
        activationPeriod={activationPeriod}
      />
      <PdtpScheduledActivityPanelServer connectorKey="training" />
    </PageContainer>
  )
}
