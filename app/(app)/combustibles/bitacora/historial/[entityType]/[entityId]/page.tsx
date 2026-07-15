import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { auditLog, statusHistory } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDateTime } from "@/lib/utils"

export const metadata: Metadata = { title: "Historial de cambios" }

const ENTITY_LABEL: Record<string, string> = {
  fuel_tae_submission: "Carga TAE",
  fuel_load: "Carga facturada",
}

function parseState(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function DiffRow({ field, oldValue, newValue }: { field: string; oldValue: unknown; newValue: unknown }) {
  return (
    <div className="grid grid-cols-[140px_1fr_1fr] gap-2 border-b border-(--color-border) py-1.5 text-xs last:border-0">
      <span className="font-medium text-(--color-text-muted)">{field}</span>
      <span className="font-mono text-(--color-danger)">{JSON.stringify(oldValue) ?? "—"}</span>
      <span className="font-mono text-(--color-success-ink)">{JSON.stringify(newValue) ?? "—"}</span>
    </div>
  )
}

export default async function FuelLogHistoryPage({ params }: { params: Promise<{ entityType: string; entityId: string }> }) {
  try { await requirePermission("combustibles:view_audit") } catch { redirect("/forbidden") }
  const { entityType, entityId } = await params
  if (!(entityType in ENTITY_LABEL)) redirect("/combustibles/bitacora")

  const [auditRows, statusRows] = await Promise.all([
    db.query.auditLog.findMany({ where: and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)), orderBy: [desc(auditLog.createdAt)] }),
    db.query.statusHistory.findMany({ where: and(eq(statusHistory.entityType, entityType), eq(statusHistory.entityId, entityId)), orderBy: [desc(statusHistory.changedAt)] }),
  ])

  return (
    <PageContainer width="form">
      <PageHeader
        title="Historial de cambios"
        description={`${ENTITY_LABEL[entityType]} · ${entityId}`}
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Bitácora general", href: "/combustibles/bitacora" }, { label: "Historial" }]} />}
      />

      <Card className="mb-5">
        <CardHeader><CardTitle>Cambios de estado ({statusRows.length})</CardTitle></CardHeader>
        <CardContent>
          {statusRows.length === 0 ? <p className="text-sm text-(--color-text-muted)">Sin cambios de estado registrados.</p> : (
            <ul className="space-y-2">
              {statusRows.map((row) => (
                <li key={row.id} className="border-b border-(--color-border) pb-2 text-sm last:border-0">
                  <span className="font-medium">{row.fromStatus ?? "—"} → {row.toStatus}</span>
                  <span className="ml-2 text-xs text-(--color-text-muted)">{formatDateTime(row.changedAt)}</span>
                  {row.reason && <p className="mt-1 text-xs text-(--color-text-muted)">{row.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Auditoría de campos ({auditRows.length})</CardTitle></CardHeader>
        <CardContent>
          {auditRows.length === 0 ? <p className="text-sm text-(--color-text-muted)">Sin auditoría registrada para este registro.</p> : (
            <ul className="space-y-4">
              {auditRows.map((row) => {
                const oldState = parseState(row.oldState)
                const newState = parseState(row.newState)
                const fields = new Set([...Object.keys(oldState ?? {}), ...Object.keys(newState ?? {})])
                return (
                  <li key={row.id} className="border-b border-(--color-border) pb-4 last:border-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-(--color-text-muted)">
                      <span className="font-medium text-(--color-text)">{row.action}</span>
                      <span>{row.userEmail ?? "Sistema"}</span>
                      <span>{formatDateTime(row.createdAt)}</span>
                    </div>
                    {row.reason && <p className="mt-1 text-xs text-(--color-text-muted)">Motivo: {row.reason}</p>}
                    {fields.size > 0 && (
                      <div className="mt-2 grid grid-cols-[140px_1fr_1fr] gap-2 border-b border-(--color-border) pb-1 text-[10px] uppercase tracking-wide text-(--color-text-muted)">
                        <span>Campo</span><span>Anterior</span><span>Nuevo</span>
                      </div>
                    )}
                    {[...fields].map((field) => <DiffRow key={field} field={field} oldValue={oldState?.[field]} newValue={newState?.[field]} />)}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  )
}
