import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import {
  workers, worksites, deliveries, deliveryItems,
  products, eppProductFamilies, eppTypes,
} from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import { User, HardHat, CheckCircle, Warning, Clock } from "@phosphor-icons/react/dist/ssr"
import { listEppCoverageGaps } from "@/lib/services/prevention-epp"

export const metadata: Metadata = { title: "Trazabilidad EPP del Trabajador" }

export default async function WorkerEppTraceabilityPage({
  params,
}: {
  params: Promise<{ workerId: string }>
}) {
  let session
  try { session = await requirePermission("traceability:view") }
  catch { redirect("/forbidden") }

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
      deliveryId: deliveries.id,
      code: deliveries.code,
      deliveredAt: deliveries.deliveredAt,
      receiverName: deliveries.receiverName,
      hasSig: deliveries.signaturePath,
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
    ))
    .orderBy(desc(deliveries.deliveredAt))

  // 2. Fetch coverage gaps for this worker
  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const allGaps = await listEppCoverageGaps(access)
  const workerGaps = allGaps.filter((g) => g.workerId === workerId)

  return (
    <PageContainer>
      <PageHeader
        title={`Trazabilidad EPP: ${worker.firstName} ${worker.lastName}`}
        description={`Hoja de vida de entregas EPP, tallas registradas y estado de prevención.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Trazabilidad", href: "/trazabilidad" },
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
            {worker.sizeTop && <Badge variant="outline">Superior: {worker.sizeTop}</Badge>}
            {worker.sizeBottom && <Badge variant="outline">Inferior: {worker.sizeBottom}</Badge>}
            {worker.sizeShoe && <Badge variant="outline">Calzado: {worker.sizeShoe}</Badge>}
            {worker.sizeGloves && <Badge variant="outline">Guantes: {worker.sizeGloves}</Badge>}
            {worker.sizeHelmet && <Badge variant="outline">Casco: {worker.sizeHelmet}</Badge>}
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
              <Warning size={18} className="text-[var(--color-warning)]" />
            )}
            <span>Estado de Cobertura EPP</span>
          </div>
          {workerGaps.length === 0 ? (
            <p className="text-xs text-[var(--color-success)] font-medium">Cumple con todos los requisitos EPP vigentes.</p>
          ) : (
            <div className="space-y-1">
              {workerGaps.map((g) => (
                <div key={g.requirementId} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text)]">{g.eppTypeLabel}</span>
                  <Badge variant={g.enforcement === "blocking" ? "danger" : "warning"} size="sm">
                    {g.gapType === "expired" ? "Vencido" : "Faltante"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Historial de Entregas ── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Historial de Entregas EPP</h2>
        {deliveryRows.length === 0 ? (
          <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-subtle)]">
            Sin entregas de EPP registradas para este trabajador.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
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
                {deliveryRows.map((r, i) => (
                  <TableRow key={`${r.deliveryId}-${i}`}>
                    <TableCell className="font-mono text-xs text-[var(--color-text)]">{r.code}</TableCell>
                    <TableCell className="text-xs text-[var(--color-text-subtle)]">{r.deliveredAt ? formatDate(r.deliveredAt) : ""}</TableCell>
                    <TableCell className="text-sm font-medium text-[var(--color-text)]">{r.productName ?? "EPP"}</TableCell>
                    <TableCell className="text-xs font-mono">{r.quantity} {r.unitOfMeasure}</TableCell>
                    <TableCell className="text-xs">
                      {r.hasSig ? (
                        <span className="text-[var(--color-success)] font-medium">Firmado ✓</span>
                      ) : (
                        <span className="text-[var(--color-text-subtle)]">Sin firma</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--color-text-subtle)]">
                      {r.returnQuantity ? `${r.returnProductName ?? "EPP"} (${r.returnQuantity} un)` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </PageContainer>
  )
}
