import type { InventoryMovementWithRelations } from "./types"
import { formatDate } from "@/lib/utils"
import { KardexExportButton } from "./kardex-export-button"

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ingreso_oc:            "Ingreso OC",
  egreso_entrega:        "Entrega",
  ingreso_devolucion:    "Devolución",
  egreso_desecho:        "Retiro",
  ajuste:                "Ajuste",
  egreso_traslado:       "Salida por guía",
  ingreso_traslado:      "Ingreso por guía",
  // Faltaba: la entrega EPP con retiro de equipo usado pintaba el enum crudo
  // en la tabla (regla A6).
  retiro_epp_trabajador: "Retiro EPP usado",
}

const MOVEMENT_QTY_CLASS: Record<string, string> = {
  ingreso_oc:         "text-[var(--color-success)] font-medium",
  egreso_entrega:     "text-[var(--color-danger)]",
  ingreso_devolucion: "text-[var(--color-success)]",
  egreso_desecho:     "text-[var(--color-warning-ink)]",
  egreso_traslado:    "text-[var(--color-danger)]",
  ingreso_traslado:   "text-[var(--color-success)]",
}

interface WorksiteOption {
  id: string
  name: string
}

export interface KardexTableProps {
  movements: InventoryMovementWithRelations[]
  worksites?: WorksiteOption[]
  canExport?: boolean
}

export function KardexTable({ movements, worksites = [], canExport = false }: KardexTableProps) {
  if (movements.length === 0) return null

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
        <div>
          <h2 className="text-h2 text-[var(--color-text)]">Kardex</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Últimos {movements.length} movimientos de inventario
          </p>
        </div>
        <KardexExportButton worksites={worksites} canExport={canExport} />
      </div>

      <div className="hidden md:block overflow-x-auto" tabIndex={0} role="region" aria-label="Kardex de movimientos">
        <table className="w-full text-sm" aria-label="Kardex de movimientos de inventario">
          <caption className="sr-only">Últimos {movements.length} movimientos de inventario registrados en todas las faenas</caption>
          <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
            <tr>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Fecha</th>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Tipo</th>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Producto</th>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Faena</th>
              <th scope="col" className="px-5 py-2.5 text-right th-type w-28">Cantidad</th>
              <th scope="col" className="px-5 py-2.5 text-right th-type w-24">Saldo</th>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Observación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {movements.map((m) => (
              <tr key={m.id} className="hover:bg-[var(--color-surface-2)] transition-colors">
                <td className="px-5 py-3 text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                  {formatDate(m.performedAt)}
                </td>
                <td className="px-5 py-3">
                  <span className="inline-block rounded-[var(--radius)] bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
                    {MOVEMENT_TYPE_LABELS[m.type] ?? m.type}
                  </span>
                </td>
                <td className="px-5 py-3 text-sm font-medium text-[var(--color-text)]">
                  {m.product?.name ?? m.productId}
                </td>
                <td className="px-5 py-3 text-xs text-[var(--color-text-muted)]">
                  {m.worksite?.name ?? m.worksiteId}
                </td>
                <td className={`px-5 py-3 text-right font-mono tabular-nums text-sm font-semibold ${MOVEMENT_QTY_CLASS[m.type] ?? "text-[var(--color-text-muted)]"}`}>
                  {m.quantity > 0 ? "+" : ""}{m.quantity}
                </td>
                <td className="px-5 py-3 text-right font-mono tabular-nums text-sm text-[var(--color-text-muted)]">
                  {m.stockAfter}
                </td>
                <td className="px-5 py-3 text-xs text-[var(--color-text-subtle)] truncate max-w-[240px]">
                  {m.reason ?? m.notes ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 p-5 md:hidden">
        {movements.map((m) => {
          const isPositive = m.quantity > 0
          return (
            <article
              key={m.id}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)]">{m.product?.name ?? m.productId}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{m.worksite?.name ?? m.worksiteId}</p>
                </div>
                <span className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${isPositive ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                  {isPositive ? "+" : ""}{m.quantity}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs">
                <span className="rounded-[var(--radius)] bg-[var(--color-surface-2)] px-2 py-0.5 font-medium text-[var(--color-text-muted)]">
                  {MOVEMENT_TYPE_LABELS[m.type] ?? m.type}
                </span>
                <span className="text-[var(--color-text-subtle)]">{formatDate(m.performedAt)}</span>
              </div>
              {(m.reason ?? m.notes) && (
                <p className="mt-2 text-xs text-[var(--color-text-muted)] line-clamp-2">
                  {m.reason ?? m.notes}
                </p>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
