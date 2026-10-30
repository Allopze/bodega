import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { PanelFiltersBar } from "@/components/mantencion/jefatura/panel/panel-filters-bar"
import { FleetCard, HoursCard, NotDoneCard, UpcomingCard, WeeklyCard, WorkshopCard } from "@/components/mantencion/jefatura/panel/panel-cards"
import { PanelKpis, PanelStrip } from "@/components/mantencion/jefatura/panel/panel-kpis"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { loadPanel, loadPanelWorksites } from "@/lib/services/mantencion/panel"
import { parsePanelFilters } from "@/lib/services/mantencion/panel-filters"
import { PanelExportButton } from "./panel-export-button"

export const metadata: Metadata = { title: "Panel de mantención" }
export const dynamic = "force-dynamic"

export default async function MantencionPanelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"])
  } catch {
    redirect("/forbidden")
  }
  const viewer = viewerFromSession(session)
  const raw = await searchParams
  const filters = parsePanelFilters(raw)

  const [worksites, data] = await Promise.all([loadPanelWorksites(viewer), loadPanel(viewer, filters)])
  // Una faena de la URL que no está en el alcance del usuario no se ofrece ni se muestra elegida.
  const worksiteId = worksites.some((item) => item.id === filters.worksiteId) ? (filters.worksiteId ?? "") : ""
  const exportParams: Record<string, string> = { periodo: filters.period, ...(worksiteId ? { faena: worksiteId } : {}) }

  return (
    <PageContainer>
      <PageHeader
        title="Panel de mantención"
        description="Qué equipos necesitan mantención, qué está en taller y cuánto se ha registrado."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Panel" }]}
        actions={can(session, "mant:export") ? <PanelExportButton params={exportParams} /> : undefined}
      />

      <PanelFiltersBar period={filters.period} worksiteId={worksiteId} worksites={worksites} />
      <PanelKpis data={data} />
      <PanelStrip data={data} />

      {/*
        Lo accionable primero. Columna izquierda: el estado de los EQUIPOS (qué
        está detenido, qué toca y cómo está la flota); derecha: el contexto de
        los REGISTROS (cuánto se registra por semana, dónde se gastan las horas
        y qué ítems quedan sin hacer). El orden del DOM es el de lectura en
        teléfono (una sola columna) y en escritorio (izquierda y luego derecha).
        Las columnas no se estiran: cada una apila sus tarjetas con su altura.
      */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <WorkshopCard data={data} />
          <UpcomingCard data={data} />
          <FleetCard data={data} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <WeeklyCard data={data} />
          <HoursCard data={data} />
          <NotDoneCard data={data} />
        </div>
      </div>
    </PageContainer>
  )
}
