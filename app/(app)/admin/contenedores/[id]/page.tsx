import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { MetaBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CONTAINER_STATUS_LABELS, containerStatusVariant, type ContainerStatus } from "@/lib/prevention/containers"
import { getContainerDetail } from "@/lib/services/prevention-containers"
import { formatDate } from "@/lib/utils"

export const metadata: Metadata = { title: "Contenedor" }

export default async function ContenedorDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "admin:containers")) redirect("/forbidden")

  let detail
  try {
    detail = await getContainerDetail(id, {
      userId: session.user.id,
      permissions: session.user.permissions,
      scope: serviceWorksiteScope(session),
    })
  } catch { notFound() }

  const { container, worksiteName, inspections, pdtpChecklistCount } = detail
  const status = container.status as ContainerStatus

  return <PageContainer width="workbench">
    <PageHeader
      title={container.code}
      description={`${worksiteName} · ${container.location}`}
      breadcrumb={<Breadcrumbs items={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Contenedores", href: "/admin/contenedores" },
        { label: container.code },
      ]} />}
    />

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-labelledby="container-status-heading" className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p id="container-status-heading" className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Estado actual</p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--color-text)]">{container.code}</h2>
          </div>
          <MetaBadge meta={{ label: `${CONTAINER_STATUS_LABELS[status] ?? container.status}`, variant: containerStatusVariant(status) }} dot />
        </div>
        <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Faena</dt>
            <dd className="font-medium text-[var(--color-text)]">{worksiteName}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Ubicación</dt>
            <dd className="font-medium text-[var(--color-text)]">{container.location}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Vigencia</dt>
            <dd className="text-[var(--color-text)]">{container.isActive ? "Vigente en el catálogo" : "Retirado del catálogo"}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Versión del registro</dt>
            <dd className="tabular-nums text-[var(--color-text)]">{container.version}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-[var(--color-text-subtle)]">Observaciones</dt>
            <dd className="text-[var(--color-text)]">{container.notes ?? "Sin observaciones"}</dd>
          </div>
        </dl>
      </section>

      <aside className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-xs" aria-labelledby="container-history-heading">
        <h2 id="container-history-heading" className="text-sm font-semibold text-[var(--color-text)]">Inspecciones de este contenedor</h2>
        {inspections.length === 0
          ? <EmptyState
              compact
              align="start"
              title="Sin inspecciones"
              description={pdtpChecklistCount > 0
                ? "Ninguna inspección del motor lo tomó como sujeto todavía; las verificaciones del PDTP se listan abajo."
                : "Cuando se ejecute una inspección eligiendo este contenedor, aparecerá acá."}
            />
          : <Table className="mt-3">
              <TableHeader>
                <TableRow>
                  <TableHead>Inspección</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Cumplimiento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspections.map((inspection) => <TableRow key={inspection.id}>
                  <TableCell>
                    <Link href={`/prevencion/inspecciones/${inspection.id}`} className="font-medium hover:underline">{inspection.code}</Link>
                    {/* La etiqueta se muestra tal como quedó congelada: si el
                        contenedor se movió o se renombró después, la evidencia
                        sigue diciendo lo que decía. */}
                    <span className="block text-xs text-[var(--color-text-subtle)]">{inspection.subjectLabel ?? "—"}</span>
                  </TableCell>
                  <TableCell className="tabular-nums">{inspection.executedAt ? formatDate(inspection.executedAt) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {inspection.compliancePercent === null ? "—" : `${inspection.compliancePercent}%`}
                    {inspection.nonConformingCount
                      ? <span className="block text-xs text-[var(--color-danger)]">{inspection.nonConformingCount} no conforme(s)</span>
                      : null}
                  </TableCell>
                </TableRow>)}
              </TableBody>
            </Table>}
        {/* El listado cuenta ambas fuentes; nombrarlas por separado evita que
            la ficha parezca vacía mientras el borrado está bloqueado. */}
        {pdtpChecklistCount > 0 && (
          <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
            Además, {pdtpChecklistCount} verificación(es) del programa PDTP toman este contenedor como sujeto.
          </p>
        )}
      </aside>
    </div>
  </PageContainer>
}
