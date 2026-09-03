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
  if (approvals.length === 0) return null
  return (
    <SectionTable title="Decisiones de aprobación">
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
                  {a.modifiedQty != null ? `${a.modifiedQty} ${item.unitOfMeasure}` : "—"}
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
  if (ocItems.length === 0) return null
  return (
    <SectionTable title="Órdenes de compra">
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
              <TableRow key={oi.id}>
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
                <TableCell><StateBadge state={oi.ocStatus} entity="oc" size="sm" /></TableCell>
                <TableCellNum className="text-xs">{formatQty(oi.quantity, item.unitOfMeasure)}</TableCellNum>
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
  if (receipts.length === 0) return null
  return (
    <SectionTable title="Recepciones">
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
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
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
  if (deliveries.length === 0) return null
  return (
    <SectionTable title="Entregas">
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
            {deliveries.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-xs">{d.code}</TableCell>
                <TableCell className="text-xs">
                  {d.destinationType === "worker"
                    ? <span>{d.workerName ?? "Trabajador"}</span>
                    : <span>{d.worksiteName ?? "Faena"}</span>}
                </TableCell>
                <TableCell className="text-xs">{d.deliveredByName}</TableCell>
                <TableCell className="text-xs">{formatDate(d.deliveredAt)}</TableCell>
                <TableCellNum className="text-xs">{formatQty(d.quantity, item.unitOfMeasure)}</TableCellNum>
                <TableCell className="text-xs">
                  {d.returnQuantity != null && d.returnQuantity > 0 ? (
                    <span className="text-[var(--color-warning-ink)]">
                      {formatQty(d.returnQuantity, item.unitOfMeasure)}
                      {d.returnReason && <span className="text-[var(--color-text-subtle)] ml-1">({d.returnReason})</span>}
                    </span>
                  ) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </SectionTable>
  )
}

export function InventoryMovementsTable({ movements, item }: { movements: TablesProps["inventoryMovements"]; item: TablesProps["item"] }) {
  if (movements.length === 0) return null
  return (
    <SectionTable title="Movimientos de inventario" subtitle="Ajustes, devoluciones y desechos registrados para este producto en la faena.">
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

function SectionTable({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)]">
      <div className="border-b border-[var(--color-border)] px-5 py-3">
        <h2 className="text-h2 text-[var(--color-text)]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{subtitle}</p>}
      </div>
      {children}
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
