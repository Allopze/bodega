import type { Metadata } from "next"
import type { ReactNode } from "react"
import { notFound, redirect } from "next/navigation"
import { and, asc, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { statusHistory, users, workers } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { StateBadge } from "@/components/states/state-badge"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate, formatDateTime, formatQty } from "@/lib/utils"
import { getDispatchGuideDetail, OFFICE_ORIGIN_LABEL } from "@/lib/services/dispatch-guides"
import { GuideActions } from "./guide-actions"

export const metadata: Metadata = { title: "Guía de despacho interna" }

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  egreso_traslado:  "Salida por guía",
  ingreso_traslado: "Ingreso por guía",
}

function DetailLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-subtle)]">{label}</dt>
      <dd className="mt-0.5 text-sm text-[var(--color-text)]">{value}</dd>
    </div>
  )
}

function workerLabel(worker: { firstName: string; lastName: string; rut: string | null } | null | undefined) {
  if (!worker) return null
  const name = `${worker.firstName} ${worker.lastName}`.trim()
  return worker.rut ? `${name} · ${worker.rut}` : name
}

export default async function DispatchGuideDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("warehouse:view_guides") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/bodega/guias")}`) }

  const { id } = await params
  const detail = await getDispatchGuideDetail(id)
  if (!detail) notFound()

  const { guide, movements } = detail
  if (!canAccessWorksite(session, guide.destinationWorksiteId)) notFound()

  const [timelineEvents, destinationWorkers] = await Promise.all([
    db
      .select({
        id:         statusHistory.id,
        fromStatus: statusHistory.fromStatus,
        toStatus:   statusHistory.toStatus,
        changedBy:  statusHistory.changedBy,
        changedAt:  statusHistory.changedAt,
        reason:     statusHistory.reason,
        userName:   users.name,
        userEmail:  users.email,
      })
      .from(statusHistory)
      .leftJoin(users, eq(statusHistory.changedBy, users.id))
      .where(eq(statusHistory.entityId, guide.id))
      .orderBy(desc(statusHistory.changedAt)),
    // Quién puede firmar la recepción: los colaboradores de la faena de destino.
    db
      .select({
        id:        workers.id,
        firstName: workers.firstName,
        lastName:  workers.lastName,
        rut:       workers.rut,
      })
      .from(workers)
      .where(and(eq(workers.isActive, true), eq(workers.worksiteId, guide.destinationWorksiteId)))
      .orderBy(asc(workers.lastName), asc(workers.firstName)),
  ])

  const receiverOptions = destinationWorkers.map((worker) => ({
    value: worker.id,
    label: `${worker.firstName} ${worker.lastName}`.trim(),
    hint: worker.rut ?? undefined,
  }))
  // El responsable indicado en la guía puede estar registrado en otra faena
  // (la gente rota). Sin agregarlo, el selector de la recepción aparecería en
  // blanco con un valor ya elegido.
  if (guide.receiverWorker && !receiverOptions.some((option) => option.value === guide.receiverWorker!.id)) {
    receiverOptions.unshift({
      value: guide.receiverWorker.id,
      label: workerLabel(guide.receiverWorker) ?? guide.receiverWorker.firstName,
      hint: undefined,
    })
  }

  const dispatcherName = workerLabel(guide.dispatcherWorker)
    ?? guide.issuedByUser?.name
    ?? guide.issuedByUser?.email
    ?? "—"
  const totalQuantity = guide.items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`Guía ${guide.code}`}
        description={`Traslado interno ${OFFICE_ORIGIN_LABEL} → ${guide.destinationWorksite?.name ?? "faena"}. No constituye documento tributario.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Bodega", href: "/bodega" },
            { label: "Guías de despacho", href: "/bodega/guias" },
            { label: guide.code },
          ]} />
        }
        actions={
          <GuideActions
            guideId={guide.id}
            code={guide.code}
            status={guide.status}
            destinationWorksiteName={guide.destinationWorksite?.name ?? "la faena"}
            itemCount={guide.items.length}
            defaultReceiverWorkerId={guide.receiverWorkerId ?? ""}
            receiverOptions={receiverOptions}
            permissions={{
              edit:     can(session, "warehouse:create_guide"),
              dispatch: can(session, "warehouse:dispatch_guide"),
              receive:  can(session, "warehouse:receive_guide"),
              cancel:   can(session, "warehouse:cancel_guide"),
            }}
          />
        }
      />

      <div className="flex flex-col gap-4">
        {guide.status === "cancelled" && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--color-danger-ink)]">Guía anulada</p>
            <p className="mt-0.5 text-sm text-[var(--color-danger-ink)]">
              {guide.cancellationReason} · {formatDateTime(guide.cancelledAt ?? "")} ·{" "}
              {guide.cancelledByUser?.name ?? guide.cancelledByUser?.email ?? "—"}
            </p>
          </div>
        )}

        <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-h2">Datos del traslado</h2>
            <StateBadge state={guide.status} entity="dispatch_guide" />
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailLine
              label="Origen"
              value={
                <>
                  {OFFICE_ORIGIN_LABEL}
                  <span className="block text-xs text-[var(--color-text-muted)]">
                    Bodega {guide.originWorksite?.name}
                  </span>
                </>
              }
            />
            <DetailLine label="Destino" value={guide.destinationWorksite?.name ?? "—"} />
            <DetailLine label="Fecha de emisión" value={formatDateTime(guide.issuedAt)} />
            <DetailLine
              label="Emitida por"
              value={guide.issuedByUser?.name ?? guide.issuedByUser?.email ?? "—"}
            />
            <DetailLine label="Responsable del despacho" value={dispatcherName} />
            <DetailLine label="Responsable de recepción" value={workerLabel(guide.receiverWorker) ?? "—"} />
            {guide.vehicle && (
              <DetailLine
                label="Vehículo"
                value={
                  <>
                    <span className="font-mono">{guide.vehicle.plate}</span>
                    {guide.vehicle.code ? ` · ${guide.vehicle.code}` : ""}
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {[guide.vehicle.brand, guide.vehicle.model].filter(Boolean).join(" ") || "Sin marca registrada"}
                    </span>
                  </>
                }
              />
            )}
            {guide.driverWorker && (
              <DetailLine label="Conductor" value={workerLabel(guide.driverWorker)} />
            )}
            {guide.dispatchedAt && (
              <DetailLine
                label="Despachada"
                value={
                  <>
                    {formatDateTime(guide.dispatchedAt)}
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {guide.dispatchedByUser?.name ?? guide.dispatchedByUser?.email ?? "—"}
                    </span>
                  </>
                }
              />
            )}
            {guide.receivedAt && (
              <DetailLine
                label="Recibida en faena"
                value={
                  <>
                    {formatDateTime(guide.receivedAt)}
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      Confirmó {guide.receivedByUser?.name ?? guide.receivedByUser?.email ?? "—"}
                      {workerLabel(guide.receivedByWorker) ? ` · recibió ${workerLabel(guide.receivedByWorker)}` : ""}
                    </span>
                  </>
                }
              />
            )}
          </dl>
          {guide.notes && (
            <div className="mt-4 border-t border-[var(--color-border)] pt-3">
              <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-subtle)]">Observaciones</p>
              <p className="mt-1 whitespace-pre-line text-sm text-[var(--color-text-muted)]">{guide.notes}</p>
            </div>
          )}
        </section>

        <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] md:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-h2">Elementos</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {guide.items.length} {guide.items.length === 1 ? "línea" : "líneas"} · {formatQty(totalQuantity)} en total
            </p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Código</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-28 text-right">Cantidad</TableHead>
                  <TableHead className="w-28">Unidad</TableHead>
                  <TableHead>Observación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {guide.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.product?.sku ?? "—"}</TableCell>
                    <TableCell className="text-sm">{item.product?.name ?? "Producto"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatQty(item.quantity)}</TableCell>
                    <TableCell className="text-sm text-[var(--color-text-muted)]">{item.unitOfMeasure}</TableCell>
                    <TableCell className="text-xs text-[var(--color-text-muted)]">{item.notes ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] md:p-5">
          <h2 className="text-h2">Movimientos de bodega</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Kardex generado por esta guía. Cada despacho descuenta en la oficina y abona en la faena; una anulación
            agrega los movimientos de reversa sin borrar los originales.
          </p>
          {movements.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">
              Todavía no hay movimientos: un borrador no mueve stock.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Fecha</TableHead>
                    <TableHead>Bodega</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="w-32">Tipo</TableHead>
                    <TableHead className="w-24 text-right">Cantidad</TableHead>
                    <TableHead className="w-32 text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="text-xs text-[var(--color-text-subtle)]">
                        {formatDateTime(movement.performedAt)}
                      </TableCell>
                      <TableCell className="text-sm">{movement.worksiteName}</TableCell>
                      <TableCell className="text-sm">
                        {movement.productName}
                        <span className="block font-mono text-[11px] text-[var(--color-text-subtle)]">
                          {movement.productSku}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {MOVEMENT_TYPE_LABELS[movement.type] ?? movement.type}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-sm ${
                          movement.quantity < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"
                        }`}
                      >
                        {movement.quantity > 0 ? "+" : ""}{formatQty(movement.quantity)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-[var(--color-text-muted)]">
                        {formatQty(movement.stockBefore)} → {formatQty(movement.stockAfter)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <EntityTimeline
          entityType="dispatch_guide"
          events={timelineEvents}
          description={`Transiciones de la guía ${guide.code} · emitida el ${formatDate(guide.issuedAt)}`}
        />
      </div>
    </PageContainer>
  )
}
