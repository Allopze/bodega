import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { CheckCircle } from "@phosphor-icons/react/dist/ssr"
import { db }                  from "@/db"
import { dteDocuments, purchaseOrderInvoices, purchaseOrders, statusHistory, users } from "@/db/schema"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { cleanRut } from "@/lib/rut"
import { requirePermission, can } from "@/lib/auth/can"
import { canAccessWorksite }  from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StateBadge } from "@/components/states/state-badge"
import { RequestProgressPanel } from "@/components/states/request-progress-panel"
import { buildOcProgress, INVOICE_DUE_ORDER_STATUSES } from "@/lib/work-queue"
import { OcActions } from "./oc-actions"
import { InvoicesSection } from "./invoices-section"
import { OcDetailTabs } from "./oc-detail-tabs"
import { OcProgressTable } from "./oc-progress-table"
import { formatCLP, formatDate } from "@/lib/utils"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { Button } from "@/components/ui/button"
import { OcReceptionCta, pendingReceptionStage } from "./oc-reception-cta"
import { OcInvoiceCta } from "./oc-invoice-cta"
import { OcDetailItems } from "./oc-detail-items"
import { DetailLine, AmountLine } from "./oc-detail-page.helpers"
import { getOcReconciliation } from "@/lib/services/oc-reconciliation"
import { getDocumentChain } from "@/lib/services/document-chain"
import { DocumentChainStrip } from "@/components/documents/document-chain-strip"
import { DteReceivedCard } from "./dte-received-card"


export const metadata: Metadata = { title: "Orden de compra" }

export default async function OcDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; nro?: string; actualizada?: string }>
}) {
  let session
  try { session = await requirePermission("purchasing:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/compras")}`) }

  const [{ id }, { tab, nro, actualizada }] = await Promise.all([params, searchParams])

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: {
      items:    { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
      worksite: true,
      supplier: true,
    },
  })

  if (!order) notFound()
  if (!canAccessWorksite(session, order.worksiteId)) notFound()

  // Estado "eliminado" (TASK-UI-002). Borrar una OC no borra la fila: le pone
  // `deletedAt` y le muta el código a `OC-…-DELETED-<id>` para liberar el
  // UNIQUE. Sin este corte, quien abría un enlace antiguo veía la ficha
  // completa —con ese código mutado en el encabezado— como si el registro
  // siguiera vivo. Se muestra qué pasó, cuándo, y la salida a la lista.
  if (order.deletedAt) {
    const originalCode = order.code.replace(/-DELETED-[A-Za-z0-9_-]+$/, "")
    return (
      <PageContainer width="form">
        <div className="mx-auto max-w-2xl py-10">
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">Orden eliminada</p>
          <h1 className="mt-1 text-h1 text-[var(--color-text)]">{originalCode}</h1>
          <p className="mt-2 max-w-[60ch] text-sub">
            Esta orden de compra fue eliminada el {formatDate(order.deletedAt)}. Se conserva en la
            auditoría para poder rastrearla, pero ya no forma parte del flujo de adquisiciones.
          </p>
          <div className="mt-6">
            <Button asChild><Link href="/compras">Volver a Compras</Link></Button>
          </div>
        </div>
      </PageContainer>
    )
  }



  // Load linked request items + request codes for traceability
  const requestItemIds = order.items
    .map((i) => i.requestItemId)
    .filter((id): id is string => id !== null)

  const productIds = order.items
    .map((i) => i.productId)
    .filter((id): id is string => id !== null)

  const [requestItemRows, productRows, timelineEvents, orderInvoices] = await Promise.all([
    requestItemIds.length > 0
      ? db.query.purchaseRequestItems.findMany({
          where: (ri, { inArray }) => inArray(ri.id, requestItemIds),
          // `equipment` y `worker`: la ficha tiene que decir sobre qué
          // instrumento y para quién es cada línea de servicio.
          with: { request: true, equipment: true, worker: true },
        })
      : Promise.resolve([]),

    productIds.length > 0
      ? db.query.products.findMany({
          where: (p, { inArray }) => inArray(p.id, productIds),
          columns: { id: true, sku: true, name: true },
        })
      : Promise.resolve([]),

    db
      .select({
        id:          statusHistory.id,
        fromStatus:  statusHistory.fromStatus,
        toStatus:    statusHistory.toStatus,
        changedBy:   statusHistory.changedBy,
        changedAt:   statusHistory.changedAt,
        reason:      statusHistory.reason,
        userName:    users.name,
        userEmail:   users.email,
      })
      .from(statusHistory)
      .leftJoin(users, eq(statusHistory.changedBy, users.id))
      .where(
        and(
          eq(statusHistory.entityType, "purchase_order"),
          eq(statusHistory.entityId, order.id),
        ),
      )
      .orderBy(desc(statusHistory.changedAt)),

    db
      .select({
        id:            purchaseOrderInvoices.id,
        invoiceNumber: purchaseOrderInvoices.invoiceNumber,
        amount:        purchaseOrderInvoices.amount,
        issueDate:     purchaseOrderInvoices.issueDate,
        fileName:      purchaseOrderInvoices.fileName,
        mimeType:      purchaseOrderInvoices.mimeType,
        uploadedAt:    purchaseOrderInvoices.uploadedAt,
      })
      .from(purchaseOrderInvoices)
      .where(eq(purchaseOrderInvoices.purchaseOrderId, order.id))
      .orderBy(desc(purchaseOrderInvoices.uploadedAt)),
  ])

  // ARQ-10: ambas cuelgan sólo de `invoiceIds` — ninguna espera a la otra.
  const invoiceIds = orderInvoices.map((inv) => inv.id)
  const [invoiceItemRows, dteRows] = invoiceIds.length === 0
    ? [[], []]
    : await Promise.all([
        // Load invoice items for reconciliation
        db.query.purchaseOrderInvoiceItems.findMany({
          where: (t, { inArray }) => inArray(t.invoiceId, invoiceIds),
        }),
        // DTE del portal tributario ya conciliados contra las facturas de esta
        // OC (ver lib/services/dte-portal/reconciliation.ts).
        db.query.dteDocuments.findMany({
          where: inArray(dteDocuments.purchaseOrderInvoiceId, invoiceIds),
          columns: { id: true, tipoDte: true, folio: true, rutEmisor: true, razonSocialEmisor: true, montoTotal: true, estadoSii: true },
          orderBy: (d, { desc: descOrder }) => [descOrder(d.fechaEmision)],
        }),
      ])

  // DTE del proveedor de esta OC que todavía no cuelgan de ninguna factura:
  // son los candidatos a registrar sin volver a subir un archivo que la
  // plataforma ya tiene. Es la contracara de `dteRows` —que muestra los ya
  // vinculados— y existe porque el vínculo automático sólo ocurre DESPUÉS de
  // que alguien tipeó el folio a mano (ver reconciliation.ts): sin esta lista,
  // para ver el DTE en la OC había que tener ya la factura cargada.
  //
  // Sólo 33 y 34, igual que el conciliador: el folio de una NC/ND viene de una
  // secuencia distinta del SII y ofrecerla acá invitaría a colgarla de la OC
  // equivocada.
  //
  // El RUT se compara en memoria con cleanRut() y no en SQL, para usar
  // exactamente la misma normalización que el conciliador — `suppliers.rut` se
  // ingresa a mano y no siempre trae el mismo formato que el portal.
  // ponytail: filtra en memoria sobre los DTE sin vincular; con volúmenes de
  // años convendría un índice sobre el RUT normalizado.
  const supplierRut = order.supplier?.rut ? cleanRut(order.supplier.rut) : null
  const unlinkedDtes = supplierRut
    ? await db.query.dteDocuments.findMany({
        where: and(
          isNull(dteDocuments.purchaseOrderInvoiceId),
          inArray(dteDocuments.tipoDte, ["33", "34"]),
        ),
        columns: {
          id: true, tipoDte: true, folio: true, rutEmisor: true,
          razonSocialEmisor: true, montoTotal: true, fechaEmision: true, estadoSii: true,
        },
        orderBy: (d, { desc: descOrder }) => [descOrder(d.fechaEmision)],
      })
    : []
  const candidateDtes = unlinkedDtes
    .filter((doc) => cleanRut(doc.rutEmisor) === supplierRut)
    .slice(0, 20)

  // Attach items to invoices
  const invoicesWithItems = orderInvoices.map((inv) => ({
    ...inv,
    items: invoiceItemRows.filter((item) => item.invoiceId === inv.id),
  }))

  // Cantidad facturada por ítem de OC (reutilizado por close-warnings y tabla de avance)
  const invoicedByItem = new Map<string, number>()
  for (const item of invoiceItemRows) {
    if (item.purchaseOrderItemId) {
      invoicedByItem.set(item.purchaseOrderItemId, (invoicedByItem.get(item.purchaseOrderItemId) ?? 0) + item.quantity)
    }
  }

  // Build maps
  const reqItemMap = Object.fromEntries(requestItemRows.map((ri) => [ri.id, ri]))
  const productMap = Object.fromEntries(productRows.map((p) => [p.id, p]))

  const canManage      = session.user.permissions.includes("purchasing:create_order")
  const canSend        = session.user.permissions.includes("purchasing:send_order")
  // Registrar el costo real de un servicio es la misma decisión que ponerle
  // precio a la OC al crearla, sólo que más tarde; mientras la orden no esté
  // anulada, la línea sigue siendo priceable.
  const canRecordCost  = canManage && order.status !== "cancelled"
  const pendingCostLines = order.items.filter((item) => item.unitPrice === null && item.status !== "cancelled").length
  // Nombres para la traza "registrado por…"; se resuelven aparte porque la
  // relación no viaja en la consulta principal de la OC.
  const costRecorderIds = [...new Set(
    order.items.map((i) => i.costRecordedBy).filter((userId): userId is string => userId != null),
  )]
  const costRecorderNameById = new Map(
    costRecorderIds.length === 0
      ? []
      : (await db.select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, costRecorderIds))
        ).map((user) => [user.id, user.name ?? user.email ?? user.id] as const),
  )
  const canDeleteOrder = can(session, "purchasing:delete_order")
  const canInvoice     = canSend   // purchasing:send_order gate for invoice management
  const canRegisterFaenaReception  = session.user.permissions.includes("receiving:register_faena")
  const canRegisterOfficeReception = session.user.permissions.includes("receiving:register_office")
  const pendingOfficeQuantity = order.items.reduce(
    (total, item) => total + Math.max(0, item.quantity - (item.quantityOfficeReceived ?? 0)),
    0,
  )
  // En una OC directo a faena nada pasa por oficina, así que el saldo por
  // recibir es el total pedido: medirlo contra `quantityOfficeReceived` (siempre
  // 0 en esa vía) daba 0 y la OC quedaba sin siguiente paso a la vista.
  const pendingFaenaQuantity = order.items.reduce(
    (total, item) => total + Math.max(
      0,
      (order.deliveryMode === "directo_faena" ? item.quantity : (item.quantityOfficeReceived ?? 0))
        - (item.quantityReceived ?? 0),
    ),
    0,
  )
  const canShowOrderActions =
    (order.status === "draft" && (canManage || canSend || canDeleteOrder)) ||
    (order.status === "sent" && (canManage || canDeleteOrder)) ||
    (order.status === "partially_received" && canManage) ||
    (order.status === "received" && canManage)

  const orderItemIds = order.items.map((i) => i.id)
  const [{ receivedByItem }, documentChain] = await Promise.all([
    getOcReconciliation(order.id, orderItemIds),
    getDocumentChain(session, { kind: "order", id: order.id }),
  ])
  const activeGuideDocument = documentChain.dispatchGuides.find((guide) =>
    guide.status !== null && ["draft", "dispatched", "partially_received"].includes(guide.status),
  )
  const activeDispatchGuide = activeGuideDocument
    ? { id: activeGuideDocument.id, code: activeGuideDocument.code, status: activeGuideDocument.status! }
    : undefined

  // Calculate invoice reconciliation warnings for the close form
  const hasLineItems = invoiceItemRows.length > 0
  const closeWarnings: string[] = []
  if (!["draft", "cancelled"].includes(order.status)) {
    if (orderInvoices.length === 0) {
      closeWarnings.push("No hay facturas adjuntadas a esta orden.")
    } else if (!hasLineItems) {
      closeWarnings.push("Las facturas no tienen ítems detallados.")
    } else {
      // Check per-item reconciliation
      for (const ocItem of order.items) {
        const invoicedQty = invoicedByItem.get(ocItem.id) ?? 0
        if (invoicedQty === 0) {
          const name = ocItem.productNameFree ?? (ocItem.productId ? productMap[ocItem.productId]?.name : null) ?? "Ítem"
          closeWarnings.push(`"${name}" sin factura asociada.`)
        } else if (Math.abs(ocItem.quantity - invoicedQty) > 0.01) {
          const name = ocItem.productNameFree ?? (ocItem.productId ? productMap[ocItem.productId]?.name : null) ?? "Ítem"
          closeWarnings.push(`"${name}": cant. OC (${ocItem.quantity}) ≠ cant. facturada (${invoicedQty}).`)
        }
      }
      if (Math.abs(orderInvoices.reduce((s, i) => s + (i.amount ?? 0), 0) - order.totalAmount) > 1) {
        closeWarnings.push("Total facturado difiere del total OC.")
      }
    }
  }

  // Stepper de ciclo (reutiliza el panel de solicitudes)
  const progress = buildOcProgress(
    order.status,
    order.items.map((i) => ({
      id:               i.id,
      productName:      i.productNameFree ?? (i.productId ? productMap[i.productId]?.name : null) ?? "Ítem",
      quantity:         i.quantity,
      unitOfMeasure:    i.unitOfMeasure,
      quantityReceived: receivedByItem.get(i.id) ?? i.quantityReceived ?? 0,
    })),
    "compras",
    // `closeWarnings` sólo se llena en estados que ya admiten facturación, así
    // que basta con que tenga contenido.
    { invoicePending: closeWarnings.length > 0 },
  )

  // Filas de la tabla de avance (pedido / recibido / facturado por ítem)
  const progressRows = order.items.map((i) => ({
    id:            i.id,
    productName:   i.productNameFree ?? (i.productId ? productMap[i.productId]?.name : null) ?? "Ítem",
    unitOfMeasure: i.unitOfMeasure,
    ordered:       i.quantity,
    received:      receivedByItem.get(i.id) ?? i.quantityReceived ?? 0,
    invoiced:      invoicedByItem.get(i.id) ?? 0,
  }))

  const showInvoicing = !["draft", "cancelled"].includes(order.status)

  // Pestaña inicial desde ?tab= (validada contra las disponibles) para deep-link
  const availableTabs = ["items", ...(showInvoicing ? ["facturacion", "avance"] : []), "historial"]
  const initialTab = tab && availableTabs.includes(tab) ? tab : "items"

  // `?nro=` llega desde el detalle de una recepción: el número de guía/factura ya
  // lo tipeó quien recibió, así que no se pide de nuevo. Mismo tope que
  // `dispatchGuideNo` en la validación de recepciones.
  const defaultInvoiceNumber = typeof nro === "string" ? nro.trim().slice(0, 80) || undefined : undefined
  // Mismo criterio que el CTA de recepción, no un "queda saldo" propio: en una
  // OC directo a faena ya recibida, el saldo de oficina es el total pedido y
  // degradaba el CTA de factura a secundario sin que hubiera nada que recibir.
  const receptionPending = pendingReceptionStage({
    status: order.status,
    deliveryMode: order.deliveryMode,
    pendingOfficeQuantity,
    pendingFaenaQuantity,
  }) !== null
  // Misma regla que la cola operacional y el listado: la factura se exige desde
  // que llegó mercadería, no desde que la OC salió al proveedor.
  const invoiceDue = INVOICE_DUE_ORDER_STATUSES.includes(order.status)

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={order.code}
        description={`${order.worksite?.name ?? "—"} · ${order.supplier?.name ?? "—"}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Compras", href: "/compras" },
            { label: order.code                       },
          ]} />
        }
      />

      {/* UX-6: "Emitir y enviar" es la acción principal del módulo y antes
          no confirmaba nada — el redirect llevaba este parámetro, pero
          ningún componente lo consumía. */}
      {(actualizada === "enviada" || actualizada === "creada") && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] bg-[var(--color-success-tint)] border border-[var(--color-success-line)]">
          <CheckCircle size={16} className="text-[var(--color-success-ink)] shrink-0" />
          <p className="text-sm text-[var(--color-success-ink)]">
            {actualizada === "creada" ? "Orden de compra creada en borrador." : "Orden emitida y enviada al proveedor."}
          </p>
        </div>
      )}

      <DocumentChainStrip
        chain={documentChain}
        current={{ kind: "order", id: order.id }}
        currentCode={order.code}
        className="mb-6"
      />

      {progress && (
        <div className="mb-6">
          <RequestProgressPanel progress={progress} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0">
          <OcDetailTabs
            defaultTab={initialTab}
            itemsCount={order.items.length}
            invoicesCount={orderInvoices.length}
            invoicesPending={invoiceDue}
            historyCount={timelineEvents.length}
            items={
              <div className="flex flex-col gap-6">
                <OcDetailItems
                  order={{
                    code: order.code,
                    status: order.status,
                    netAmount: order.netAmount,
                    taxAmount: order.taxAmount,
                    totalAmount: order.totalAmount,
                    paymentTerms: order.paymentTerms,
                    estimatedDelivery: order.estimatedDelivery,
                    notes: order.notes,
                    items: order.items.map((i) => ({
                      id: i.id,
                      requestItemId: i.requestItemId,
                      productId: i.productId,
                      productNameFree: i.productNameFree,
                      quantity: i.quantity,
                      unitOfMeasure: i.unitOfMeasure,
                      unitPrice: i.unitPrice,
                      subtotal: i.subtotal,
                      notes: i.notes,
                      equipmentLabel: (() => {
                        const equipment = i.requestItemId ? reqItemMap[i.requestItemId]?.equipment : null
                        return equipment ? `${equipment.code} · ${equipment.name}` : null
                      })(),
                      workerName: (() => {
                        const worker = i.requestItemId ? reqItemMap[i.requestItemId]?.worker : null
                        return worker ? `${worker.firstName} ${worker.lastName}` : null
                      })(),
                      costRecordedAt: i.costRecordedAt,
                      costRecordedByName: i.costRecordedBy ? (costRecorderNameById.get(i.costRecordedBy) ?? null) : null,
                    })),
                    worksite: order.worksite ? { name: order.worksite.name } : null,
                    supplier: order.supplier ? { name: order.supplier.name } : null,
                  }}
                  reqItemMap={reqItemMap as unknown as Record<string, { request: { code: string } }>}
                  productMap={productMap as unknown as Record<string, { name: string; sku: string | null }>}
                  canRecordCost={canRecordCost}
                />
                {order.notes && (
                  <div className="p-4 rounded-(--radius-xl) bg-(--color-surface-2)">
                    <p className="text-xs text-text-subtle mb-1">Notas</p>
                    <p className="text-sm text-(--color-text-muted)">{order.notes}</p>
                  </div>
                )}
              </div>
            }
            facturacion={showInvoicing ? (
              <div className="flex flex-col gap-6">
                <InvoicesSection
                  purchaseOrderId={order.id}
                  invoices={invoicesWithItems as unknown as React.ComponentProps<typeof InvoicesSection>["invoices"]}
                  ocItems={order.items.map((i) => ({
                    id: i.id,
                    productName: i.productNameFree ?? (i.productId ? productMap[i.productId]?.name : null) ?? i.id,
                    productCode: i.productId ? productMap[i.productId]?.sku ?? null : null,
                    unitOfMeasure: i.unitOfMeasure,
                    quantity: i.quantity,
                    unitPrice: i.unitPrice,
                    subtotal: i.subtotal,
                  }))}
                  totalAmount={order.totalAmount}
                  canManage={canInvoice}
                  defaultInvoiceNumber={defaultInvoiceNumber}
                  dteCandidates={candidateDtes.map((doc) => ({
                    id: doc.id,
                    tipoDte: doc.tipoDte,
                    folio: doc.folio,
                    razonSocialEmisor: doc.razonSocialEmisor,
                    montoTotal: doc.montoTotal,
                    fechaEmision: doc.fechaEmision,
                  }))}
                />
                <DteReceivedCard docs={dteRows} />
              </div>
            ) : undefined}
            avance={showInvoicing ? <OcProgressTable rows={progressRows} /> : undefined}
            historial={<EntityTimeline entityType="oc" events={timelineEvents} />}
          />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6">
          <section className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4">
            <div className="flex items-center justify-between gap-3">
              <StateBadge state={order.status} entity="oc" />
              <Button asChild variant="secondary" size="sm">
                <a
                  href={`/compras/${order.id}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Imprimir / PDF
                </a>
              </Button>
            </div>

            <dl className="mt-4 divide-y divide-(--color-border)">
              <DetailLine label="Proveedor" value={order.supplier?.name ?? "—"} />
              <DetailLine label="Faena" value={order.worksite?.name ?? "—"} />
              <DetailLine label="Condición de pago" value={order.paymentTerms ?? "—"} />
              <DetailLine label="Entrega estimada" value={order.estimatedDelivery ? formatDate(order.estimatedDelivery) : "—"} />
            </dl>
            <OcReceptionCta
              orderId={order.id}
              status={order.status}
              deliveryMode={order.deliveryMode}
              pendingOfficeQuantity={pendingOfficeQuantity}
              pendingFaenaQuantity={pendingFaenaQuantity}
              worksiteName={order.worksite?.name ?? "la faena"}
              canRegisterOffice={canRegisterOfficeReception}
              canRegisterFaena={canRegisterFaenaReception}
              activeDispatchGuide={activeDispatchGuide}
            />
            {showInvoicing && (
              <OcInvoiceCta
                orderId={order.id}
                invoiceCount={orderInvoices.length}
                invoiceDue={invoiceDue}
                warnings={closeWarnings}
                canManage={canInvoice}
                receptionPending={receptionPending}
              />
            )}
          </section>

          <section className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4">
            <h2 className="text-sm font-semibold text-(--color-text)">Totales</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <AmountLine label={pendingCostLines > 0 ? "Neto conocido" : "Neto"} value={formatCLP(order.netAmount)} />
              <AmountLine label="IVA (19%)" value={formatCLP(order.taxAmount)} muted />
              <div className="flex items-center justify-between gap-3 border-t border-(--color-border) pt-3">
                <dt className="font-semibold text-(--color-text)">{pendingCostLines > 0 ? "Total conocido" : "Total"}</dt>
                <dd className="font-mono font-bold tabular-nums text-(--color-text)">{formatCLP(order.totalAmount)}</dd>
              </div>
              {/* Nunca se representa el costo desconocido como $0: se cuenta aparte. */}
              {pendingCostLines > 0 && (
                <div className="flex items-center justify-between gap-3 pt-1">
                  <dt className="text-xs text-(--color-warning-ink)">Servicios con costo pendiente</dt>
                  <dd className="text-xs font-medium text-(--color-warning-ink)">{pendingCostLines}</dd>
                </div>
              )}
            </dl>
          </section>

          {canShowOrderActions && (
            <section className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4">
              <h2 className="mb-3 text-sm font-semibold text-(--color-text)">Acciones</h2>
              <OcActions
                orderId={order.id}
                orderCode={order.code}
                status={order.status}
                canManage={canManage}
                canSend={canSend}
                canDelete={canDeleteOrder}
                closeWarnings={closeWarnings}
              />
            </section>
          )}
        </aside>
      </div>
    </PageContainer>
  )
}
