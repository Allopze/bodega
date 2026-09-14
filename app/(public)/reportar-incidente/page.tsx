/**
 * INC-001 (auditoría 2026-09-14) — Canal público de reporte de incidentes.
 *
 * No existía: reportar exigía `prevention:incidents:report`, un permiso de
 * roles internos, así que un trabajador que presenciaba un cuasi accidente
 * dependía de que un mando lo registrara. La única superficie pública de
 * Prevención era el PPA, que cubre detener una tarea antes de empezarla, no
 * comunicar un hecho ocurrido.
 *
 * Sin sesión, como el PPA y el TAE. El reporte cae en un buzón que se tría; no
 * abre por sí solo el expediente formal ni sus plazos legales.
 */
import type { Metadata } from "next"
import { listWorksitesForPublicForm } from "@/lib/services/ppa"
import { IncidentReportForm } from "./report-form"

export const metadata: Metadata = { title: "Reportar un incidente" }

export default async function PublicIncidentReportPage({
  searchParams,
}: {
  searchParams: Promise<{ faena?: string }>
}) {
  const { faena } = await searchParams
  const worksites = await listWorksitesForPublicForm()
  const initialWorksiteId = faena && worksites.some((w) => w.id === faena) ? faena : ""

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <header className="mb-6 text-center">
        <h1 className="text-xl font-bold tracking-tight">Reportar un incidente</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Cuasi accidentes, condiciones inseguras y actos inseguros. Puedes hacerlo sin dar tu nombre.
        </p>
      </header>
      <IncidentReportForm worksites={worksites} initialWorksiteId={initialWorksiteId} />
    </main>
  )
}
