import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Badge } from "@/components/ui/badge"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getCapaActionBundle, listAssignableCapaUsers, listCapaWorksites, type CapaStatus } from "@/lib/services/prevention-capa"
import { CAPA_SOURCE_LABELS, capaSourceHref, capaStatusBadgeVariant, capaStatusLabel, capaEvidenceKindLabel } from "@/lib/prevention/capa"
import { CapaControls } from "./capa-controls"
import { formatDateTime } from "@/lib/utils"

export const metadata: Metadata = { title: "Detalle CAPA" }

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-border)] py-2 last:border-0">
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className="mt-0.5 text-sm">{value || "—"}</dd>
    </div>
  )
}

export default async function CapaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let session
  try { session = await requirePermission("prevention:capa:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/capa")}`) }
  const scope = resolveWorksiteScope(session)
  let bundle
  try {
    bundle = await getCapaActionBundle({ actionId: id, scope, permissions: session.user.permissions })
  } catch {
    notFound()
  }
  const [users, worksites] = await Promise.all([
    listAssignableCapaUsers({ worksiteId: bundle.action.worksiteId, scope, permissions: session.user.permissions }),
    listCapaWorksites({ scope, permissions: session.user.permissions }),
  ])
  const worksiteName = worksites.find((item) => item.id === bundle.action.worksiteId)?.name ?? bundle.action.worksiteId
  const userName = new Map(users.map((item) => [item.id, item.name]))
  const sourceHref = capaSourceHref(bundle.action.sourceType, bundle.action.sourceId)

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={bundle.action.code}
        description={`${CAPA_SOURCE_LABELS[bundle.action.sourceType] ?? bundle.action.sourceType} · ${worksiteName}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Acciones CAPA", href: "/prevencion/capa" },
          { label: bundle.action.code },
        ]} />}
        headerActions={<Badge variant={capaStatusBadgeVariant(bundle.action.status)}>{capaStatusLabel(bundle.action.status)}</Badge>}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            <h2 className="text-sm font-semibold">Acción y origen</h2>
            <dl className="mt-2">
              <Row label="Fuente" value={sourceHref
                ? <Link href={sourceHref} className="text-[var(--color-primary-ink)] hover:underline">{CAPA_SOURCE_LABELS[bundle.action.sourceType] ?? bundle.action.sourceType} · {bundle.action.sourceId}</Link>
                : `${CAPA_SOURCE_LABELS[bundle.action.sourceType] ?? bundle.action.sourceType} · ${bundle.action.sourceId}`} />
              <Row label="Faena" value={worksiteName} />
              <Row label="Hallazgo" value={bundle.action.finding} />
              <Row label="Medida inmediata" value={bundle.action.immediateMeasure} />
              <Row label="Causa raíz" value={bundle.action.rootCause} />
              <Row label="Acción definitiva" value={bundle.action.actionDescription} />
              <Row label="Responsable" value={bundle.action.responsibleUserId
                ? userName.get(bundle.action.responsibleUserId) ?? bundle.action.responsibleUserId
                : "Sin asignar"} />
              <Row label="Responsable histórico" value={bundle.action.responsibleSnapshot} />
              <Row label="Prioridad / plazo" value={`${bundle.action.priority} · ${bundle.action.targetDate}`} />
              <Row label="Conciliación" value={bundle.action.reconciliationStatus} />
              <Row label="Eficacia" value={bundle.action.effectivenessAssessment
                ? `${bundle.action.effectivenessStatus} · ${bundle.action.effectivenessAssessment}`
                : bundle.action.effectivenessStatus} />
            </dl>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            <h2 className="text-sm font-semibold">Evidencia ({bundle.evidence.length})</h2>
            {bundle.evidence.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-text-subtle)]">Sin evidencia registrada. La acción no podrá enviarse a verificación si la exige.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {bundle.evidence.map((item) => (
                  <li key={item.id} className="border-l-2 border-[var(--color-border-strong)] pl-3 text-sm">
                    <p className="font-medium">{capaEvidenceKindLabel(item.kind)} · {item.reference}</p>
                    <p className="text-xs text-[var(--color-text-subtle)]">{item.description || "Sin descripción"} · {formatDateTime(item.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            <h2 className="text-sm font-semibold">Historial inmutable</h2>
            <ol className="mt-3 space-y-3">
              {bundle.transitions.map((item) => (
                <li key={item.id} className="border-l-2 border-[var(--color-primary-line)] pl-3">
                  <p className="text-sm font-medium">
                    {item.changeType === "status"
                      ? `${capaStatusLabel(item.fromStatus ?? "Inicio")} → ${capaStatusLabel(item.toStatus ?? "")}`
                      : item.changeType}
                  </p>
                  <p className="text-xs text-[var(--color-text-subtle)]">
                    {formatDateTime(item.createdAt)} · {userName.get(item.actorUserId) ?? item.actorUserId}
                    {item.reason ? ` · ${item.reason}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {bundle.followups.length > 0 && (
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <h2 className="text-sm font-semibold">Seguimientos</h2>
              <ul className="mt-3 space-y-2">
                {bundle.followups.map((item) => (
                  <li key={item.id} className="text-sm">
                    <span className="font-medium">{item.progress === null ? "Seguimiento" : `${item.progress}%`}</span>
                    {` · ${item.note}`}
                    <span className="block text-xs text-[var(--color-text-subtle)]">{formatDateTime(item.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <CapaControls
          action={{
            id: bundle.action.id,
            version: bundle.action.version,
            status: bundle.action.status as CapaStatus,
            priority: bundle.action.priority,
            targetDate: bundle.action.targetDate,
            responsibleUserId: bundle.action.responsibleUserId,
            reconciliationStatus: bundle.action.reconciliationStatus,
            sourceType: bundle.action.sourceType,
            sourceId: bundle.action.sourceId,
          }}
          users={users}
          permissions={{
            manage: can(session, "prevention:capa:manage"),
            complete: can(session, "prevention:capa:complete"),
            verify: can(session, "prevention:capa:verify"),
            close: can(session, "prevention:capa:close"),
            reconcile: can(session, "prevention:capa:reconcile"),
            overrideSegregation: can(session, "prevention:capa:override_segregation"),
          }}
        />
      </div>
    </PageContainer>
  )
}
