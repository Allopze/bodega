import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { capaStatusBadgeVariant, capaStatusLabel } from "@/lib/prevention/capa"
import {
  COORDINATION_INFO_LABELS,
  COUNTERPARTY_TYPE_LABELS,
  ENGAGEMENT_DIRECTION_LABELS,
  ENGAGEMENT_KIND_LABELS,
} from "@/lib/prevention/external-engagements"
import { getExternalEngagement } from "@/lib/services/prevention-external-engagements"

export const metadata: Metadata = { title: "Detalle de interacción externa" }

/**
 * Destino de `capaSourceHref` para las acciones nacidas de una visita: desde la
 * acción correctiva se vuelve al acta que la originó.
 */
export default async function EngagementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("prevention:engagement:view") }
  catch { redirect("/forbidden") }

  const { id } = await params
  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }

  let detail
  try { detail = await getExternalEngagement(id, access) }
  catch { notFound() }

  const { engagement, worksiteName, createdByName, measures } = detail

  return (
    <PageContainer width="wide">
      <PageHeader
        title={engagement.subject}
        description={`${ENGAGEMENT_KIND_LABELS[engagement.kind] ?? engagement.kind} · ${engagement.counterpartyName} · ${engagement.occurredOn}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención", href: "/prevencion" },
          { label: "Visitas y coordinación", href: "/prevencion/coordinacion" },
          { label: engagement.code },
        ]} />}
        actions={<Badge variant={engagement.closedAt ? "success" : "outline"}>{engagement.closedAt ? "Cerrada" : "Abierta"}</Badge>}
      />

      <dl className="grid gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-eyebrow">Faena</dt><dd className="mt-1">{worksiteName}</dd></div>
        <div><dt className="text-eyebrow">Contraparte</dt><dd className="mt-1">{engagement.counterpartyName} · {COUNTERPARTY_TYPE_LABELS[engagement.counterpartyType] ?? engagement.counterpartyType}</dd></div>
        {engagement.counterpartyRut && <div><dt className="text-eyebrow">RUT</dt><dd className="mt-1 font-mono text-sm">{engagement.counterpartyRut}</dd></div>}
        {engagement.kind === "coordinacion" && (
          <div><dt className="text-eyebrow">Dirección</dt><dd className="mt-1">{ENGAGEMENT_DIRECTION_LABELS[engagement.direction] ?? engagement.direction}</dd></div>
        )}
        {engagement.officialReference && <div><dt className="text-eyebrow">Acta / resolución</dt><dd className="mt-1">{engagement.officialReference}</dd></div>}
        <div><dt className="text-eyebrow">Registrada por</dt><dd className="mt-1">{createdByName}</dd></div>
        {engagement.infoTypes?.length ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-eyebrow">Información intercambiada</dt>
            <dd className="mt-1">{engagement.infoTypes.map((type) => COORDINATION_INFO_LABELS[type as keyof typeof COORDINATION_INFO_LABELS] ?? type).join(" · ")}</dd>
          </div>
        ) : null}
        {engagement.summary && (
          <div className="sm:col-span-2 lg:col-span-3"><dt className="text-eyebrow">Resumen</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{engagement.summary}</dd></div>
        )}
        {engagement.outcome && (
          <div className="sm:col-span-2 lg:col-span-3"><dt className="text-eyebrow">Resultado</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{engagement.outcome}</dd></div>
        )}
      </dl>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold">Medidas prescritas</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Cada medida es una acción correctiva con responsable, plazo y verificación. Las que
          prescribe el organismo administrador son de cumplimiento obligatorio (DS 44 art. 70).
        </p>
        {measures.length === 0 ? (
          <EmptyState compact title="Sin medidas prescritas" description="La visita no dejó compromisos con plazo." />
        ) : (
          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead className="min-w-[20rem]">Hallazgo y medida</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Plazo</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {measures.map((measure) => (
                  <TableRow key={measure.id}>
                    <TableCell>
                      <Button asChild size="sm" variant="secondary">
                        <Link href={`/prevencion/capa/${measure.id}`}>{measure.code}</Link>
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{measure.finding}</div>
                      <div className="mt-1 text-xs text-[var(--color-text-muted)]">{measure.actionDescription}</div>
                      {measure.normativaLegal && <div className="mt-1 text-xs text-[var(--color-text-muted)]">Norma: {measure.normativaLegal}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{measure.responsibleSnapshot ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">{measure.targetDate}</TableCell>
                    <TableCell><Badge variant={capaStatusBadgeVariant(measure.status)}>{capaStatusLabel(measure.status)}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        )}
      </section>
    </PageContainer>
  )
}
