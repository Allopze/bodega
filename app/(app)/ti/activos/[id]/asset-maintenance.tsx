import { formatDate, formatCLP } from "@/lib/utils"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { IT_MAINTENANCE_TYPE_META } from "@/lib/services/ti/constants"
import { MaintenanceSheet } from "../../mantenciones/maintenance-sheet"

interface MaintenanceRow {
  id: string
  assetId: string
  assetCode: string
  assetBrand: string | null
  assetModel: string | null
  type: string
  date: string
  reportedIssue: string | null
  diagnosis: string | null
  workDone: string
  partsUsed: string | null
  cost: number
  supplierId: string | null
  supplierName: string | null
  technicianName: string | null
  technicianUserId: string | null
  technicianUserName: string | null
  observations: string | null
}

interface AssetMaintenanceProps {
  assetId: string
  rows: MaintenanceRow[]
  canManage: boolean
  suppliers: { id: string; name: string }[]
}

export function AssetMaintenance({ assetId, rows, canManage, suppliers }: AssetMaintenanceProps) {
  const totalCost = rows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0)
  const lastDate = rows.length > 0 ? rows[0]!.date : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xs">
        <div className="flex gap-8">
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Mantenciones</p>
            <p className="font-mono text-xl font-bold text-[var(--color-text)]">{rows.length}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Costo acumulado</p>
            <p className="font-mono text-xl font-bold text-[var(--color-text)]">{formatCLP(totalCost)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Última mantención</p>
            <p className="font-mono text-xl font-bold text-[var(--color-text)]">{lastDate ? formatDate(lastDate) : "—"}</p>
          </div>
        </div>
        {canManage && (
          <MaintenanceSheet
            trigger={<Button type="button" variant="secondary" size="sm">Registrar mantención</Button>}
            assetId={assetId}
            suppliers={suppliers}
          />
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Sin mantenciones registradas"
          description="Registra la primera mantención o reparación de este equipo."
        />
      ) : (
        rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MetaBadge meta={{ label: IT_MAINTENANCE_TYPE_META[row.type] ?? row.type, variant: "warning" }} />
                <span className="text-xs text-[var(--color-text-muted)]">{formatDate(row.date)}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-semibold text-[var(--color-text)]">{formatCLP(Number(row.cost ?? 0))}</span>
                {canManage && (
                  <MaintenanceSheet
                    trigger={<Button type="button" variant="link" size="sm">Editar</Button>}
                    suppliers={suppliers}
                    editMaintenance={row}
                  />
                )}
              </div>
            </div>

            <dl className="mt-3 space-y-2 text-sm">
              {row.reportedIssue && (
                <div>
                  <dt className="text-xs font-semibold text-[var(--color-text-muted)]">Problema reportado</dt>
                  <dd className="text-[var(--color-text)]">{row.reportedIssue}</dd>
                </div>
              )}
              {row.diagnosis && (
                <div>
                  <dt className="text-xs font-semibold text-[var(--color-text-muted)]">Diagnóstico</dt>
                  <dd className="text-[var(--color-text)]">{row.diagnosis}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-semibold text-[var(--color-text-muted)]">Trabajo realizado</dt>
                <dd className="text-[var(--color-text)]">{row.workDone}</dd>
              </div>
              {row.partsUsed && (
                <div>
                  <dt className="text-xs font-semibold text-[var(--color-text-muted)]">Repuestos</dt>
                  <dd className="text-[var(--color-text)]">{row.partsUsed}</dd>
                </div>
              )}
            </dl>

            {(row.supplierName || row.technicianName || row.technicianUserName) && (
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                {[row.technicianName, row.technicianUserName, row.supplierName && `Proveedor: ${row.supplierName}`]
                  .filter(Boolean).join(" · ")}
              </p>
            )}
          </article>
        ))
      )}
    </div>
  )
}
