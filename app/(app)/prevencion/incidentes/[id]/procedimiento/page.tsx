import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { db } from "@/db"
import { preventionIncidents, incidentNotifications, incidentStatements, incidentInvestigations, incidentDisseminations } from "@/db/schema"
import { eq } from "drizzle-orm"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = { title: "Procedimiento de incidente" }

export default async function IncidenteProcedimientoPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:incident_procedure:view")) redirect("/forbidden")

  const { id } = await params
  const [incident] = await db.select().from(preventionIncidents).where(eq(preventionIncidents.id, id)).limit(1)
  if (!incident) notFound()

  const [notifications, statements, investigations, disseminations] = await Promise.all([
    db.select().from(incidentNotifications).where(eq(incidentNotifications.incidentId, id)),
    db.select().from(incidentStatements).where(eq(incidentStatements.incidentId, id)),
    db.select().from(incidentInvestigations).where(eq(incidentInvestigations.incidentId, id)),
    db.select().from(incidentDisseminations).where(eq(incidentDisseminations.incidentId, id)),
  ])

  const steps = [
    { label: "Aviso inmediato", done: notifications.some((n) => n.kind === "aviso_inmediato"), items: notifications.filter((n) => n.kind === "aviso_inmediato") },
    { label: "Informe preliminar (3h)", done: notifications.some((n) => n.kind === "informe_preliminar"), items: notifications.filter((n) => n.kind === "informe_preliminar") },
    { label: "Encuesta / Declaración", done: statements.length > 0, items: statements },
    { label: "DIAT", done: notifications.some((n) => n.kind === "diat"), items: notifications.filter((n) => n.kind === "diat") },
    { label: "Investigación (72h)", done: investigations.some((i) => i.status === "cerrada" || i.completedAt), items: investigations },
    { label: "Informe definitivo", done: notifications.some((n) => n.kind === "informe_definitivo"), items: notifications.filter((n) => n.kind === "informe_definitivo") },
    { label: "Difusión", done: disseminations.length > 0, items: disseminations },
    { label: "Seguimiento", done: notifications.some((n) => n.kind === "one_page"), items: notifications.filter((n) => n.kind === "one_page") },
  ]

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Incidentes", href: "/prevencion/incidentes" }, { label: incident.title }]} />
      <PageHeader title="Procedimiento de incidente" description={`${incident.type} · ${incident.severity} · Flujo N° 66-78 PDTP`} />
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="rounded border p-3 flex items-start gap-3">
            <Badge variant={step.done ? "success" : "outline"}>{step.done ? "✓" : (i + 1)}</Badge>
            <div>
              <p className="text-sm font-medium">{step.label}</p>
              <p className="text-xs text-muted-foreground">{step.items.length > 0 ? `${step.items.length} registros` : "Pendiente"}</p>
            </div>
          </div>
        ))}
      </div>
    </PageContainer>
  )
}
