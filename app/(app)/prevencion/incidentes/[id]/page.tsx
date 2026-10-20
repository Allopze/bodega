import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, DownloadSimple, LockKeyOpen } from "@phosphor-icons/react/dist/ssr"
import { can, requirePermission } from "@/lib/auth/can"
import { auditIncidentSensitiveAccess } from "@/lib/services/prevention-incident-access"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { formatDateTime } from "@/lib/utils"
import { MetaBadge } from "@/components/states/state-badge"
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
  getPreventionIncidentRe20SensitivePayload,
  getPreventionIncidentRe20Workspace,
  listIncidentDiffusions,
  listIncidentFollowups,
  listIncidentOnePageDiffusions,
  listIncidentNotificationResponsibles,
  listIncidentRe20Participants,
  type IncidentStatus,
} from "@/lib/services/prevention-incidents"
import { IncidentWorkflowPanel } from "./incident-workflow-panel"
import { Re20WorkspaceShell } from "./re20/re20-workspace-shell"
import { SensitivePersonForm } from "./sensitive-person-form"
import { Re20PwaRegister } from "@/components/pwa/re20-pwa-register"

export const metadata: Metadata = { title: "Detalle de incidente" }

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ sensitive?: string; purpose?: string; etapa?: string }>
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
  const access = { ctx: { userId: session.user.id }, scope: resolveWorksiteScope(session), permissions: session.user.permissions, roles: session.user.roles ?? [] }
  // Sin `view_sensitive`, un enlace con `?sensitive=1` (compartido por alguien que sí lo tiene)
  // devolvía 404 del caso entero; se muestra la vista normal con el velo y el servicio sigue
  // sin entregar nada reservado.
  const askedSensitive = query.sensitive === "1" && Boolean(query.purpose?.trim())
  const requestSensitive = askedSensitive && can(session, "prevention:incidents:view_sensitive")
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
  // El intento sin permiso no abre nada, pero queda auditado como «denegado», con su propósito.
  if (askedSensitive && !requestSensitive) {
    await auditIncidentSensitiveAccess({
      access, incidentId: id, worksiteId: bundle.incident.worksiteId,
      purpose: query.purpose?.trim() ?? "", outcome: "denied", reasonCode: "permission",
    })
  }
  const canConfigureRe20 = can(session, "prevention:incidents:configure_re20")
  const re20 = await getPreventionIncidentRe20Workspace({ incidentId: id, access, includeInactiveOptions: canConfigureRe20 })
  if (!re20) notFound()
  const canSensitive = can(session, "prevention:incidents:view_sensitive")
  let re20Sensitive: Record<string, unknown> | null = null
  let re20SensitiveError: string | null = null
  if (requestSensitive && canSensitive) {
    try {
      const loaded = await getPreventionIncidentRe20SensitivePayload({ incidentId: id, purpose: query.purpose ?? "", access }) as (Record<string, unknown> & { declarations?: Array<Record<string, unknown>>; historicalStatements?: Array<Record<string, unknown>> }) | null
      if (loaded) {
        const declarations = loaded.declarations ?? []
        const known = new Set(declarations.map((entry) => String(entry.id)))
        const historic = (loaded.historicalStatements ?? []).filter((entry) => !known.has(String(entry.id))).map((entry) => ({
          id: String(entry.id),
          kind: entry.kind,
          name: entry.name,
          role: entry.role,
          statement: entry.statement,
          reserveIdentity: false,
          attachmentReferences: [],
          signedAt: entry.createdAt,
        }))
        re20Sensitive = { ...loaded, declarations: [...declarations, ...historic] }
      }
    } catch (error) {
      re20SensitiveError = error instanceof Error ? error.message : "No se pudo abrir la información sensible RE-20."
      re20Sensitive = null
    }
  }
  const incident = bundle.incident
  const responsibles = can(session, "prevention:incidents:triage")
    ? await listIncidentNotificationResponsibles(access, incident.worksiteId)
    : []
  const canExport = can(session, "prevention:incidents:export")
  const re20People = await listIncidentRe20Participants(access, incident.worksiteId)
  const re20UpdatedBy = re20.workspace?.updatedByUserId ? re20People.find((person) => person.id === re20.workspace?.updatedByUserId)?.name ?? null : null
  const personName = (id: string | null | undefined) => (id ? re20People.find((person) => person.id === id)?.name ?? null : null)
  const [shiftDiffusionRows, followupRows, onePageRows] = await Promise.all([
    listIncidentDiffusions(incident.id),
    listIncidentFollowups(incident.id),
    listIncidentOnePageDiffusions(incident.id),
  ])
  const diffusions = shiftDiffusionRows.map((d) => ({
    id: d.id,
    kind: d.kind as "shift" | "corrective_measures",
    summary: d.summary,
    status: d.status as "pending_confirmation" | "confirmed",
    markedAt: d.markedAt,
    confirmedAt: d.confirmedAt,
    markedByUserId: d.markedByUserId,
    markedByName: personName(d.markedByUserId),
    confirmedByName: personName(d.confirmedByUserId),
  }))
  const followups = followupRows.map((row) => ({
    id: row.id,
    kind: (row.kind === "damage" ? "damage" : "accident") as "accident" | "damage",
    followupDate: row.followupDate,
    note: row.note,
    measureId: row.measureId ?? null,
    implementedAt: row.implementedAt ?? null,
    verified: Boolean(row.verified),
    effective: Boolean(row.effective),
    verifierUserId: row.verifierUserId ?? null,
    verifiedAt: row.verifiedAt ?? null,
    residualRisk: row.residualRisk ?? null,
    lostDays: row.lostDays ?? null,
    lossDescription: row.lossDescription ?? null,
    createdAt: row.createdAt,
  }))
  const onePageDiffusions = [...onePageRows]
    .sort((a, b) => b.diffusedAt.localeCompare(a.diffusedAt))
    .map((row) => ({ id: row.id, diffusedAt: row.diffusedAt, createdByName: personName(row.createdByUserId) }))
  const defaultTargetDate = new Date(new Date(incident.updatedAt).getTime() + 7 * 86_400_000).toISOString().slice(0, 10)

  return (
    <PageContainer width="workbench">
      <Re20PwaRegister />
      <PageHeader
        title={incident.code}
        description={`${INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType} · ${bundle.worksiteName}`}
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención" }, { label: "Incidentes", href: "/prevencion/incidentes" }, { label: incident.code }]} />}
        actions={<div className="flex gap-2">
          <Button asChild variant="secondary"><Link href="/prevencion/incidentes"><ArrowLeft className="size-4" />Bandeja</Link></Button>
          {canExport && <Button asChild variant="secondary"><a href={`/api/prevencion/incidentes/${incident.id}/expediente`} download><DownloadSimple className="size-4" />Expediente Excel</a></Button>}
        </div>}
      />

      <div className="space-y-5">
        <section className="grid gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-eyebrow">Estado</p><MetaBadge meta={{ label: `${INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status}`, variant: incidentStatusBadgeVariant(incident.status) }} className="mt-2" /></div>
          <div><p className="text-eyebrow">Ocurrencia</p><p className="mt-2 text-sm font-medium">{dateTime(incident.occurredAt)}</p></div>
          <div><p className="text-eyebrow">Gravedad real</p><p className="mt-2 text-sm font-medium">{INCIDENT_SEVERITY_LABELS[incident.actualSeverity] ?? incident.actualSeverity}</p></div>
          <div><p className="text-eyebrow">Plazo crítico</p><p className={`mt-2 text-sm font-medium ${bundle.notifications.some((lane) => lane.status === "overdue") ? "text-[var(--color-danger)]" : ""}`}>{bundle.notifications.some((lane) => lane.status === "overdue") ? "Existe carril atrasado" : "Sin atraso abierto"}</p></div>
        </section>

        {/* El expediente RE-20 es el trabajo principal del caso: va a ancho completo,
            antes del ciclo de vida y sus carriles, para que el árbol de causas tenga espacio. */}
        <Re20WorkspaceShell
          incident={{
            id: incident.id,
            code: incident.code,
            companyName: incident.companyName,
            location: incident.location,
            // ISO: los datos reservados del RE-20 validan fechas ISO 8601 y Postgres entrega otro formato.
            occurredAt: new Date(incident.occurredAt).toISOString(),
            knownAt: new Date(incident.knownAt).toISOString(),
            potentialSeverity: incident.potentialSeverity,
            status: incident.status,
            actualSeverity: incident.actualSeverity,
            eventType: incident.eventType,
            isFatalOrSerious: incident.isFatalOrSerious,
            worksiteName: bundle.worksiteName,
            version: incident.version,
          }}
          workspace={re20.workspace ? { version: re20.workspace.version, data: re20.workspace.data, updatedAt: re20.workspace.updatedAt, updatedByName: re20UpdatedBy } : null}
          policy={re20.policy}
          options={re20.options.map((option) => ({ category: option.category, code: option.code, name: option.name, isActive: option.isActive, sortOrder: "sortOrder" in option ? option.sortOrder : null }))}
          qualityReviews={re20.qualityReviews.map((review) => ({ ...review, reviewerName: personName(review.reviewerUserId) }))}
          legacyInvestigation={bundle.investigation ? {
            methodology: bundle.investigation.methodology,
            preliminaryReportText: bundle.investigation.preliminaryReportText,
            preliminaryReportAt: bundle.investigation.preliminaryReportAt,
            conclusions: bundle.investigation.conclusions,
            immediateCauses: bundle.investigation.immediateCauses,
            basicCauses: bundle.investigation.basicCauses,
            organizationalCauses: bundle.investigation.organizationalCauses,
          } : null}
          sensitivePayload={re20Sensitive}
          sensitiveLoadError={re20SensitiveError}
          permissions={{
            canInvestigate: can(session, "prevention:incidents:investigate"),
            canSensitive,
            canNotify: can(session, "prevention:incidents:notify"),
            canReview: can(session, "prevention:incidents:review_quality"),
            canConfigure: canConfigureRe20,
            canConfirmDiffusion: can(session, "prevention:incidents:diffuse") && incident.status !== "closed",
          }}
          currentUser={{ id: session.user.id, name: session.user.name ?? session.user.email ?? "Usuario" }}
          userId={session.user.id}
          people={re20People}
          involvedPeople={bundle.people.map((person) => ({ id: person.id, displayLabel: person.displayLabel, relationshipType: person.relationshipType, employerName: person.employerName ?? null }))}
          diffusions={diffusions}
          followups={followups}
          renderedAt={new Date().toISOString()}
          onePageDiffusions={onePageDiffusions}
          notifications={bundle.notifications.map((item) => ({ notificationType: item.notificationType, status: item.status, deadlineAt: item.deadlineAt, sentAt: item.sentAt, evidenceReference: item.evidenceReference }))}
          capa={bundle.capa.map((item) => ({ id: item.id, code: item.code, status: item.status }))}
          initialPurpose={query.purpose ?? ""}
          initialStage={query.etapa ?? null}
        />

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.55fr)]">
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
              capa={bundle.capa}
              people={bundle.people}
              responsibles={responsibles}
              permissions={session.user.permissions}
              defaultTargetDate={defaultTargetDate}
            />

          </div>

          <aside className="space-y-5">
            <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="font-semibold">Carriles legales</h2>
              {bundle.notifications.length === 0 ? <p className="mt-2 text-sm text-[var(--color-text-subtle)]">Este tipo no genera DIAT/DIEP o notificación fatal-grave.</p> : <ul className="mt-3 space-y-3">{bundle.notifications.map((lane) => <li key={lane.id} className="border-b border-[var(--color-border)] pb-3 last:border-0"><div className="flex justify-between gap-2"><strong className="text-sm uppercase">{lane.notificationType.replaceAll("_", " ")}</strong><MetaBadge meta={{ label: `${notificationStatusLabel(lane.status)}`, variant: lane.status === "overdue" ? "danger" : lane.status === "pending" ? "warning" : "success" }} /></div><p className="mt-1 text-xs text-[var(--color-text-subtle)]">Plazo: {dateTime(lane.deadlineAt)}</p>{lane.evidenceReference && <p className="mt-1 break-all text-xs">Evidencia: {lane.evidenceReference}</p>}</li>)}</ul>}
            </section>

            <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="font-semibold">Personas involucradas</h2>
              {bundle.people.length === 0 ? <p className="mt-2 text-sm text-[var(--color-text-subtle)]">No se registraron personas en el reporte inicial.</p> : <ul className="mt-3 space-y-2">{bundle.people.map((person) => <li key={person.id} className="rounded-lg bg-[var(--color-surface-2)] p-3 text-sm"><p className="font-medium">{person.displayLabel}</p><p className="text-xs text-[var(--color-text-subtle)]">{person.employerName} · {person.relationshipType}</p></li>)}</ul>}
              {canSensitive && !requestSensitive && <form method="get" className="mt-4 space-y-2"><input type="hidden" name="sensitive" value="1" /><Label htmlFor="sensitive-purpose">Propósito de acceso</Label><Input id="sensitive-purpose" name="purpose" required minLength={3} maxLength={300} placeholder="Investigación del incidente…" /><Button type="submit" variant="secondary" size="sm"><LockKeyOpen className="size-4" />Abrir vista reservada</Button></form>}
              {requestSensitive && <div className="mt-4 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3"><p className="text-xs font-semibold">Vista reservada auditada · propósito: {query.purpose}</p>{bundle.sensitivePeople.length === 0 ? <p className="mt-2 text-xs">No hay payload sensible.</p> : <ul className="mt-2 space-y-2">{bundle.sensitivePeople.map((entry) => <li key={entry.personId} className="text-xs"><pre className="whitespace-pre-wrap font-sans">{JSON.stringify(entry.payload, null, 2)}</pre></li>)}</ul>}
                {/* El reporte promete que la identidad y la lesión se completan
                    aquí; con el expediente cerrado la ficha queda de sólo lectura. */}
                {canSensitive && incident.status !== "closed" && bundle.people.length > 0 && <div className="mt-3 space-y-4 border-t border-[var(--color-warning-line)] pt-3">{bundle.people.map((person) => <SensitivePersonForm key={`${person.id}-${incident.version}`} incidentId={incident.id} personId={person.id} personLabel={person.displayLabel} purpose={query.purpose ?? ""} payload={bundle.sensitivePeople.find((entry) => entry.personId === person.id)?.payload ?? null} />)}</div>}
              </div>}
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
