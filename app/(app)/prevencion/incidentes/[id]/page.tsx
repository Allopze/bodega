import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, DownloadSimple, LockKeyOpen } from "@phosphor-icons/react/dist/ssr"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { formatDateTime } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  INCIDENT_EVENT_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  incidentStatusBadgeVariant,
  notificationStatusLabel,
} from "@/lib/prevention/incidents"
import {
  getPreventionIncidentDetail,
  listIncidentDiffusions,
  listIncidentNotificationResponsibles,
  type IncidentStatus,
} from "@/lib/services/prevention-incidents"
import { IncidentWorkflowPanel } from "./incident-workflow-panel"
import { RE20Panel } from "./re20-panel"

export const metadata: Metadata = { title: "Detalle de incidente" }

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ sensitive?: string; purpose?: string }>
}

function dateTime(value: string | null) {
  return value ? formatDateTime(value) : "—"
}

export default async function IncidentDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const query = await searchParams
  let session
  try { session = await requirePermission("prevention:incidents:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/incidentes")}`) }
  const access = { ctx: { userId: session.user.id }, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const requestSensitive = query.sensitive === "1" && Boolean(query.purpose?.trim())
  let bundle
  try {
    bundle = await getPreventionIncidentDetail({
      incidentId: id,
      access,
      includeSensitive: requestSensitive,
      purpose: query.purpose,
    })
  } catch {
    notFound()
  }
  if (!bundle) notFound()
  const incident = bundle.incident
  const responsibles = can(session, "prevention:incidents:triage")
    ? await listIncidentNotificationResponsibles(access, incident.worksiteId)
    : []
  const canSensitive = can(session, "prevention:incidents:view_sensitive")
  const canExport = can(session, "prevention:incidents:export")
  const diffusions = (await listIncidentDiffusions(incident.id)).map((d) => ({
    id: d.id,
    kind: d.kind as "shift" | "corrective_measures",
    summary: d.summary,
    status: d.status as "pending_confirmation" | "confirmed",
    markedAt: d.markedAt,
    confirmedAt: d.confirmedAt,
  }))
  const defaultTargetDate = new Date(new Date(incident.updatedAt).getTime() + 7 * 86_400_000).toISOString().slice(0, 10)

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={incident.code}
        description={`${INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType} · ${bundle.worksiteName}`}
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención" }, { label: "Incidentes", href: "/prevencion/incidentes" }, { label: incident.code }]} />}
        actions={<div className="flex gap-2">
          <Button asChild variant="secondary"><Link href="/prevencion/incidentes"><ArrowLeft className="size-4" />Bandeja</Link></Button>
          {canExport && <Button asChild variant="secondary"><Link href={`/api/prevencion/incidentes/${incident.id}/expediente`}><DownloadSimple className="size-4" />Expediente Excel</Link></Button>}
        </div>}
      />

      <div className="space-y-5">
        <section className="grid gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-eyebrow">Estado</p><Badge className="mt-2" variant={incidentStatusBadgeVariant(incident.status)}>{INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status}</Badge></div>
          <div><p className="text-eyebrow">Ocurrencia</p><p className="mt-2 text-sm font-medium">{dateTime(incident.occurredAt)}</p></div>
          <div><p className="text-eyebrow">Gravedad real</p><p className="mt-2 text-sm font-medium">{INCIDENT_SEVERITY_LABELS[incident.actualSeverity] ?? incident.actualSeverity}</p></div>
          <div><p className="text-eyebrow">Plazo crítico</p><p className={`mt-2 text-sm font-medium ${bundle.notifications.some((lane) => lane.status === "overdue") ? "text-[var(--color-danger)]" : ""}`}>{bundle.notifications.some((lane) => lane.status === "overdue") ? "Existe carril atrasado" : "Sin atraso abierto"}</p></div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.55fr)]">
          <div className="space-y-5">
            <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="font-semibold">Reporte inicial</h2>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div><dt className="text-[var(--color-text-subtle)]">Empresa</dt><dd>{incident.companyName}</dd></div>
                <div><dt className="text-[var(--color-text-subtle)]">Lugar</dt><dd>{incident.location}</dd></div>
                <div><dt className="text-[var(--color-text-subtle)]">Conocimiento</dt><dd>{dateTime(incident.knownAt)}</dd></div>
                <div><dt className="text-[var(--color-text-subtle)]">Reportante</dt><dd>{bundle.reporterName}</dd></div>
              </dl>
              <p className="mt-4 whitespace-pre-wrap text-sm">{incident.initialNarrative}</p>
              {incident.immediateMeasures && <div className="mt-4 rounded-lg bg-[var(--color-surface-2)] p-3"><p className="text-eyebrow">Medidas inmediatas</p><p className="mt-1 whitespace-pre-wrap text-sm">{incident.immediateMeasures}</p></div>}
              {incident.isFatalOrSerious && <p className="mt-3 text-sm font-semibold text-[var(--color-danger)]">Fatal/grave · {incident.operationsSuspended ? "operación suspendida" : "reinicio autorizado"}</p>}
            </section>

            <IncidentWorkflowPanel
              incident={incident}
              notifications={bundle.notifications}
              investigation={bundle.investigation}
              capa={bundle.capa}
              people={bundle.people}
              responsibles={responsibles}
              currentUser={{ id: session.user.id, name: session.user.name ?? session.user.email ?? "Usuario" }}
              permissions={session.user.permissions}
              defaultTargetDate={defaultTargetDate}
            />

            <RE20Panel
              incidentId={incident.id}
              preliminaryReportText={bundle.investigation?.preliminaryReportText}
              preliminaryReportAt={bundle.investigation?.preliminaryReportAt}
              canInvestigate={can(session, "prevention:incidents:investigate")}
              canConfirmDiffusion={can(session, "prevention:incidents:close")}
              diffusions={diffusions}
            />
          </div>

          <aside className="space-y-5">
            <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="font-semibold">Carriles legales</h2>
              {bundle.notifications.length === 0 ? <p className="mt-2 text-sm text-[var(--color-text-subtle)]">Este tipo no genera DIAT/DIEP o notificación fatal-grave.</p> : <ul className="mt-3 space-y-3">{bundle.notifications.map((lane) => <li key={lane.id} className="border-b border-[var(--color-border)] pb-3 last:border-0"><div className="flex justify-between gap-2"><strong className="text-sm uppercase">{lane.notificationType.replaceAll("_", " ")}</strong><Badge variant={lane.status === "overdue" ? "danger" : lane.status === "pending" ? "warning" : "success"}>{notificationStatusLabel(lane.status)}</Badge></div><p className="mt-1 text-xs text-[var(--color-text-subtle)]">Plazo: {dateTime(lane.deadlineAt)}</p>{lane.evidenceReference && <p className="mt-1 break-all text-xs">Evidencia: {lane.evidenceReference}</p>}</li>)}</ul>}
            </section>

            <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="font-semibold">Personas involucradas</h2>
              {bundle.people.length === 0 ? <p className="mt-2 text-sm text-[var(--color-text-subtle)]">No se registraron personas en el reporte inicial.</p> : <ul className="mt-3 space-y-2">{bundle.people.map((person) => <li key={person.id} className="rounded-lg bg-[var(--color-surface-2)] p-3 text-sm"><p className="font-medium">{person.displayLabel}</p><p className="text-xs text-[var(--color-text-subtle)]">{person.employerName} · {person.relationshipType}</p></li>)}</ul>}
              {canSensitive && !requestSensitive && <form method="get" className="mt-4 space-y-2"><input type="hidden" name="sensitive" value="1" /><Label htmlFor="sensitive-purpose">Propósito de acceso</Label><Input id="sensitive-purpose" name="purpose" required minLength={3} maxLength={300} placeholder="Investigación del incidente…" /><Button type="submit" variant="secondary" size="sm"><LockKeyOpen className="size-4" />Abrir vista reservada</Button></form>}
              {requestSensitive && <div className="mt-4 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3"><p className="text-xs font-semibold">Vista reservada auditada · propósito: {query.purpose}</p>{bundle.sensitivePeople.length === 0 ? <p className="mt-2 text-xs">No hay payload sensible.</p> : <ul className="mt-2 space-y-2">{bundle.sensitivePeople.map((entry) => <li key={entry.personId} className="text-xs"><pre className="whitespace-pre-wrap font-sans">{JSON.stringify(entry.payload, null, 2)}</pre></li>)}</ul>}</div>}
            </section>

            <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="font-semibold">Línea de tiempo</h2>
              <ol className="mt-3 space-y-3">{bundle.history.map((item) => <li key={item.id} className="border-l-2 border-[var(--color-border)] pl-3 text-sm"><p className="font-medium">{item.changeType.replaceAll("_", " ")}</p><p className="text-xs text-[var(--color-text-subtle)]">{dateTime(item.createdAt)}{item.fromStatus || item.toStatus ? ` · ${item.fromStatus ?? "inicio"} → ${item.toStatus ?? "—"}` : ""}</p>{item.reason && <p className="mt-1 text-xs">{item.reason}</p>}</li>)}</ol>
            </section>
          </aside>
        </div>
      </div>
    </PageContainer>
  )
}
