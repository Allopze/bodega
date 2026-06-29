import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { requirePermission } from "@/lib/auth/can"
import { getItemDetail } from "@/lib/services/trazabilidad-item"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StateBadge } from "@/components/states/state-badge"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { formatQty, formatDate } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell, TableCellNum,
} from "@/components/ui/table"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Detalle de ítem — Trazabilidad" }



function quantitySummary(received: number, requested: number, uom: string) {
  if (received >= requested) return <span className="text-[var(--color-success)] font-semibold">Completo</span>
  if (received > 0) return <span className="text-[var(--color-warning)] font-semibold">Parcial ({formatQty(received, uom)} de {formatQty(requested, uom)})</span>
  return <span className="text-[var(--color-text-subtle)]">Sin recibir</span>
}

export default async function TrazabilidadItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>
}) {
  let session
  try { session = await requirePermission("traceability:view") }
  catch { redirect("/forbidden") }

  const { itemId } = await params
  const detail = await getItemDetail(session, itemId)
  if (!detail) notFound()

  const { item, approvals, ocItems, receipts, deliveries, timeline, inventoryMovements } = detail
  const totalReceivedAtFaena = ocItems.reduce((sum, oi) => sum + oi.receivedAtFaena, 0)
  const totalOrdered = ocItems.reduce((sum, oi) => sum + oi.quantity, 0)
  const totalDelivered = deliveries.reduce((sum, d) => sum + d.quantity, 0)
  const totalReturned = deliveries.reduce((sum, d) => sum + (d.returnQuantity ?? 0), 0)

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={item.productName}
        description={
          item.productSku
            ? `SKU ${item.productSku} · ${item.worksiteName}`
            : item.worksiteName
        }
        actions={
          <div className="flex items-center gap-2">
            <StateBadge state={item.status} entity="item" />
            <Link href={`/solicitudes/${item.requestId}`}>
              <Button variant="secondary" size="sm">
                <ArrowSquareOut size={14} className="mr-1" />
                Ver solicitud
              </Button>
            </Link>
          </div>
        }
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Trazabilidad", href: "/trazabilidad" },
            { label: item.productName },
          ]} />
        }
      />

      <div className="space-y-6">
        {/* ── Item summary card ──────────────────────────────────── */}
        <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-6">
          <h2 className="text-h2 text-[var(--color-text)] mb-4">Resumen del ítem</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <div>
              <dt className="text-[var(--color-text-subtle)] text-xs">Solicitado por</dt>
              <dd className="text-[var(--color-text)] mt-0.5">{item.requesterName}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)] text-xs">Faena</dt>
              <dd className="text-[var(--color-text)] mt-0.5">{item.worksiteName}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)] text-xs">Estado</dt>
              <dd className="mt-0.5"><StateBadge state={item.status} entity="item" size="sm" /></dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)] text-xs">Cantidad solicitada</dt>
              <dd className="font-mono tabular-nums text-[var(--color-text)] mt-0.5">{formatQty(item.quantity, item.unitOfMeasure)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)] text-xs">En OC</dt>
              <dd className="font-mono tabular-nums text-[var(--color-text)] mt-0.5">{formatQty(totalOrdered, item.unitOfMeasure)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)] text-xs">Recibido en faena</dt>
              <dd className="mt-0.5">{quantitySummary(totalReceivedAtFaena, item.quantity, item.unitOfMeasure)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)] text-xs">Entregado a trabajadores</dt>
              <dd className="font-mono tabular-nums text-[var(--color-text)] mt-0.5">
                {formatQty(totalDelivered, item.unitOfMeasure)}
                {totalReturned > 0 && (
                  <span className="ml-1 text-xs text-[var(--color-text-subtle)]">
                    (devueltos {formatQty(totalReturned, item.unitOfMeasure)})
                  </span>
                )}
              </dd>
            </div>
            {item.urgency && (
              <div>
                <dt className="text-[var(--color-text-subtle)] text-xs">Urgencia</dt>
                <dd className="text-[var(--color-text)] mt-0.5 capitalize">{item.urgency}</dd>
              </div>
            )}
            {item.requiredDate && (
              <div>
                <dt className="text-[var(--color-text-subtle)] text-xs">Fecha requerida</dt>
                <dd className="text-[var(--color-text)] mt-0.5">{formatDate(item.requiredDate)}</dd>
              </div>
            )}
          </dl>
          {item.attributes.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
              <p className="text-xs text-[var(--color-text-subtle)] mb-2">Atributos</p>
              <div className="flex flex-wrap gap-2">
                {item.attributes.map((attr) => (
                  <span
                    key={attr.name}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-xs"
                  >
                    <span className="text-[var(--color-text-subtle)]">{attr.name}:</span>
                    <span className="font-medium text-[var(--color-text)]">{attr.value}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {item.notes && (
            <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
              <p className="text-xs text-[var(--color-text-subtle)] mb-1">Notas</p>
              <p className="text-sm text-[var(--color-text)]">{item.notes}</p>
            </div>
          )}
        </section>

        {/* ── Quantity flow visualization ───────────────────────── */}
        <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-6">
          <h2 className="text-h2 text-[var(--color-text)] mb-4">Flujo de cantidades</h2>
          <div className="flex items-center gap-3 text-sm">
            {[
              { label: "Solicitado", value: item.quantity },
              { label: "En OC", value: totalOrdered },
              { label: "Recibido", value: totalReceivedAtFaena },
              { label: "Entregado", value: totalDelivered },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center gap-3">
                {i > 0 && <span className="text-[var(--color-border-strong)]" aria-hidden>→</span>}
                <div className="text-center">
                  <p className="font-mono text-lg font-semibold tabular-nums text-[var(--color-text)]">
                    {formatQty(step.value, item.unitOfMeasure)}
                  </p>
                  <p className="text-xs text-[var(--color-text-subtle)]">{step.label}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Approval decisions ────────────────────────────────── */}
        {approvals.length > 0 && (
          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] px-5 py-3">
              <h2 className="text-h2 text-[var(--color-text)]">Decisiones de aprobación</h2>
            </div>
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
                        <span className={[
                          "inline-flex items-center rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium",
                          a.type === "approve" ? "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]" :
                          a.type === "reject" ? "bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]" :
                          a.type === "modify" ? "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]" :
                          "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
                        ].join(" ")}>
                          {a.type === "approve" ? "Aprobado" :
                           a.type === "reject" ? "Rechazado" :
                           a.type === "modify" ? "Modificado" : "Devuelto"}
                        </span>
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
          </section>
        )}

        {/* ── Purchase orders ───────────────────────────────────── */}
        {ocItems.length > 0 && (
          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] px-5 py-3">
              <h2 className="text-h2 text-[var(--color-text)]">Órdenes de compra</h2>
            </div>
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
          </section>
        )}

        {/* ── Receipts ──────────────────────────────────────────── */}
        {receipts.length > 0 && (
          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] px-5 py-3">
              <h2 className="text-h2 text-[var(--color-text)]">Recepciones</h2>
            </div>
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
                        <span className={[
                          "inline-flex items-center rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium",
                          r.locationType === "faena"
                            ? "bg-[var(--color-primary-tint)] text-[var(--color-primary)]"
                            : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
                        ].join(" ")}>
                          {r.locationType === "faena" ? "Faena" : "Oficina"}
                        </span>
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
          </section>
        )}

        {/* ── Deliveries ────────────────────────────────────────── */}
        {deliveries.length > 0 && (
          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] px-5 py-3">
              <h2 className="text-h2 text-[var(--color-text)]">Entregas</h2>
            </div>
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
          </section>
        )}

        {/* ── Inventory Movements (ajustes, devoluciones, desechos) ── */}
        {inventoryMovements.length > 0 && (
          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] px-5 py-3">
              <h2 className="text-h2 text-[var(--color-text)]">Movimientos de inventario</h2>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Ajustes, devoluciones y desechos registrados para este producto en la faena.</p>
            </div>
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
                  {inventoryMovements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <span className={[
                          "inline-flex items-center rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium",
                          m.type === "ajuste"
                            ? "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]"
                            : m.type === "devolucion"
                            ? "bg-[var(--color-primary-tint)] text-[var(--color-primary)]"
                            : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
                        ].join(" ")}>
                          {m.type}
                        </span>
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
          </section>
        )}

        {/* ── Status history timeline ───────────────────────────── */}
        <EntityTimeline entityType="item" events={timeline} />
      </div>
    </PageContainer>
  )
}
