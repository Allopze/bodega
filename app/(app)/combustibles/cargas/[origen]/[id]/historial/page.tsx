import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { LoadSection, LoadTimeline } from "@/components/combustibles/load-detail/load-sections"
import { loadHistory } from "@/lib/combustibles/fuel-log-detail"
import { AUDIT_ACTION_LABEL, auditDiffRows } from "@/lib/combustibles/fuel-log-timeline"
import { FUEL_PATHS, fuelLoadHref, isFuelLoadOrigin, withFuelContext } from "@/lib/combustibles/routes"
import { formatDateTime } from "@/lib/utils"

export const metadata: Metadata = { title: "Historial de la carga" }

type SearchParams = Record<string, string | string[] | undefined>

/**
 * Historial de una carga para quien audita (`view_audit`): primero lo que pasó,
 * en palabras («Ana validó la carga»); debajo, plegado, el detalle campo a campo
 * con el valor de antes y el de después. Una carga fuera del alcance de faenas
 * responde 404, igual que una que no existe.
 */
export default async function HistorialCargaPage({ params, searchParams }: { params: Promise<{ origen: string; id: string }>; searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view_audit", FUEL_PATHS.cargas) } catch { redirect("/forbidden") }
  const { origen, id } = await params
  if (!isFuelLoadOrigin(origen)) notFound()
  const search = await searchParams

  const history = await loadHistory(session, origen, id)
  if (!history) notFound()

  const fichaHref = withFuelContext(fuelLoadHref({ origen, id }), search)

  return (
    <PageContainer width="form">
      <PageHeader
        title={`Historial de la carga de ${history.equipmentLabel}`}
        description="Quién hizo qué con esta carga, y cuándo"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas", href: FUEL_PATHS.cargas }, { label: history.equipmentLabel, href: fichaHref }, { label: "Historial" }]} />}
        actions={<FuelHeaderActions />}
      />

      <div className="space-y-5">
        <LoadSection title="Qué pasó con esta carga" actions={<Link href={fichaHref} className="text-sm text-[var(--color-primary-ink)] hover:underline">Volver a la ficha</Link>}>
          <LoadTimeline events={history.timeline} />
        </LoadSection>

        <LoadSection title="Cambios campo a campo" description="El valor de antes y el de después de cada cambio registrado.">
          {history.audit.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Esta carga no tiene cambios registrados en la auditoría.</p>
          ) : (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                Ver cambios campo a campo ({history.audit.length})
              </summary>
              <ul className="mt-4 space-y-5">
                {history.audit.map((row) => {
                  const diff = auditDiffRows(row.oldState, row.newState)
                  return (
                    <li key={row.id} className="border-b border-[var(--color-border)] pb-4 last:border-0">
                      <p className="text-sm">
                        <span className="font-medium text-[var(--color-text)]">{AUDIT_ACTION_LABEL[row.action] ?? row.action}</span>
                        <span className="text-[var(--color-text-muted)]"> · {row.actor ?? "Sistema"} · </span>
                        <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{formatDateTime(row.createdAt)}</span>
                      </p>
                      {row.reason ? <p className="mt-1 text-sm text-[var(--color-text-muted)]">Motivo: {row.reason}</p> : null}
                      {diff.length > 0 && (
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full min-w-[28rem] text-sm">
                            <thead>
                              <tr className="text-left text-eyebrow">
                                <th scope="col" className="py-1 pr-3 font-semibold">Campo</th>
                                <th scope="col" className="py-1 pr-3 font-semibold">Antes</th>
                                <th scope="col" className="py-1 font-semibold">Después</th>
                              </tr>
                            </thead>
                            <tbody>
                              {diff.map((entry) => (
                                <tr key={entry.key} className="border-t border-[var(--color-border)]">
                                  <th scope="row" className="py-1.5 pr-3 text-left font-medium text-[var(--color-text-muted)]">{entry.field}</th>
                                  <td className="py-1.5 pr-3 font-mono text-xs text-[var(--color-danger-ink)]">{entry.before}</td>
                                  <td className="py-1.5 font-mono text-xs text-[var(--color-success-ink)]">{entry.after}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
        </LoadSection>
      </div>
    </PageContainer>
  )
}
