import Link from "next/link"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell, TableCellNum,
} from "@/components/ui/table"
import { StateBadge } from "@/components/states/state-badge"
import { formatQty, formatDate } from "@/lib/utils"
import type { ReactNode } from "react"
import type { ItemDetailData } from "@/lib/services/trazabilidad-item"

interface TablesProps {
  item: ItemDetailData["item"]
  approvals: ItemDetailData["approvals"]
  ocItems: ItemDetailData["ocItems"]
  receipts: ItemDetailData["receipts"]
  deliveries: ItemDetailData["deliveries"]
  inventoryMovements: ItemDetailData["inventoryMovements"]
}

export function ApprovalsTable({ approvals, item }: { approvals: TablesProps["approvals"]; item: TablesProps["item"] }) {
  return (
    <SectionTable
      title="Decisiones de aprobación"
      empty={approvals.length === 0 ? "Nadie ha aprobado ni rechazado este ítem todavía." : undefined}
    >
      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Decidido por</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead>Motivo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {approvals.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-xs">{formatDate(a.decidedAt)}</TableCell>
                <TableCell>
                  <ApprovalTypeBadge type={a.type} />
                </TableCell>
                <TableCell className="text-xs">{a.decidedByName}</TableCell>
                <TableCellNum className="text-xs">
                  {a.modifiedQty != null ? formatQty(a.modifiedQty, item.unitOfMeasure) : "—"}
                </TableCellNum>
                <TableCell className="text-xs max-w-[200px] truncate text-[var(--color-text-muted)]">
                  {a.reason ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </SectionTable>
  )
}

export function OcItemsTable({ ocItems, item }: { ocItems: TablesProps["ocItems"]; item: TablesProps["item"] }) {
  return (
    <SectionTable
      title="Órdenes de compra"
      empty={ocItems.length === 0 ? "Este ítem no se ha llevado a ninguna orden de compra." : undefined}
    >
      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Recibido oficina</TableHead>
              <TableHead className="text-right">Recibido faena</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ocItems.map((oi) => (
              <TableRow key={oi.id} className={oi.cancelled ? "opacity-60" : undefined}>
                <TableCell>
                  <Link
                    href={`/compras/${oi.ocId}`}
                    className="inline-flex items-center gap-1 text-sm text-[var(--color-primary)] hover:underline underline-offset-2"
                  >
                    {oi.ocCode}
                    <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
                  </Link>
                </TableCell>
                <TableCell className="text-xs">{oi.supplierName}</TableCell>
                <TableCell>
                  {oi.cancelled
                    ? <VoidedBadge label="Anulada" />
                    : <StateBadge state={oi.ocStatus} entity="oc" size="sm" />}
                </TableCell>
                {/* Una línea anulada no pidió nada: su cantidad va tachada para
                    que la suma que el usuario haga a ojo coincida con el
                    "En OC" del resumen. */}
                <TableCellNum className={oi.cancelled ? "text-xs line-through text-[var(--color-text-subtle)]" : "text-xs"}>
                  {formatQty(oi.quantity, item.unitOfMeasure)}
                </TableCellNum>
                <TableCellNum className="text-xs">{formatQty(oi.receivedAtOffice, item.unitOfMeasure)}</TableCellNum>
                <TableCellNum className="text-xs">{formatQty(oi.receivedAtFaena, item.unitOfMeasure)}</TableCellNum>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </SectionTable>
  )
}

export function ReceiptsTable({ receipts, item }: { receipts: TablesProps["receipts"]; item: TablesProps["item"] }) {
  return (
    <SectionTable
      title="Recepciones"
      empty={receipts.length === 0 ? "Todavía no se ha recepcionado nada de este ítem." : undefined}
    >
      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead>Recibido por</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Recibido</TableHead>
              <TableHead className="text-right">Rechazado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/recepcion/${r.receiptId}`}
                    className="inline-flex items-center gap-1 font-mono text-xs text-[var(--color-primary)] hover:underline underline-offset-2"
                  >
                    {r.code}
                    <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
                  </Link>
                </TableCell>
                <TableCell>
                  <LocationBadge locationType={r.locationType} />
                </TableCell>
                <TableCell className="text-xs">{r.receivedByName}</TableCell>
                <TableCell className="text-xs">{formatDate(r.receivedAt)}</TableCell>
                <TableCellNum className="text-xs">{formatQty(r.quantityReceived, item.unitOfMeasure)}</TableCellNum>
                <TableCellNum className="text-xs">
                  {r.quantityRejected > 0
                    ? <span className="text-[var(--color-signal-ink)]">{formatQty(r.quantityRejected, item.unitOfMeasure)}</span>
                    : "—"}
                </TableCellNum>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </SectionTable>
  )
}

export function DeliveriesTable({ deliveries, item }: { deliveries: TablesProps["deliveries"]; item: TablesProps["item"] }) {
  return (
    <SectionTable
      title="Entregas"
      empty={deliveries.length === 0 ? "Este ítem no se ha entregado a nadie todavía." : undefined}
    >
      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Destino</TableHead>
              <TableHead>Entregado por</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead>Devolución</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((d) => {
              const voided = d.voidedAt != null
              return (
                <TableRow key={d.id} className={voided ? "opacity-60" : undefined}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/entregas/${d.deliveryId}/print`}
                        className="inline-flex items-center gap-1 font-mono text-xs text-[var(--color-primary)] hover:underline underline-offset-2"
                      >
                        {d.code}
                        <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
                      </Link>
                      {voided && <VoidedBadge label="Anulada" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {d.destinationType === "worker"
                      ? <span>{d.workerName ?? "Trabajador"}</span>
                      : <span>{d.worksiteName ?? "Faena"}</span>}
                  </TableCell>
                  <TableCell className="text-xs">{d.deliveredByName}</TableCell>
                  <TableCell className="text-xs">{formatDate(d.deliveredAt)}</TableCell>
                  {/* Tachada porque no cuenta como entregada: el resumen de
                      arriba la descarta y las dos cifras tienen que cuadrar. */}
                  <TableCellNum className={voided ? "text-xs line-through text-[var(--color-text-subtle)]" : "text-xs"}>
                    {formatQty(d.quantity, item.unitOfMeasure)}
                  </TableCellNum>
                  <TableCell className="text-xs">
                    {voided ? (
                      <span className="text-[var(--color-text-subtle)]">
                        Anulada: {d.voidReason ?? "sin motivo registrado"}
                      </span>
                    ) : d.returnQuantity != null && d.returnQuantity > 0 ? (
                      <span className="text-[var(--color-warning-ink)]">
                        {formatQty(d.returnQuantity, item.unitOfMeasure)}
                        {d.returnReason && <span className="text-[var(--color-text-subtle)] ml-1">({d.returnReason})</span>}
                      </span>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableRoot>
    </SectionTable>
  )
}

export function InventoryMovementsTable({ movements, item }: { movements: TablesProps["inventoryMovements"]; item: TablesProps["item"] }) {
  if (movements.length === 0) return null
  return (
    <SectionTable
      title="Movimientos de inventario del producto en la faena"
      subtitle="Contexto de bodega, no movimientos de este ítem: son los últimos 50 ajustes, devoluciones y desechos del producto en esta faena, sin importar de qué solicitud vinieron."
    >
      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead>Referencia</TableHead>
              <TableHead>Realizado por</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Stock final</TableHead>
              <TableHead>Notas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <MovementTypeBadge type={m.type} />
                </TableCell>
                <TableCellNum className={m.quantity < 0 ? "text-[var(--color-danger-ink)] text-xs" : "text-xs"}>
                  {m.quantity > 0 ? "+" : ""}{formatQty(m.quantity, item.unitOfMeasure)}
                </TableCellNum>
                <TableCell className="text-xs">
                  {m.referenceType && m.referenceId
                    ? `${m.referenceType.replace(/_/g, " ")} ${m.referenceId}`
                    : m.reason
                      ? m.reason
                      : "—"}
                </TableCell>
                <TableCell className="text-xs">{m.performedByName ?? "—"}</TableCell>
                <TableCell className="text-xs">{formatDate(m.performedAt)}</TableCell>
                <TableCellNum className="text-xs">{m.stockAfter != null ? formatQty(m.stockAfter, item.unitOfMeasure) : "—"}</TableCellNum>
                <TableCell className="text-xs text-[var(--color-text-muted)] max-w-48 truncate">{m.notes ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </SectionTable>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────────

/**
 * Una etapa vacía se dice, no se esconde.
 *
 * Las tablas devolvían `null` cuando no tenían filas, así que un expediente
 * sin recepciones se veía igual que uno donde nadie había mirado: en un
 * dossier de trazabilidad la ausencia de evidencia es información.
 */
function SectionTable({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string
  subtitle?: string
  empty?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)]">
      <div className="border-b border-[var(--color-border)] px-5 py-3">
        <h2 className="text-h2 text-[var(--color-text)]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{subtitle}</p>}
      </div>
      {empty
        ? <p className="px-5 py-4 text-sm text-[var(--color-text-subtle)]">{empty}</p>
        : children}
    </section>
  )
}

function ApprovalTypeBadge({ type }: { type: string }) {
  return (
    <span className={[
      "inline-flex items-center rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium",
      type === "approve" ? "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]" :
      type === "reject" ? "bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]" :
      type === "modify" ? "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]" :
      "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
    ].join(" ")}>
      {type === "approve" ? "Aprobado" :
       type === "reject" ? "Rechazado" :
       type === "modify" ? "Modificado" : "Devuelto"}
    </span>
  )
}

function VoidedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-[var(--radius-full)] bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
      {label}
    </span>
  )
}

function LocationBadge({ locationType }: { locationType: string }) {
  return (
    <span className={[
      "inline-flex items-center rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium",
      locationType === "faena"
        ? "bg-[var(--color-primary-tint)] text-[var(--color-primary)]"
        : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
    ].join(" ")}>
      {locationType === "faena" ? "Faena" : "Oficina"}
    </span>
  )
}

function MovementTypeBadge({ type }: { type: string }) {
  return (
    <span className={[
      "inline-flex items-center rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium",
      type === "ajuste"
        ? "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]"
        : type === "devolucion"
        ? "bg-[var(--color-primary-tint)] text-[var(--color-primary)]"
        : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
    ].join(" ")}>
      {type}
    </span>
  )
}
