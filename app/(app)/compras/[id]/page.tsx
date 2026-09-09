import { getProductAttributesByIds } from "@/lib/services/product-sizes"
import { formatVariantProductName } from "@/lib/products/variant-grouping"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { CheckCircle } from "@phosphor-icons/react/dist/ssr"
import { db }                  from "@/db"
import { dteDocumentItems, dteDocuments, purchaseOrderInvoiceReceipts, purchaseOrderInvoices, purchaseOrders, statusHistory, supplierProductAliases, users } from "@/db/schema"
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm"
import { localDateToISO } from "@/lib/sst/date"
import { assessDteCandidates, DTE_ATTACHABLE_TIPOS } from "@/lib/services/purchasing-module/dte-candidates"
import { getOperationalSettings } from "@/lib/services/system-settings"
import { cleanRut } from "@/lib/rut"
import { getPurchaseOrderInvoiceReconciliation, reconciliationWarnings } from "@/lib/services/purchasing-module/invoice-reconciliation-service"
import { requireAuth, can, canAny } from "@/lib/auth/can"
import { canAccessWorksite }  from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { loadInvoiceLineAllocationsTx } from "@/lib/services/purchasing-module/invoice-line-allocations"
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
import { DetailItem } from "@/components/ui/detail-item"
import { getOcReconciliation } from "@/lib/services/oc-reconciliation"
import { getDocumentChain } from "@/lib/services/document-chain"
import { DocumentChainStrip } from "@/components/documents/document-chain-strip"
import { DteReceivedCard } from "./dte-received-card"
import { suggestReceiptLinks } from "@/lib/services/purchasing-module/invoice-receipt-suggestions"


export const metadata: Metadata = { title: "Orden de compra" }

export default async function OcDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; receiptId?: string; actualizada?: string }>
}) {
  // Quien recibe la OC necesita leerla —ítems, cantidades, montos— y los roles de
  // faena (prevencionista_faena, solicitante_faena, prevencionista) tienen
  // `receiving:view` pero no `purchasing:view`: con el gate en un solo permiso,
  // abrir una fila de /recepcion terminaba en /forbidden. El alcance de faena
  // sigue mandando más abajo, y lo tributario (facturación, avance) queda
  // reservado a Compras vía `canViewPurchasing`.
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/compras")}`) }
  if (!canAny(session, "purchasing:view", "receiving:view")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/compras")}`)
  }
  const canViewPurchasing = can(session, "purchasing:view")

  const [{ id }, { tab, receiptId, actualizada }] = await Promise.all([params, searchParams])

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
  // Un borrador no existe todavía para quien recibe: no entra en la cola de
  // recepción y sus precios siguen en negociación. El camino hasta acá era la
  // tira de documentos desde la solicitud propia, que ahora tampoco lo ofrece.
  if (!canViewPurchasing && order.status === "draft") notFound()

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
            {/* La salida es a la lista de la que vino: /compras exige su propio
                permiso y para un receptor era otro callejón sin salida. */}
            <Button asChild>
              {canViewPurchasing
                ? <Link href="/compras">Volver a Compras</Link>
                : <Link href="/recepcion">Volver a Recepción</Link>}
            </Button>
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

  const [requestItemRows, productRows, timelineEvents, orderInvoices, orderReceipts] = await Promise.all([
    requestItemIds.length > 0
      ? db.query.purchaseRequestItems.findMany({
          where: (ri, { inArray }) => inArray(ri.id, requestItemIds),
          // `equipment` y `worker`: la ficha tiene que decir sobre qué
          // instrumento y para quién es cada línea de servicio.
          with: { request: true, equipment: true, worker: true, attributes: true },
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

    // Las facturas —y con ellas sus ítems y sus DTE, que cuelgan de estos ids—
    // sólo alimentan pestañas y avisos que un receptor no ve.
    canViewPurchasing
      ? db
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
          .orderBy(desc(purchaseOrderInvoices.uploadedAt))
      : Promise.resolve([]),

    canViewPurchasing
      ? db.query.receipts.findMany({
          where: (receipt, { eq: equals }) => equals(receipt.purchaseOrderId, order.id),
          columns: {
            id: true,
            code: true,
            receivedAt: true,
            locationType: true,
            dispatchGuideNo: true,
            purchaseOrderId: true,
          },
          with: {
            items: {
              columns: { purchaseOrderItemId: true, quantityReceived: true },
            },
          },
          orderBy: (receipt, { desc: descending }) => [descending(receipt.receivedAt)],
        })
      : Promise.resolve([]),
  ])

  // ARQ-10: ambas cuelgan sólo de `invoiceIds` — ninguna espera a la otra.
  const invoiceIds = orderInvoices.map((inv) => inv.id)
  const [invoiceItemRows, dteRows, invoiceReceiptLinks] = invoiceIds.length === 0
    ? [[], [], []]
    : await Promise.all([
        // Load invoice items for reconciliation
        db.transaction(async tx => {
          // Keep displayed documentary values and editor fingerprints coherent
          // with allocation writers, which also lock the owning order.
          await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.id, order.id)).for("update")
          const lines = await tx.query.purchaseOrderInvoiceItems.findMany({
            where: (t, { inArray }) => inArray(t.invoiceId, invoiceIds),
            columns: { id: true, invoiceId: true, productName: true, productCode: true, unitOfMeasure: true, quantity: true, unitPrice: true, subtotal: true },
            with: { allocations: { columns: { id: true, purchaseOrderItemId: true, quantity: true, subtotal: true } } },
          })
          const result = []
          for (const line of lines) {
            const evidence = await loadInvoiceLineAllocationsTx(tx, { purchaseOrderId: order.id, invoiceItemId: line.id, worksiteScope: serviceWorksiteScope(session) })
            result.push({ ...line, allocationFingerprint: evidence.fingerprint })
          }
          return result
        }),
        // DTE del portal tributario ya conciliados contra las facturas de esta
        // OC (ver lib/services/dte-portal/reconciliation.ts).
        db.query.dteDocuments.findMany({
          where: inArray(dteDocuments.purchaseOrderInvoiceId, invoiceIds),
          columns: { id: true, tipoDte: true, folio: true, rutEmisor: true, razonSocialEmisor: true, montoTotal: true, estadoSii: true },
          orderBy: (d, { desc: descOrder }) => [descOrder(d.fechaEmision)],
        }),
        db
          .select({
            invoiceId: purchaseOrderInvoiceReceipts.invoiceId,
            receiptId: purchaseOrderInvoiceReceipts.receiptId,
          })
          .from(purchaseOrderInvoiceReceipts)
          .where(inArray(purchaseOrderInvoiceReceipts.invoiceId, invoiceIds)),
      ])

  // Cantidad facturada por ítem de OC: alimenta tanto la ficha como el saldo
  // contra el que se evalúan las líneas de cada DTE candidato.
  const invoicedByItem = new Map<string, number>()
  for (const item of invoiceItemRows) {
    for (const allocation of item.allocations) {
      invoicedByItem.set(allocation.purchaseOrderItemId, (invoicedByItem.get(allocation.purchaseOrderItemId) ?? 0) + allocation.quantity)
    }
  }

  const attributesById = await getProductAttributesByIds(productIds)
  const productMap = Object.fromEntries(productRows.map((product) => [product.id, { ...product, attributes: attributesById.get(product.id) }]))
  const itemName = (item: { productId: string | null; productNameFree: string | null; requestItemId: string | null }) => {
    const product = item.productId ? productMap[item.productId] : undefined
    const recorded = requestItemRows.find((row) => row.id === item.requestItemId)?.attributes
    return formatVariantProductName(product?.name ?? item.productNameFree ?? "Ítem", product?.attributes,
      recorded?.map((a) => ({ name: a.attributeName, value: a.value })))
  }


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
  // El acotado por proveedor y por fecha vive en `assessDteCandidates`, con sus
  // pruebas: la primera versión filtraba sólo por RUT y ofrecía documentos que
  // no podían pertenecer a la orden. Acá sólo se estrecha lo barato en SQL.
  // `createdAt` se guarda como texto UTC (mode: "string"). Se convierte a la
  // fecha CALENDARIO chilena antes de comparar contra `fechaEmision`, que el
  // portal entrega en hora local: comparar el texto UTC directamente corría el
  // piso un día para las órdenes creadas después de las 20:00.
  const candidateFloor = localDateToISO(new Date(order.createdAt))
  // Sin `purchasing:view` la pestaña de facturación no se dibuja, así que esta
  // consulta —la más cara de la página— no tiene a quién servir. Una OC anulada
  // tampoco: el servicio rechaza adjuntar factura en `cancelled`, así que
  // ofrecer candidatos sería un alta que falla siempre.
  const unlinkedDtes = canViewPurchasing && order.status !== "cancelled" && order.supplier?.rut
    ? await db.query.dteDocuments.findMany({
        where: and(
          isNull(dteDocuments.purchaseOrderInvoiceId),
          isNull(dteDocuments.fuelLoadId),
          // Incluye la nota de crédito (61): también cuelga de la OC, restando.
          inArray(dteDocuments.tipoDte, [...DTE_ATTACHABLE_TIPOS]),
          gte(dteDocuments.fechaEmision, candidateFloor),
        ),
        columns: {
          id: true, tipoDte: true, folio: true, rutEmisor: true,
          razonSocialEmisor: true, montoTotal: true, fechaEmision: true,
          lineEnrichmentStatus: true, lineEnrichedAt: true, referencedOrderCodes: true,
        },
        orderBy: (d, { desc: descOrder }) => [descOrder(d.fechaEmision)],
      })
    : []
  // Monto que la orden espera facturar: su total menos lo ya facturado. La
  // operación factura una OC por DTE, así que el documento correcto trae esta
  // cifra — sirve para ordenar y marcar, no para filtrar.
  const opsSettings = await getOperationalSettings()
  const alreadyInvoiced = orderInvoices.reduce((sum, inv) => sum + (inv.amount ?? 0), 0)
  const expectedAmount = Math.max(0, (order.totalAmount ?? 0) - alreadyInvoiced)

  const supplierDtes = unlinkedDtes.filter((doc) => cleanRut(doc.rutEmisor) === cleanRut(order.supplier?.rut ?? ""))
  const [candidateLineRows, supplierAliasRows] = await Promise.all([
    supplierDtes.length > 0
      ? db.query.dteDocumentItems.findMany({
          where: inArray(dteDocumentItems.dteDocumentId, supplierDtes.map((doc) => doc.id)),
          orderBy: (line, { asc }) => [asc(line.lineNumber)],
        })
      : Promise.resolve([]),
    productIds.length > 0 && order.supplierId
      ? db.query.supplierProductAliases.findMany({
          where: and(
            eq(supplierProductAliases.supplierId, order.supplierId),
            inArray(supplierProductAliases.productId, productIds),
          ),
          columns: { productId: true, normalizedCode: true, normalizedName: true },
        })
      : Promise.resolve([]),
  ])
  const linesByDte = new Map<string, typeof candidateLineRows>()
  for (const line of candidateLineRows) {
    const lines = linesByDte.get(line.dteDocumentId) ?? []
    lines.push(line)
    linesByDte.set(line.dteDocumentId, lines)
  }

  const candidateDtes = assessDteCandidates(
    supplierDtes.map((doc) => ({
      ...doc,
      enrichmentStatus: doc.lineEnrichmentStatus as "pending" | "ready" | "failed",
      lines: (linesByDte.get(doc.id) ?? []).map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        productCode: line.productCode,
        productName: line.productName,
        unitOfMeasure: line.unitOfMeasure,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
      })),
    })), {
    supplierRut: order.supplier?.rut ?? null,
    createdOn: candidateFloor,
    expectedAmount,
    orderCode: order.code,
    // Misma tolerancia que usa el conciliador: si el badge dijera "calza" y la
    // tarjeta de abajo marcara discrepancia, el operador tendría que elegir a
    // cuál de las dos creerle.
    clpTolerance: opsSettings.purchasingClpTolerance,
    orderItems: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: itemName(item),
      productCode: item.productId ? productMap[item.productId]?.sku ?? null : null,
      unitOfMeasure: item.unitOfMeasure,
      quantity: item.quantity,
      invoicedQuantity: invoicedByItem.get(item.id) ?? 0,
    })),
    aliases: supplierAliasRows,
  })

  // Attach items to invoices
  const receiptOptions = orderReceipts.map((receipt) => ({
    id: receipt.id,
    code: receipt.code,
    receivedAt: receipt.receivedAt,
    locationType: receipt.locationType,
    dispatchGuideNo: receipt.dispatchGuideNo,
    items: receipt.items,
  }))
  const receiptIdsByInvoice = new Map<string, string[]>()
  for (const link of invoiceReceiptLinks) {
    const receiptIds = receiptIdsByInvoice.get(link.invoiceId) ?? []
    receiptIds.push(link.receiptId)
    receiptIdsByInvoice.set(link.invoiceId, receiptIds)
  }
  const invoicesWithItems = orderInvoices.map((inv) => {
    const items = invoiceItemRows.filter((item) => item.invoiceId === inv.id)
    return {
      ...inv,
      items,
      receiptIds: receiptIdsByInvoice.get(inv.id) ?? [],
      receiptSuggestion: suggestReceiptLinks({
        id: inv.id,
        purchaseOrderId: order.id,
        invoiceNumber: inv.invoiceNumber,
        issueDate: inv.issueDate,
        items: items.flatMap(item => item.allocations.map(allocation => ({ purchaseOrderItemId: allocation.purchaseOrderItemId, quantity: allocation.quantity }))),
      }, orderReceipts),
    }
  })

  const invoiceReconciliation = canViewPurchasing
    ? await getPurchaseOrderInvoiceReconciliation(order.id)
    : null

  // Build maps
  const reqItemMap = Object.fromEntries(requestItemRows.map((ri) => [ri.id, ri]))

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
  const canUpdateCatalog = can(session, "admin:products")
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

  const closeWarnings = !["draft", "cancelled"].includes(order.status) && invoiceReconciliation
    ? reconciliationWarnings(invoiceReconciliation)
    : []

  // Stepper de ciclo (reutiliza el panel de solicitudes)
  const progress = buildOcProgress(
    order.status,
    order.items.map((i) => {
      const requestItem = i.requestItemId ? reqItemMap[i.requestItemId] : null
      return {
        id:               i.id,
        productName:      itemName(i),
        quantity:         i.quantity,
        unitOfMeasure:    i.unitOfMeasure,
        quantityReceived: receivedByItem.get(i.id) ?? i.quantityReceived ?? 0,
        attributes:       requestItem?.attributes.map((attribute) => ({
          name: attribute.attributeName,
          value: attribute.value,
        })) ?? [],
      }
    }),
    // El panel tiene dos voces (A-10) y quien entra por recepción lee la suya:
    // con la de compras, una OC recibida sin factura le pedía "Adjunta la
    // factura y luego cierra la orden", que es trabajo de otro.
    canViewPurchasing ? "compras" : "recepcion",
    // `closeWarnings` sólo se llena en estados que ya admiten facturación, así
    // que basta con que tenga contenido.
    { invoicePending: closeWarnings.length > 0 },
  )

  // Filas de la tabla de avance (pedido / recibido / facturado por ítem)
  const progressRows = order.items.map((i) => ({
    id:            i.id,
    productName:   itemName(i),
    unitOfMeasure: i.unitOfMeasure,
    ordered:       i.quantity,
    received:      receivedByItem.get(i.id) ?? i.quantityReceived ?? 0,
    invoiced:      invoicedByItem.get(i.id) ?? 0,
  }))

  // Facturas, DTE y avance facturado son materia de Compras: quien entra por
  // recepción ve la orden y sus montos, no lo tributario.
  const showInvoicing = !["draft", "cancelled"].includes(order.status) && canViewPurchasing
  // Una OC anulada que quedó con facturas conserva la pestaña de facturación.
  // `deletePurchaseOrderInvoice` acepta `cancelled` a propósito —es la única
  // ruta del repo para soltar un DTE colgado de una compra muerta— y esconder
  // la sección dejaba esa ruta sin ninguna entrada por UI. Sólo se suelta lo
  // que ya tiene: adjuntar sigue cerrado en el servicio
  // (`INVOICE_ALLOWED_STATUSES`) y acá no se ofrecen candidatos DTE.
  const showCancelledInvoicing = order.status === "cancelled" && orderInvoices.length > 0 && canViewPurchasing
  const showInvoicingTab = showInvoicing || showCancelledInvoicing

  // Pestaña inicial desde ?tab= (validada contra las disponibles) para deep-link
  const availableTabs = [
    "items",
    ...(showInvoicingTab ? ["facturacion"] : []),
    ...(showInvoicing ? ["avance"] : []),
    "historial",
  ]
  const initialTab = tab && availableTabs.includes(tab) ? tab : "items"

  // El enlace desde Recepción preselecciona únicamente la recepción. Una guía
  // puede compartir formato con una factura, pero no es evidencia suficiente
  // para copiarla como folio tributario.
  const defaultReceiptId = typeof receiptId === "string"
    && orderReceipts.some((receipt) => receipt.id === receiptId)
      ? receiptId
      : undefined
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
  const hasReceivedUninvoicedQuantity = order.items.some((item) => {
    const supplierReceived = order.deliveryMode === "via_oficina"
      ? (item.quantityOfficeReceived ?? 0)
      : (item.quantityReceived ?? 0)
    return supplierReceived > (invoicedByItem.get(item.id) ?? 0) + 0.01
  })
  const invoiceDue = invoiceReconciliation?.status === "needs_review"
    || (invoiceReconciliation?.status === "no_invoices" && INVOICE_DUE_ORDER_STATUSES.includes(order.status))
    || (invoiceReconciliation?.status === "partially_invoiced" && hasReceivedUninvoicedQuantity)

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={order.code}
        description={`${order.worksite?.name ?? "—"} · ${order.supplier?.name ?? "—"}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            // Quien llega desde recepción no puede abrir el listado de Compras:
            // la miga lo nombra, pero no ofrece un enlace que termina en 403.
            canViewPurchasing
              ? { label: "Compras", href: "/compras" }
              : { label: "Recepción", href: "/recepcion" },
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
                  productMap={productMap}
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
            facturacion={showInvoicingTab ? (
              <div className="flex flex-col gap-6">
                {showCancelledInvoicing && (
                  <p className="rounded-(--radius-lg) border border-(--color-warning-line) bg-(--color-warning-tint) px-3 py-2 text-xs text-(--color-warning-ink)">
                    Orden anulada: no admite facturas nuevas. Eliminar una factura de acá la
                    desvincula del DTE del portal y lo deja disponible para vincularlo donde
                    corresponda.
                  </p>
                )}
                <InvoicesSection
                  purchaseOrderId={order.id}
                  invoices={invoicesWithItems as unknown as React.ComponentProps<typeof InvoicesSection>["invoices"]}
                  ocItems={order.items.map((i) => ({
                    id: i.id,
                    catalogProductId: i.productId,
                    productName: itemName(i),
                    productCode: i.productId ? productMap[i.productId]?.sku ?? null : null,
                    attributes: i.requestItemId
                      ? reqItemMap[i.requestItemId]?.attributes.map((attribute) => ({
                          name: attribute.attributeName,
                          value: attribute.value,
                        })) ?? []
                      : [],
                    unitOfMeasure: i.unitOfMeasure,
                    quantity: i.quantity,
                    unitPrice: i.unitPrice,
                    subtotal: i.subtotal,
                  }))}
                  reconciliation={invoiceReconciliation!}
                  canManage={canInvoice}
                  canUpdateCatalog={canUpdateCatalog}
                  // Una OC anulada sólo puede SOLTAR las facturas que tiene —esa
                  // es la ruta de desvinculación que libera al DTE atrapado—, no
                  // recibir nuevas. El servicio ya las rechaza; esto evita
                  // ofrecer en pantalla algo que va a fallar.
                  canAttach={canInvoice && order.status !== "cancelled"}
                  receipts={receiptOptions}
                  defaultReceiptId={defaultReceiptId}
                  dteCandidates={candidateDtes.map(({ doc, confidence, referencesOrder, orderReference, amountMatches, proposedLinks, explanation }) => ({
                    id: doc.id,
                    tipoDte: doc.tipoDte,
                    folio: doc.folio,
                    razonSocialEmisor: doc.razonSocialEmisor,
                    montoTotal: doc.montoTotal,
                    fechaEmision: doc.fechaEmision,
                    amountMatches,
                    referencesOrder,
                    orderReference,
                    confidence,
                    enrichmentStatus: doc.enrichmentStatus,
                    lineEnrichedAt: doc.lineEnrichedAt,
                    lines: doc.lines ?? [],
                    proposedLinks,
                    explanation,
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
              <DetailItem label="Proveedor" value={order.supplier?.name ?? "—"} />
              <DetailItem label="Faena" value={order.worksite?.name ?? "—"} />
              <DetailItem label="Condición de pago" value={order.paymentTerms ?? "—"} />
              <DetailItem label="Entrega estimada" value={order.estimatedDelivery ? formatDate(order.estimatedDelivery) : "—"} />
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
              <DetailItem label={pendingCostLines > 0 ? "Neto conocido" : "Neto"} value={formatCLP(order.netAmount)} mono />
              <DetailItem label="IVA (19%)" value={formatCLP(order.taxAmount)} mono muted />
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
