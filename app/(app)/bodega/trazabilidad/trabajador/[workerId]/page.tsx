import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  workers, deliveries, deliveryItems,
  products,
} from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { MetaBadge } from "@/components/states/state-badge"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate, formatQty } from "@/lib/utils"
import { ArrowSquareOut, User, HardHat, CheckCircle, Warning } from "@phosphor-icons/react/dist/ssr"
import { listEppCoverageGaps } from "@/lib/services/prevention-epp"
import { getProductAttributesByIds } from "@/lib/services/product-sizes"
import { formatVariantProductName } from "@/lib/products/variant-grouping"

export const metadata: Metadata = { title: "Trazabilidad EPP del Trabajador" }

export default async function WorkerEppTraceabilityPage({
  params,
}: {
  params: Promise<{ workerId: string }>
}) {
  let session
  try { session = await requirePermission("warehouse:view_traceability") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/bodega/trazabilidad")}`) }

  const { workerId } = await params

  const worker = await db.query.workers.findFirst({
    where: and(eq(workers.id, workerId), worksiteScopeSql(session, workers.worksiteId)),
    with: { worksite: true },
  })

  if (!worker) {
    notFound()
  }

  // 1. Fetch delivery history for this worker
  const deliveryRows = await db
    .select({
      deliveryItemId: deliveryItems.id,
      deliveryId: deliveries.id,
      code: deliveries.code,
      deliveredAt: deliveries.deliveredAt,
      receiverName: deliveries.receiverName,
      hasSig: deliveries.signaturePath,
      // La anulación es parte de la hoja de vida: la fila se queda, marcada.
      // Mostrarla como una entrega válida acreditaba un EPP que volvió a
      // bodega — y esta pantalla es evidencia de cumplimiento.
      voidedAt: deliveries.voidedAt,
      voidReason: deliveries.voidReason,
      productId: deliveryItems.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: deliveryItems.quantity,
      unitOfMeasure: deliveryItems.unitOfMeasure,
      returnQuantity: deliveryItems.returnQuantity,
      returnProductName: deliveryItems.returnProductNameFree,
    })
    .from(deliveryItems)
    .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
    .leftJoin(products, eq(deliveryItems.productId, products.id))
    .where(and(
      eq(deliveries.destinationType, "worker"),
      eq(deliveries.workerId, workerId),
      // TR-09 (auditoría 2026-09-05): la consulta inicial acotaba el trabajador
      // a la faena de la sesión, pero las entregas se buscaban sólo por
      // `workerId`. Un usuario acotado a su faena podía ver códigos, fechas y
      // cantidades de entregas hechas en una faena ajena por un trabajador que
      // cambió de faena. Se aplica el mismo alcance sobre la faena de entrega
      // para que la hoja de vida no filtre datos de otra faena.
      worksiteScopeSql(session, deliveries.worksiteId),
    ))
    .orderBy(desc(deliveries.deliveredAt))

  // La talla es parte de lo que se le entregó: el catálogo guarda el mismo
  // `products.name` en todas las tallas de una familia, así que sin ella el
  // historial no dice qué talla recibió el trabajador.
  const attributesById = await getProductAttributesByIds(
    deliveryRows.map((row) => row.productId).filter((id): id is string => Boolean(id)),
  )
  const deliveredName = (row: { productId: string | null; productName: string | null }) =>
    formatVariantProductName(row.productName ?? "EPP", row.productId ? attributesById.get(row.productId) : undefined)

  const validDeliveries = deliveryRows.filter((row) => row.voidedAt == null)
  const voidedCount = deliveryRows.length - validDeliveries.length

  // 2. Fetch coverage gaps for this worker
  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canViewEppGaps = can(session, "prevention:epp:view")
  const workerGaps = canViewEppGaps
    ? await listEppCoverageGaps(access, { workerId })
    : []

  return (
    <PageContainer>
      <PageHeader
        title={`Trazabilidad EPP: ${worker.firstName} ${worker.lastName}`}
        description={`Hoja de vida de entregas EPP, tallas registradas y estado de prevención.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Bodega", href: "/bodega" },
            { label: "Trazabilidad", href: "/bodega/trazabilidad" },
            { label: `${worker.firstName} ${worker.lastName}` },
          ]} />
        }
      />

      {/* ── Ficha resumen del trabajador ── */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <User size={18} className="text-[var(--color-primary)]" />
            <span>Datos Personales</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
            <dt className="text-[var(--color-text-subtle)]">RUT</dt>
            <dd className="font-mono text-[var(--color-text)]">{worker.rut}</dd>
            <dt className="text-[var(--color-text-subtle)]">Cargo</dt>
            <dd className="text-[var(--color-text)]">{worker.position ?? "Sin cargo"}</dd>
            <dt className="text-[var(--color-text-subtle)]">Faena</dt>
            <dd className="text-[var(--color-text)]">{worker.worksite?.name ?? "Sin faena"}</dd>
          </dl>
        </div>

        <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <HardHat size={18} className="text-[var(--color-primary)]" />
            <span>Tallas Registradas</span>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {worker.sizeTop && <MetaBadge meta={{ label: `Superior: ${worker.sizeTop}`, variant: "outline" }} />}
            {worker.sizeBottom && <MetaBadge meta={{ label: `Inferior: ${worker.sizeBottom}`, variant: "outline" }} />}
            {worker.sizeShoe && <MetaBadge meta={{ label: `Calzado: ${worker.sizeShoe}`, variant: "outline" }} />}
            {worker.sizeGloves && <MetaBadge meta={{ label: `Guantes: ${worker.sizeGloves}`, variant: "outline" }} />}
            {worker.sizeHelmet && <MetaBadge meta={{ label: `Casco: ${worker.sizeHelmet}`, variant: "outline" }} />}
            {!worker.sizeTop && !worker.sizeBottom && !worker.sizeShoe && !worker.sizeGloves && !worker.sizeHelmet && (
              <span className="text-[var(--color-text-subtle)]">Sin tallas registradas</span>
            )}
          </div>
        </div>

        <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            {workerGaps.length === 0 ? (
              <CheckCircle size={18} className="text-[var(--color-success)]" />
            ) : (
              <Warning size={18} className="text-[var(--color-warning-ink)]" />
            )}
            <span>Estado de Cobertura EPP</span>
          </div>
          {!canViewEppGaps ? (
            <p className="text-xs text-[var(--color-text-subtle)]">
              Requiere permiso de EPP preventivo para ver el estado de cobertura.
            </p>
          ) : workerGaps.length === 0 ? (
            <p className="text-xs text-[var(--color-success)] font-medium">Cumple con todos los requisitos EPP vigentes.</p>
          ) : (
            <div className="space-y-1">
              {workerGaps.map((g) => (
                <div key={g.requirementId} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text)]">{g.eppTypeLabel}</span>
                  <MetaBadge meta={{ label: `${g.gapType === "expired" ? "Vencido" : "Faltante"}`, variant: g.enforcement === "blocking" ? "danger" : "warning" }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Historial de Entregas ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Historial de Entregas EPP</h2>
          {voidedCount > 0 && (
            <p className="text-xs text-[var(--color-text-subtle)]">
              {validDeliveries.length} {validDeliveries.length === 1 ? "entrega vigente" : "entregas vigentes"} ·{" "}
              {voidedCount} {voidedCount === 1 ? "anulada" : "anuladas"} (no acreditan cobertura)
            </p>
          )}
        </div>
        {deliveryRows.length === 0 ? (
          <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-subtle)]">
            Sin entregas de EPP registradas para este trabajador.
          </div>
        ) : (
          <>
          <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] md:block">
            <Table>
              <TableCaption className="sr-only">
                Historial de entregas de EPP al trabajador, con su comprobante, talla y devolución del EPP antiguo.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>EPP Entregado</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Firma</TableHead>
                  <TableHead>Devolución EPP Antiguo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveryRows.map((r) => {
                  const voided = r.voidedAt != null
                  return (
                    <TableRow key={r.deliveryItemId} className={voided ? "opacity-60" : undefined}>
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/entregas/${r.deliveryId}/print`}
                            className="inline-flex items-center gap-1 font-mono text-[var(--color-primary)] hover:underline underline-offset-2"
                          >
                            {r.code}
                            <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
                          </Link>
                          {voided && (
                            <span className="rounded-[var(--radius-full)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
                              Anulada
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-[var(--color-text-subtle)]">{r.deliveredAt ? formatDate(r.deliveredAt) : ""}</TableCell>
                      <TableCell className="text-sm font-medium text-[var(--color-text)]">{deliveredName(r)}</TableCell>
                      <TableCell className={voided ? "text-xs font-mono line-through text-[var(--color-text-subtle)]" : "text-xs font-mono"}>
                        {formatQty(Number(r.quantity), r.unitOfMeasure ?? undefined)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.hasSig ? (
                          <span className="font-medium text-[var(--color-success)]">Archivo de firma adjunto</span>
                        ) : (
                          <span className="text-[var(--color-text-subtle)]">Sin archivo de firma</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-[var(--color-text-subtle)]">
                        {voided
                          ? `Anulada: ${r.voidReason ?? "sin motivo registrado"}`
                          : r.returnQuantity
                            ? `${r.returnProductName ?? "EPP"} (${formatQty(Number(r.returnQuantity), r.unitOfMeasure ?? undefined)})`
                            : "—"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-3 md:hidden">
            {deliveryRows.map((row) => {
              const voided = row.voidedAt != null
              return (
                <article
                  key={row.deliveryItemId}
                  className={`rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${voided ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`/entregas/${row.deliveryId}/print`}
                          className="inline-flex items-center gap-1 font-mono text-xs text-[var(--color-primary)] hover:underline underline-offset-2"
                        >
                          {row.code}
                          <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
                        </Link>
                        {voided && (
                          <span className="rounded-[var(--radius-full)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
                            Anulada
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{row.deliveredAt ? formatDate(row.deliveredAt) : "Sin fecha"}</p>
                    </div>
                    <span className={`text-xs font-medium ${row.hasSig ? "text-[var(--color-success)]" : "text-[var(--color-text-subtle)]"}`}>
                      {row.hasSig ? "Archivo de firma adjunto" : "Sin archivo de firma"}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs">
                    <div>
                      <dt className="text-[var(--color-text-subtle)]">EPP entregado</dt>
                      <dd className={`mt-0.5 font-medium text-[var(--color-text)] ${voided ? "line-through" : ""}`}>
                        {deliveredName(row)} · {formatQty(Number(row.quantity), row.unitOfMeasure ?? undefined)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-subtle)]">
                        {voided ? "Motivo de anulación" : "Devolución de EPP antiguo"}
                      </dt>
                      <dd className="mt-0.5 text-[var(--color-text)]">
                        {voided
                          ? (row.voidReason ?? "Sin motivo registrado")
                          : row.returnQuantity
                            ? `${row.returnProductName ?? "EPP"} (${formatQty(Number(row.returnQuantity), row.unitOfMeasure ?? undefined)})`
                            : "Sin devolución registrada"}
                      </dd>
                    </div>
                  </dl>
                </article>
              )
            })}
          </div>
          </>
        )}
      </section>
    </PageContainer>
  )
}
