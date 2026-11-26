import Link from "next/link"
import type { InventoryMovementWithRelations } from "./types"
import { formatDate } from "@/lib/utils"
import { EmptyState } from "@/components/ui/empty-state"
import { ArrowSquareOut, ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr"
import { KardexExportButton } from "./kardex-export-button"
import { movementToneClass } from "./movement-labels"
import { kardexTypeLabel } from "@/lib/bodega/kardex-labels"
import { movementDocumentHref, movementFolio, referenceTypeLabel } from "./movement-href"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

interface WorksiteOption {
  id: string
  name: string
}

export interface KardexTableProps {
  movements: InventoryMovementWithRelations[]
  worksites?: WorksiteOption[]
  canExport?: boolean
  /** Los folios del registro de mantención y de la OT son enlace sólo con permiso para abrir esas pantallas;
   *  sin él se leen igual, como texto. */
  canOpenMaintenanceRecord?: boolean
  canOpenWorkOrder?: boolean
  /** Sólo para redactar el vacío: distingue "no hay movimientos" de "tu
   *  búsqueda no encontró ninguno". */
  searchQuery?: string
}

/** Fecha con hora: dos movimientos del mismo día eran indistinguibles y su
 *  orden en la tabla no se podía justificar mirándola. */
function formatMoment(iso: string): { date: string; time: string } {
  const parsed = new Date(iso)
  const time = Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })
  return { date: formatDate(iso), time }
}

/** El uso de un repuesto en una OT y su reverso apuntan al registro de mantención (ADR mantención 0001). */
const MAINTENANCE_REFERENCES = new Set(["mant_record", "mant_record_void"])

function DocumentLink({
  movement, canOpenMaintenanceRecord, canOpenWorkOrder,
}: {
  movement: InventoryMovementWithRelations
  canOpenMaintenanceRecord: boolean
  canOpenWorkOrder: boolean
}) {
  const isMaintenance = MAINTENANCE_REFERENCES.has(movement.referenceType ?? "")
  const href = isMaintenance && !canOpenMaintenanceRecord
    ? null
    : movementDocumentHref(movement.referenceType, movement.referenceId)
  const label = referenceTypeLabel(movement.referenceType)
  const folio = movementFolio(movement)
  if (!label) return <span className="text-[var(--color-text-faint)]">—</span>
  const content = (
    <>
      <span>{label}</span>
      {folio && <span className="block font-mono text-2xs font-semibold text-[var(--color-text)]">{folio}</span>}
    </>
  )
  const doc = !href ? (
    <span className="text-[var(--color-text-subtle)]">{content}</span>
  ) : (
    <Link
      href={href}
      className="group/doc inline-flex items-start gap-1 text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline"
    >
      <span>{content}</span>
      <ArrowSquareOut size={11} aria-hidden className="mt-0.5 shrink-0" />
    </Link>
  )
  if (!isMaintenance || !movement.workOrderFolio) return doc

  // La OT va en su propia línea y con su propio enlace: un enlace dentro de otro no es HTML válido.
  const workOrder = (
    <>
      OT <span className="font-mono text-2xs font-semibold text-[var(--color-text)]">{movement.workOrderFolio}</span>
    </>
  )
  return (
    <span className="flex flex-col items-start gap-1">
      {doc}
      {canOpenWorkOrder && movement.workOrderId ? (
        <Link
          href={`/mantencion/ot/${encodeURIComponent(movement.workOrderId)}`}
          className="inline-flex items-center gap-1 text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline"
        >
          <span>{workOrder}</span>
          <ArrowSquareOut size={11} aria-hidden className="shrink-0" />
        </Link>
      ) : (
        <span className="text-[var(--color-text-subtle)]">{workOrder}</span>
      )}
    </span>
  )
}

export function KardexTable({
  movements, worksites = [], canExport = false, canOpenMaintenanceRecord = false, canOpenWorkOrder = false, searchQuery = "",
}: KardexTableProps) {
  // Con cero filas la sección se queda igual, con su encabezado y su vacío. El
  // `return null` de antes hacía desaparecer el kardex entero al buscar algo
  // que sólo existía en el stock, sin decir por qué.
  const term = searchQuery.trim()

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
        <div>
          <h2 className="text-h2 text-[var(--color-text)]">Movimientos</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {movements.length === 0
              ? "Sin movimientos que mostrar"
              : `${movements.length} movimientos de inventario en esta página`}
          </p>
        </div>
        <KardexExportButton worksites={worksites} canExport={canExport} />
      </div>

      {movements.length === 0 ? (
        <EmptyState
          compact
          icon={<ClockCounterClockwise size={24} />}
          title={term ? "Sin coincidencias en los movimientos" : "Sin movimientos registrados"}
          description={term
            ? `Ningún movimiento coincide con "${term}".`
            : "Los ingresos, entregas y ajustes aparecerán aquí a medida que ocurran."}
        />
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto" tabIndex={0} role="region" aria-label="Movimientos de inventario">
            <TableRoot framed={false}>
            <Table className="text-sm" aria-label="Movimientos de inventario">
              <caption className="sr-only">Movimientos de inventario registrados, del más reciente al más antiguo</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead><TableHead>Tipo</TableHead><TableHead>Producto</TableHead><TableHead>Faena</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Responsable</TableHead><TableHead>Documento</TableHead><TableHead>Observación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => {
                  const moment = formatMoment(m.performedAt)
                  const observation = m.reason ?? m.notes ?? ""
                  return (
                    <TableRow key={m.id} className="hover:bg-[var(--color-surface-2)] transition-colors">
                      <TableCell className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                        <span className="tabular-nums">{moment.date}</span>
                        {moment.time && (
                          <span className="mt-0.5 block text-2xs tabular-nums text-[var(--color-text-faint)]">{moment.time}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="inline-block rounded-[var(--radius)] bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
                          {kardexTypeLabel(m.type, m.referenceType)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm font-medium text-[var(--color-text)]">
                        {m.product?.name ?? m.productId}
                      </TableCell>
                      <TableCell className="text-xs text-[var(--color-text-muted)]">
                        {m.worksite?.name ?? m.worksiteId}
                      </TableCell>
                      <TableCell className={`text-right font-mono tabular-nums text-sm font-semibold ${movementToneClass(m.type)}`}>
                        {m.quantity > 0 ? "+" : ""}{m.quantity}
                      </TableCell>
                      {/* Antes y después: con sólo el saldo posterior no se puede
                          reconstruir un descuadre leyendo la fila. */}
                      <TableCell className="text-right font-mono tabular-nums text-xs text-[var(--color-text-muted)]">
                        {m.stockBefore !== undefined && (
                          <span className="text-[var(--color-text-faint)]">{m.stockBefore} → </span>
                        )}
                        <span className="text-sm text-[var(--color-text)]">{m.stockAfter}</span>
                      </TableCell>
                      <TableCell className="text-xs text-[var(--color-text-muted)]">
                        {m.performedByName ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <DocumentLink movement={m} canOpenMaintenanceRecord={canOpenMaintenanceRecord} canOpenWorkOrder={canOpenWorkOrder} />
                      </TableCell>
                      <TableCell
                        title={observation || undefined}
                        className="px-5 py-3 text-xs text-[var(--color-text-subtle)] max-w-[260px]"
                      >
                        {/* Dos líneas y el resto en el tooltip: truncar a una
                            sola dejaba cortado justo el texto que explica el
                            movimiento. */}
                        <span className="line-clamp-2 break-words">{observation || "—"}</span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            </TableRoot>
          </div>

          <div className="divide-y divide-[var(--color-border)] md:hidden">
            {movements.map((m) => {
              const moment = formatMoment(m.performedAt)
              return (
                <article
                  key={m.id}
                  className="px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)]">{m.product?.name ?? m.productId}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{m.worksite?.name ?? m.worksiteId}</p>
                    </div>
                    {/* Mismo mapa de tonos que la tabla: antes el color móvil lo
                        decidía el signo y el de escritorio el tipo. */}
                    <span className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${movementToneClass(m.type)}`}>
                      {m.quantity > 0 ? "+" : ""}{m.quantity}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                    <span className="rounded-[var(--radius)] bg-[var(--color-surface-2)] px-2 py-0.5 font-medium text-[var(--color-text-muted)]">
                      {kardexTypeLabel(m.type, m.referenceType)}
                    </span>
                    <span className="text-[var(--color-text-subtle)]">
                      {moment.date}{moment.time ? ` · ${moment.time}` : ""}
                    </span>
                    <span className="text-[var(--color-text-subtle)]">Saldo {m.stockAfter}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-muted)]">
                    {m.performedByName && <span>{m.performedByName}</span>}
                    <DocumentLink movement={m} canOpenMaintenanceRecord={canOpenMaintenanceRecord} canOpenWorkOrder={canOpenWorkOrder} />
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
        </>
      )}
    </section>
  )
}
