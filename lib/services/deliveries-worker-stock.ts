import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  attachments,
  deliveries,
  deliveryItems,
  products,
  purchaseOrderItems,
  purchaseRequestItems,
  purchaseRequests,
  workers,
  worksites,
  worksiteStock,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nextCodeTx } from "@/lib/code-sequences"
import { nanoid } from "@/lib/id"
import { getTraceableDeliveryBalance } from "@/lib/services/delivery-eligibility"
import { deliverItemTx } from "@/lib/services/item-state"
import { onEppDeliveryCompleted } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { applyMovementTx } from "@/lib/services/stock"
import { inTransitDeliveryWarning, readInTransitToWorksite, type InTransitDeliveryLine } from "@/lib/services/dispatch-in-transit"
import { codeYear, todayInChile } from "@/lib/utils"
import { backdatedDeliveryMessage, earliestDeliveryDate } from "@/lib/validation/operations"
import type {
  RegisterWorkerStockDeliveryInput,
  WorkerStockDeliveryItemInput,
} from "./deliveries.types"

/** N°62: "Registrar la entrega de los EPP y dejar documentada su entrega". */
const PDTP_EPP_DELIVERY_ACTIVITY_NUMBER = 62

interface TraceableItemState {
  requestItemId: string
  totalDelivered: number
}

function normalizeItems(items: WorkerStockDeliveryItemInput[]): WorkerStockDeliveryItemInput[] {
  if (items.length === 0) throw new Error("Agrega al menos un producto a la entrega")
  if (items.length > 50) throw new Error("Máximo 50 productos por entrega")

  const productIds = new Set<string>()
  const requestItemIds = new Set<string>()

  for (const item of items) {
    if (!item.productId) throw new Error("Cada línea debe tener un producto")
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error("La cantidad de cada producto debe ser mayor a 0")
    }
    if (productIds.has(item.productId)) {
      throw new Error("No repitas un producto en la misma entrega")
    }
    productIds.add(item.productId)

    if (item.requestItemId) {
      if (requestItemIds.has(item.requestItemId)) {
        throw new Error("No repitas un ítem de solicitud en la misma entrega")
      }
      requestItemIds.add(item.requestItemId)
    }

    /*
     * ENT-002 (auditoría 2026-09-14): las mismas dos reglas que el zod, aquí
     * también. El esquema que las tenía —`workerDeliverySchema`— no lo usaba
     * ninguna acción, y este servicio ya repite las demás invariantes porque lo
     * llaman también la importación y los scripts.
     */
    if (item.returnQuantity != null) {
      if (!Number.isFinite(item.returnQuantity) || item.returnQuantity <= 0) {
        throw new Error("La cantidad devuelta debe ser mayor a 0")
      }
      if (!item.returnProductId && !item.returnProductNameFree?.trim()) {
        throw new Error("Indica qué producto se devuelve")
      }
      if (!item.returnReason?.trim()) {
        throw new Error("Indica el motivo de la devolución del EPP usado")
      }
    }
  }

  // A stable lock order avoids a cross-product deadlock if two operators enter
  // the same lines in different visual orders.
  return [...items].sort((left, right) => left.productId.localeCompare(right.productId))
}

async function getTraceableItemState(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  item: WorkerStockDeliveryItemInput,
  workerId: string,
  workerWorksiteId: string,
  sourceWorksiteId: string,
): Promise<TraceableItemState | null> {
  if (!item.requestItemId) return null

  if (sourceWorksiteId !== workerWorksiteId) {
    throw new Error("Un ítem trazable debe entregarse desde el stock de la faena del trabajador")
  }

  const [requestItem] = await tx
    .select()
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.id, item.requestItemId))
    .for("update")
  if (!requestItem) throw new Error("Ítem de solicitud no encontrado")
  if (![
    "partially_received",
    "received",
    "partially_delivered",
  ].includes(requestItem.status)) {
    throw new Error("Solo puedes asociar ítems recibidos pendientes de entrega")
  }
  if (requestItem.productId !== item.productId) {
    throw new Error("El ítem trazable no coincide con el producto")
  }
  if (requestItem.workerId && requestItem.workerId !== workerId) {
    throw new Error("El producto fue solicitado para otro trabajador")
  }

  const request = await tx.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestItem.requestId),
  })
  if (!request || request.worksiteId !== workerWorksiteId) {
    throw new Error("El ítem no pertenece a la faena del trabajador")
  }

  // Una entrega anulada no entregó nada: contarla dejaría saldo bloqueado que
  // ya no corresponde a ninguna entrega vigente.
  const previousDeliveries = await tx
    .select({ quantity: deliveryItems.quantity })
    .from(deliveryItems)
    .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
    .where(and(
      eq(deliveryItems.requestItemId, item.requestItemId),
      isNull(deliveries.voidedAt),
    ))
  const alreadyDelivered = previousDeliveries.reduce((sum, delivery) => sum + delivery.quantity, 0)

  const [receivedRow] = await tx
    .select({ received: sql<number>`coalesce(sum(${purchaseOrderItems.quantityReceived}), 0)` })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.requestItemId, item.requestItemId))
  const receivedAtFaena = Number(receivedRow?.received ?? 0)
  const pending = getTraceableDeliveryBalance({
    requestedQuantity: requestItem.quantity,
    receivedAtFaena,
    deliveredQuantity: alreadyDelivered,
  })

  if (pending <= 0) throw new Error("No hay saldo recibido en faena pendiente de entregar")
  if (item.quantity > pending) {
    throw new Error(`La cantidad excede el saldo pendiente de entrega (${pending})`)
  }

  return {
    requestItemId: item.requestItemId,
    totalDelivered: alreadyDelivered + item.quantity,
  }
}

/**
 * `GDI-002` (auditoría 2026-09-14): el aviso de tránsito viaja por un callback
 * en vez de por el valor de retorno a propósito. Este servicio lo llaman
 * también la importación y los scripts, que no tienen a quién avisarle, y el
 * aviso NO es una condición de la escritura: la entrega se registra igual.
 * Devolverlo cambiaría el contrato de todos los llamadores para un dato que
 * sólo la pantalla usa, mientras que la traza —que sí debe existir siempre—
 * queda escrita en la auditoría de la entrega pase lo que pase.
 */
export interface RegisterWorkerStockDeliveryOptions {
  /** Recibe el aviso cuando parte de lo entregado todavía viaja hacia la faena. */
  onInTransitWarning?: (warning: string) => void
}

/**
 * Registers a physical stock delivery to one worker.
 *
 * The header, all delivery lines and all stock movements share one database
 * transaction. `applyMovementTx` performs the conditional stock decrement, so
 * a stale screen can never produce negative stock.
 */
export async function registerWorkerStockDelivery(
  input: RegisterWorkerStockDeliveryInput,
  worksiteIds: string[] | "all" = "all",
  options: RegisterWorkerStockDeliveryOptions = {},
): Promise<string> {
  if (!input.sourceWorksiteId) throw new Error("Selecciona la bodega de origen")
  if (!input.workerId) throw new Error("Selecciona un trabajador")

  const items = normalizeItems(input.items)
  const deliveryId = nanoid()
  const now = new Date().toISOString()
  const today = todayInChile()

  /*
   * ENT-003 (auditoría 2026-09-14): la cota de retroactividad no puede vivir
   * sólo en el zod de la action. Este servicio lo llaman también la importación
   * y los scripts, y ya repite aquí las demás invariantes de negocio (producto
   * activo, cantidad entera de EPP, pertenencia a la faena). La fecha futura ya
   * la cubría el esquema; la fecha demasiado antigua no la cubría nadie.
   */
  if (input.deliveredAt && input.deliveredAt < earliestDeliveryDate(today)) {
    throw new Error(backdatedDeliveryMessage(today))
  }
  // La fecha civil retroactiva se ancla al mediodía UTC (08:00–09:00 en Chile):
  // con T00:00:00Z el timestamp cae en las 20:00 del día anterior chileno y
  // `formatDate` —que renderiza en America/Santiago— mostraría un día menos.
  // Si la fecha elegida es hoy se conserva `now`, para no perder la hora real ni
  // el orden intradía de las entregas del día.
  const deliveredAt = input.deliveredAt && input.deliveredAt !== today
    ? `${input.deliveredAt}T12:00:00.000Z`
    : now
  /*
   * ENT-003: el desfase entre el hecho y su registro tiene que quedar escrito.
   * Antes la fila sólo guardaba `deliveredAt` y nada explicaba por qué una
   * entrega de hace dos meses aparecía hoy —ni en la auditoría ni en la
   * acreditación PDTP que cuelga de esa misma fecha—.
   */
  const backdatedDays = input.deliveredAt && input.deliveredAt !== today
    ? Math.round((Date.parse(`${today}T12:00:00.000Z`) - Date.parse(`${input.deliveredAt}T12:00:00.000Z`)) / 86_400_000)
    : 0
  const year = codeYear()

  let deliveredEpp = false
  let proofStoragePath: string | undefined
  let inTransitWarning: string | null = null

  await db.transaction(async (tx) => {
    const [sourceWorksite, worker] = await Promise.all([
      tx.query.worksites.findFirst({ where: eq(worksites.id, input.sourceWorksiteId) }),
      tx.query.workers.findFirst({ where: eq(workers.id, input.workerId) }),
    ])

    if (!sourceWorksite || !sourceWorksite.isActive) throw new Error("Bodega de origen no disponible")
    if (!worker || !worker.isActive) throw new Error("Trabajador no disponible")
    if (worksiteIds !== "all" && (
      !worksiteIds.includes(sourceWorksite.id) || !worksiteIds.includes(worker.worksiteId)
    )) {
      throw new Error("No tienes acceso a la bodega o faena de esta entrega")
    }
    if (worker.worksiteId !== sourceWorksite.id) {
      throw new Error("El trabajador no pertenece a la faena seleccionada")
    }

    const targetWorksite = sourceWorksite

    const code = await nextCodeTx(tx, "ENT", year)
    const workerName = `${worker.firstName} ${worker.lastName}`.trim()
    const receiverName = input.receiverName?.trim() || workerName
    const notes = input.notes?.trim() || null

    await tx.insert(deliveries).values({
      id: deliveryId,
      code,
      deliveredBy: input.deliveredBy,
      deliveredAt,
      destinationType: "worker",
      sourceWorksiteId: sourceWorksite.id,
      worksiteId: targetWorksite.id,
      workerId: worker.id,
      receiverName,
      // Signature evidence is only preserved on historical records. New
      // deliveries do not collect or persist one.
      signaturePath: null,
      notes,
      createdAt: now,
    })

    const auditItems: Array<Record<string, unknown>> = []
    // GDI-002: se acumulan acá y se resuelven en UNA consulta después del
    // bucle, ya con las líneas escritas y el stock descontado.
    const inTransitCandidates: Array<{ productId: string; productName: string; quantity: number }> = []
    for (const item of items) {
      const product = await tx.query.products.findFirst({ where: eq(products.id, item.productId) })
      if (!product || !product.isActive) throw new Error("Producto no disponible")
      if (product.isService) throw new Error("Los servicios no se entregan desde bodega")
      if (product.isEpp && !Number.isInteger(item.quantity)) {
        throw new Error("Los EPP se entregan en cantidades enteras")
      }
      if (product.isEpp) deliveredEpp = true

      const traceableState = await getTraceableItemState(
        tx,
        item,
        worker.id,
        targetWorksite.id,
        sourceWorksite.id,
      )

      /*
       * ENT-002: la devolución del EPP usado se escribe en la misma línea del
       * EPP nuevo, que es donde `delivery_items` ya tiene las columnas y donde
       * la impresión del comprobante y la trazabilidad ya las leían. Hasta
       * ahora este `insert` —el único de la tabla— las dejaba siempre en NULL.
       */
      const returnQuantity = item.returnQuantity ?? null
      const returnProductId = returnQuantity ? item.returnProductId?.trim() || null : null
      const returnProductNameFree = returnQuantity ? item.returnProductNameFree?.trim() || null : null

      if (returnProductId) {
        const returnedProduct = await tx.query.products.findFirst({ where: eq(products.id, returnProductId) })
        if (!returnedProduct) throw new Error("El producto devuelto no existe en el catálogo")
      }

      await tx.insert(deliveryItems).values({
        id: nanoid(),
        deliveryId,
        requestItemId: traceableState?.requestItemId ?? null,
        productId: product.id,
        productNameFree: null,
        quantity: item.quantity,
        unitOfMeasure: product.unitOfMeasure,
        notes: item.notes?.trim() || null,
        returnQuantity,
        returnProductId,
        returnProductNameFree,
        returnReason: returnQuantity ? item.returnReason?.trim() || null : null,
        returnNotes: returnQuantity ? item.returnNotes?.trim() || null : null,
      })

      await applyMovementTx(tx, {
        worksiteId: sourceWorksite.id,
        productId: product.id,
        type: "egreso_entrega",
        quantity: -item.quantity,
        referenceType: "delivery",
        referenceId: deliveryId,
        performedBy: input.deliveredBy,
        userEmail: input.userEmail,
        reason: `Entrega ${code} a ${workerName}`,
        notes: notes ?? undefined,
      })

      /*
       * ENT-002: `retiro_epp_trabajador` estaba implementado en `applyMovementTx`
       * y contemplado en el detector de integridad, pero **ningún llamador lo
       * emitía**. Es el emisor que faltaba.
       *
       * No mueve saldo —la unidad original ya se descontó al entregarla— y por
       * eso el motor lo trata como movimiento de sólo auditoría: es la
       * evidencia de que el EPP usado volvió, no un ingreso a bodega. Sólo se
       * emite con producto catalogado: el kardex se lleva por `productId`, y un
       * nombre libre no tiene fila donde anotarse.
       */
      if (returnQuantity && returnProductId) {
        await applyMovementTx(tx, {
          worksiteId: sourceWorksite.id,
          productId: returnProductId,
          type: "retiro_epp_trabajador",
          quantity: returnQuantity,
          referenceType: "delivery",
          referenceId: deliveryId,
          performedBy: input.deliveredBy,
          userEmail: input.userEmail,
          reason: `Retiro de EPP usado en entrega ${code} a ${workerName}`,
          notes: item.returnReason?.trim() || undefined,
        })
      }

      if (traceableState) {
        await deliverItemTx(tx, traceableState.requestItemId, input.deliveredBy, {
          userEmail: input.userEmail,
          deliveredQuantity: item.quantity,
          totalDelivered: traceableState.totalDelivered,
        })
      }

      inTransitCandidates.push({ productId: product.id, productName: product.name, quantity: item.quantity })

      auditItems.push({
        productId: product.id,
        quantity: item.quantity,
        requestItemId: traceableState?.requestItemId ?? null,
        ...(returnQuantity
          ? {
            devolucion: {
              productId: returnProductId,
              productNameFree: returnProductNameFree,
              quantity: returnQuantity,
              reason: item.returnReason?.trim() || null,
            },
          }
          : {}),
      })
    }

    /*
     * GDI-002: la faena "tiene" lo despachado desde el despacho, no desde el
     * cotejo, así que `worksite_stock` —y con él `applyMovementTx`, que es
     * quien autoriza este egreso— cuenta como disponible mercadería que
     * todavía viaja en un camión. Acá se calcula cuánto de lo entregado se
     * apoya en ese saldo que aún no llega.
     *
     * Se lee DENTRO de la misma transacción: el saldo con el que se compara es
     * el que este egreso acaba de dejar, no una foto anterior.
     */
    const inTransitByProduct = await readInTransitToWorksite(
      tx,
      sourceWorksite.id,
      inTransitCandidates.map((candidate) => candidate.productId),
    )
    if (inTransitByProduct.size > 0) {
      const stockRows = await tx
        .select({ productId: worksiteStock.productId, quantity: worksiteStock.quantity })
        .from(worksiteStock)
        .where(and(
          eq(worksiteStock.worksiteId, sourceWorksite.id),
          inArray(worksiteStock.productId, [...inTransitByProduct.keys()]),
        ))
      const onHandByProduct = new Map(stockRows.map((row) => [row.productId, Number(row.quantity ?? 0)]))
      const lines: InTransitDeliveryLine[] = inTransitCandidates.flatMap((candidate) => {
        const inTransit = inTransitByProduct.get(candidate.productId) ?? 0
        if (inTransit <= 0) return []
        // El saldo ya viene descontado por este mismo egreso; se le vuelve a
        // sumar para razonar sobre el saldo del que salió la entrega.
        const onHand = (onHandByProduct.get(candidate.productId) ?? 0) + candidate.quantity
        return [{ productName: candidate.productName, quantity: candidate.quantity, onHand, inTransit }]
      })
      inTransitWarning = inTransitDeliveryWarning(lines)
    }

    if (input.proofAttachment) {
      const filePath = input.proofAttachment.filePath
      await tx.insert(attachments).values({
        id: nanoid(),
        entityType: "delivery",
        entityId: deliveryId,
        fileName: input.proofAttachment.fileName,
        filePath,
        fileSize: input.proofAttachment.fileSize,
        mimeType: input.proofAttachment.mimeType,
        uploadedBy: input.deliveredBy,
        uploadedAt: now,
      })
      proofStoragePath = filePath
    }

    await recordAudit({
      userId: input.deliveredBy,
      userEmail: input.userEmail,
      action: "create",
      entityType: "delivery",
      entityId: deliveryId,
      entityCode: code,
      newState: {
        sourceWorksiteId: sourceWorksite.id,
        worksiteId: targetWorksite.id,
        workerId: worker.id,
        receiverName,
        items: auditItems,
        proofFileName: input.proofAttachment?.fileName ?? null,
        deliveredAt,
        // GDI-002: si la entrega se apoyó en mercadería que todavía viaja, eso
        // queda escrito. El detector `DELIVERY_BEFORE_FAENA_RECEIPT` lo veía
        // después; acá queda dicho en el momento y con la cifra.
        ...(inTransitWarning ? { entregadoConStockEnTransito: inTransitWarning } : {}),
        ...(backdatedDays > 0
          ? { registradaEl: now, diasDeRetroactividad: backdatedDays }
          : {}),
      },
    }, tx)
  })

  // N°62 del PDTP. Va fuera de la transacción y no propaga: la entrega ya está
  // registrada y `recordPdtpFulfillmentEvent` deja el intento en el libro
  // durable para que el reconciliador lo retome.
  //
  // El conector vivía en `deliveries-worker-epp.ts`, un servicio sin llamador,
  // así que la actividad nunca acreditó. `worksiteId` es la faena de origen: el
  // servicio ya exige que el trabajador pertenezca a ella, así que es también
  // la faena de la persona equipada.
  if (deliveredEpp) {
    await onEppDeliveryCompleted({
      deliveryId,
      worksiteId: input.sourceWorksiteId,
      deliveredAt,
      workerCount: 1,
      activityNumbers: [PDTP_EPP_DELIVERY_ACTIVITY_NUMBER],
      // Sin un artefacto real, el motor marca la ejecución
      // `evidenceStatus: "not_required"` y la N°62 —"dejar documentada su
      // entrega"— quedaría acreditada sin documento.
      evidenceRef: proofStoragePath ?? undefined,
    })
  }

  if (inTransitWarning) options.onInTransitWarning?.(inTransitWarning)

  return deliveryId
}
