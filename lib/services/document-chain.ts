import { and, eq, inArray, ne, or } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  deliveries,
  deliveryItems,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  receiptItems,
  receipts,
  dispatchGuides,
} from "@/db/schema"
import { can, canAny } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"

/**
 * El expediente de un documento: la cadena solicitud → OC → recepción → entrega
 * a la que pertenece, resuelta desde cualquier eslabón.
 *
 * Existe porque los correlativos de cada libro son series independientes
 * (`next_document_code` abre una secuencia nativa por prefijo, ver
 * `lib/code-sequences.ts`): `OC-2026-0003` no se deriva de `SOL-0004` ni al
 * revés, y la separación entre ambas sólo crece porque no toda solicitud llega a
 * OC. Eso es correcto —cada libro tiene que poder contarse solo, sin huecos—
 * pero deja al lector sin forma de saber de dónde viene un documento mirando su
 * número. La respuesta es hacer el vínculo explícito, que es lo que resuelve
 * este servicio, y no acoplar las series.
 *
 * Un único resolvedor para los tres consumidores (migas en el detalle, detalle
 * de trazabilidad y búsqueda por código): la relación es N:M en casi cada salto
 * —una OC nace de ítems de varias solicitudes, una solicitud puede terminar en
 * varias OCs, una OC genera varias recepciones— y duplicar ese recorrido en cada
 * pantalla es la forma segura de que tres pantallas cuenten historias distintas.
 */

export const DOCUMENT_KINDS = ["request", "order", "receipt", "dispatchGuide", "delivery"] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export interface ChainDocument {
  kind:       DocumentKind
  id:         string
  code:       string
  href:       string
  /** Estado del documento, o su naturaleza cuando no tiene estado propio. */
  status:     string | null
  /** Fecha relevante del documento, en ISO. */
  at:         string | null
  worksiteId: string | null
  /** TR-08: la cadena documental no la exponía; una entrega anulada se veía
   *  como vigente. Las presentaciones la marcan como Anulada. */
  voided?:    boolean
}

export interface DocumentChain {
  requests:   ChainDocument[]
  orders:     ChainDocument[]
  receipts:   ChainDocument[]
  dispatchGuides: ChainDocument[]
  deliveries: ChainDocument[]
}

/** Desde dónde se pide la cadena. `item` es una línea de solicitud, no un documento. */
export type ChainAnchor =
  | { kind: DocumentKind; id: string }
  | { kind: "item"; id: string }

export const EMPTY_CHAIN: DocumentChain = { requests: [], orders: [], receipts: [], dispatchGuides: [], deliveries: [] }

/**
 * Techo por consulta. Una solicitud masiva puede tener cientos de líneas, y la
 * cadena es para leerla de un vistazo: si alguna vez topa, es señal de que esa
 * pantalla necesita un listado, no una miga más larga.
 */
const MAX_ROWS = 200

export function isChainEmpty(chain: DocumentChain): boolean {
  return chain.requests.length === 0
    && chain.orders.length === 0
    && chain.receipts.length === 0
    && chain.dispatchGuides.length === 0
    && chain.deliveries.length === 0
}

/** Todos los documentos de la cadena en orden de flujo. */
export function chainDocuments(chain: DocumentChain): ChainDocument[] {
  return [...chain.requests, ...chain.orders, ...chain.receipts, ...chain.dispatchGuides, ...chain.deliveries]
}

/**
 * Resuelve un código —de cualquier libro— al documento que lo lleva.
 *
 * Consulta los cuatro libros en paralelo en vez de despachar por prefijo: las
 * solicitudes no usan un prefijo único (`SOL` para bodega, pero `REP` para
 * repuestos y `SER` para servicios, ver `lib/services/repuestos.ts`), así que
 * cualquier tabla de prefijos nace incompleta y se rompe callada la próxima vez
 * que se agregue un tipo de solicitud. `code` es único e indexado en las cuatro.
 */
export async function findDocumentByCode(code: string): Promise<ChainAnchor | null> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null

  const [request, order, receipt, dispatchGuide, delivery] = await Promise.all([
    db.select({ id: purchaseRequests.id }).from(purchaseRequests).where(eq(purchaseRequests.code, normalized)).limit(1),
    db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.code, normalized)).limit(1),
    db.select({ id: receipts.id }).from(receipts).where(eq(receipts.code, normalized)).limit(1),
    db.select({ id: dispatchGuides.id }).from(dispatchGuides).where(eq(dispatchGuides.code, normalized)).limit(1),
    db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.code, normalized)).limit(1),
  ])

  if (request[0]) return { kind: "request",  id: request[0].id }
  if (order[0])   return { kind: "order",    id: order[0].id }
  if (receipt[0]) return { kind: "receipt",  id: receipt[0].id }
  if (dispatchGuide[0]) return { kind: "dispatchGuide", id: dispatchGuide[0].id }
  if (delivery[0]) return { kind: "delivery", id: delivery[0].id }
  return null
}

/**
 * Punto de partida: las líneas de solicitud y las OC que el ancla toca.
 *
 * Se parte de las líneas y no de los documentos porque la línea es lo único que
 * viaja por todo el flujo: es la que la OC referencia (`requestItemId`) y la que
 * la entrega referencia. Las recepciones son la excepción —cuelgan de la OC, no
 * de la línea—, por eso también se arrastran los ids de orden.
 */
async function seedFromAnchor(anchor: ChainAnchor): Promise<{ itemIds: string[]; orderIds: string[]; guideIds: string[] }> {
  switch (anchor.kind) {
    case "item":
      return { itemIds: [anchor.id], orderIds: [], guideIds: [] }

    case "request": {
      const rows = await db
        .select({ id: purchaseRequestItems.id })
        .from(purchaseRequestItems)
        .where(eq(purchaseRequestItems.requestId, anchor.id))
        .limit(MAX_ROWS)
      return { itemIds: rows.map((row) => row.id), orderIds: [], guideIds: [] }
    }

    case "order": {
      const rows = await db
        .select({ requestItemId: purchaseOrderItems.requestItemId })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, anchor.id))
        .limit(MAX_ROWS)
      // `requestItemId` es nulo en una OC creada sin solicitud previa: la cadena
      // arranca en la propia orden y sigue hacia sus recepciones.
      return {
        itemIds:  rows.flatMap((row) => (row.requestItemId ? [row.requestItemId] : [])),
        orderIds: [anchor.id],
        guideIds: [],
      }
    }

    case "receipt": {
      const rows = await db
        .select({
          orderId:       purchaseOrderItems.purchaseOrderId,
          requestItemId: purchaseOrderItems.requestItemId,
        })
        .from(receiptItems)
        .innerJoin(purchaseOrderItems, eq(purchaseOrderItems.id, receiptItems.purchaseOrderItemId))
        .where(eq(receiptItems.receiptId, anchor.id))
        .limit(MAX_ROWS)
      return {
        itemIds:  rows.flatMap((row) => (row.requestItemId ? [row.requestItemId] : [])),
        orderIds: rows.map((row) => row.orderId),
        guideIds: [],
      }
    }

    case "delivery": {
      const rows = await db
        .select({ requestItemId: deliveryItems.requestItemId })
        .from(deliveryItems)
        .where(eq(deliveryItems.deliveryId, anchor.id))
        .limit(MAX_ROWS)
      return {
        itemIds:  rows.flatMap((row) => (row.requestItemId ? [row.requestItemId] : [])),
        orderIds: [],
        guideIds: [],
      }
    }

    case "dispatchGuide": {
      const [guide] = await db
        .select({ id: dispatchGuides.id, purchaseOrderId: dispatchGuides.purchaseOrderId })
        .from(dispatchGuides)
        .where(eq(dispatchGuides.id, anchor.id))
        .limit(1)
      if (!guide) return { itemIds: [], orderIds: [], guideIds: [anchor.id] }
      const rows = guide.purchaseOrderId
        ? await db.select({ requestItemId: purchaseOrderItems.requestItemId })
            .from(purchaseOrderItems)
            .where(eq(purchaseOrderItems.purchaseOrderId, guide.purchaseOrderId))
            .limit(MAX_ROWS)
        : []
      return {
        itemIds: rows.flatMap((row) => row.requestItemId ? [row.requestItemId] : []),
        orderIds: guide.purchaseOrderId ? [guide.purchaseOrderId] : [],
        guideIds: [anchor.id],
      }
    }
  }
}

/** Deduplica por id conservando el orden de llegada. */
function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * Construye el expediente completo desde cualquier eslabón.
 *
 * Un documento que el usuario no puede abrir NO se devuelve, en vez de
 * devolverse sin enlace: mostrar "existe OC-2026-0003" a alguien sin acceso a
 * compras filtra información de negocio por la puerta de atrás, y una miga que
 * lleva a un 403 es peor que no mostrarla. El alcance de faena se aplica igual,
 * documento por documento.
 */
export async function getDocumentChain(session: Session, anchor: ChainAnchor): Promise<DocumentChain> {
  const seed = await seedFromAnchor(anchor)
  const itemIds = unique(seed.itemIds)

  // `view_own` es el gate del módulo, no una licencia para ver todo: quien sólo
  // lo tiene ve únicamente las solicitudes que pidió, igual que en el listado y
  // en el detalle. La cadena parte de una OC que mezcla líneas de varias
  // solicitudes, así que sin este filtro la miga entregaba el código, el estado
  // y la fecha de la solicitud de un compañero.
  const canSeeRequests    = canAny(session, "requests:view_own", "requests:view_all")
  const canSeeAllRequests = can(session, "requests:view_all")
  // Mismo criterio que el detalle de la OC: quien puede ver su recepción puede
  // ver la orden de la que cuelga, salvo mientras es borrador.
  const canSeeOrders      = canAny(session, "purchasing:view", "receiving:view")
  const canSeeDraftOrders = can(session, "purchasing:view")
  const canSeeReceipts    = can(session, "receiving:view")
  const canSeeGuides      = can(session, "warehouse:view_guides")
  const canSeeDeliveries  = can(session, "deliveries:view")

  // ARQ-10: las 3 consultas de este primer nivel sólo dependen de `itemIds` —
  // ninguna espera el resultado de otra, así que corren en paralelo en vez de
  // en 3 round-trips secuenciales.
  const [requestRows, orderIdRows, deliveryRows] = await Promise.all([
    // ── Solicitudes de esas líneas ────────────────────────────────────────────
    canSeeRequests && itemIds.length > 0
      ? db
          .select({
            id:          purchaseRequests.id,
            code:        purchaseRequests.code,
            status:      purchaseRequests.status,
            worksiteId:  purchaseRequests.worksiteId,
            createdAt:   purchaseRequests.createdAt,
            submittedAt: purchaseRequests.submittedAt,
          })
          .from(purchaseRequestItems)
          .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
          .where(and(
            inArray(purchaseRequestItems.id, itemIds),
            canSeeAllRequests ? undefined : eq(purchaseRequests.requesterId, session.user.id),
          ))
          .limit(MAX_ROWS)
      : Promise.resolve([]),

    // ── Órdenes de esas líneas, más la del ancla si venía de una ──────────────
    itemIds.length > 0
      ? db
          .select({ purchaseOrderId: purchaseOrderItems.purchaseOrderId })
          .from(purchaseOrderItems)
          .where(inArray(purchaseOrderItems.requestItemId, itemIds))
          .limit(MAX_ROWS)
      : Promise.resolve([]),

    // ── Entregas de esas líneas ────────────────────────────────────────────────
    canSeeDeliveries && itemIds.length > 0
      ? // TR-08 (auditoría 2026-09-05): la cadena seleccionaba estado, código y
        // fecha pero no `voidedAt`; una entrega anulada se mostraba como si
        // estuviera vigente con su destino. Se trae la marca para exponerla en
        // la tira y en los resultados.
        db
          .select({
            id:              deliveries.id,
            code:            deliveries.code,
            destinationType: deliveries.destinationType,
            worksiteId:      deliveries.worksiteId,
            deliveredAt:     deliveries.deliveredAt,
            voidedAt:        deliveries.voidedAt,
            voidReason:      deliveries.voidReason,
          })
          .from(deliveryItems)
          .innerJoin(deliveries, eq(deliveries.id, deliveryItems.deliveryId))
          .where(inArray(deliveryItems.requestItemId, itemIds))
          .limit(MAX_ROWS)
      : Promise.resolve([]),
  ])
  const orderIds = unique([...seed.orderIds, ...orderIdRows.map((row) => row.purchaseOrderId)])

  // Segundo nivel: ambas dependen de `orderIds` (recién resuelto arriba) pero
  // no una de la otra, así que también van en paralelo entre sí.
  const guidePredicates = [
    seed.guideIds.length > 0 ? inArray(dispatchGuides.id, seed.guideIds) : undefined,
    orderIds.length > 0 ? inArray(dispatchGuides.purchaseOrderId, orderIds) : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined)

  const [orderRows, receiptRows, guideRows] = await Promise.all([
    canSeeOrders && orderIds.length > 0
      ? db
          .select({
            id:         purchaseOrders.id,
            code:       purchaseOrders.code,
            status:     purchaseOrders.status,
            worksiteId: purchaseOrders.worksiteId,
            issuedAt:   purchaseOrders.issuedAt,
            createdAt:  purchaseOrders.createdAt,
          })
          .from(purchaseOrders)
          .where(
            // El borrador es la OC que todavía se está armando: el detalle se lo
            // niega a quien sólo tiene `receiving:view`, así que la tira tampoco
            // se lo ofrece — un chip que lleva a un 404 es peor que no estar.
            and(
              inArray(purchaseOrders.id, orderIds),
              canSeeDraftOrders ? undefined : ne(purchaseOrders.status, "draft"),
            ),
          )
          .limit(MAX_ROWS)
      : Promise.resolve([]),

    // Las recepciones cuelgan de la OC y no de la línea, así que se traen
    // todas las de la orden: la llegada de una OC es parte de la historia de
    // cualquier ítem que la integre, aunque la orden mezcle ítems de varias
    // solicitudes.
    canSeeReceipts && orderIds.length > 0
      ? db
          .select({
            id:              receipts.id,
            code:            receipts.code,
            locationType:    receipts.locationType,
            worksiteId:      receipts.worksiteId,
            receivedAt:      receipts.receivedAt,
            purchaseOrderId: receipts.purchaseOrderId,
          })
          .from(receipts)
          .where(inArray(receipts.purchaseOrderId, orderIds))
          .limit(MAX_ROWS)
      : Promise.resolve([]),

    canSeeGuides && guidePredicates.length > 0
      ? db
          .select({
            id: dispatchGuides.id,
            code: dispatchGuides.code,
            status: dispatchGuides.status,
            worksiteId: dispatchGuides.destinationWorksiteId,
            issuedAt: dispatchGuides.issuedAt,
          })
          .from(dispatchGuides)
          .where(or(...guidePredicates))
          .limit(MAX_ROWS)
      : Promise.resolve([]),
  ])

  // La faena de una recepción es opcional en el esquema; cuando falta manda la
  // de su orden, que es la que decide quién puede verla.
  const orderWorksite = new Map(orderRows.map((row) => [row.id, row.worksiteId]))

  // OP-07 (auditoría 2026-09-05): un `worksiteId` nulo se considera visible
  // para quien tiene el permiso del libro. Es la decisión documentada: una
  // recepción o entrega histórica sin faena no tiene otra faena a la que
  // atribuirse, así que mostrarla a un rol con permiso de ver ese libro no
  // filtra datos de una faena ajena. El alcance sí se aplica línea a línea
  // cuando la faena existe (nível inferior, TR-09).
  const inScope = (worksiteId: string | null) =>
    worksiteId === null || canAccessWorksite(session, worksiteId)

  function collect(rows: ChainDocument[]): ChainDocument[] {
    const byId = new Map<string, ChainDocument>()
    for (const row of rows) {
      if (!inScope(row.worksiteId)) continue
      if (!byId.has(row.id)) byId.set(row.id, row)
    }
    return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code))
  }

  const chain: DocumentChain = {
    requests: collect(requestRows.map((row) => ({
      kind: "request" as const,
      id: row.id,
      code: row.code,
      href: `/solicitudes/${row.id}`,
      status: row.status,
      at: row.submittedAt ?? row.createdAt,
      worksiteId: row.worksiteId,
    }))),
    orders: collect(orderRows.map((row) => ({
      kind: "order" as const,
      id: row.id,
      code: row.code,
      href: `/compras/${row.id}`,
      status: row.status,
      at: row.issuedAt ?? row.createdAt,
      worksiteId: row.worksiteId,
    }))),
    receipts: collect(receiptRows.map((row) => ({
      kind: "receipt" as const,
      id: row.id,
      code: row.code,
      href: `/recepcion/${row.id}`,
      status: row.locationType,
      at: row.receivedAt,
      worksiteId: row.worksiteId ?? orderWorksite.get(row.purchaseOrderId) ?? null,
    }))),
    dispatchGuides: collect(guideRows.map((row) => ({
      kind: "dispatchGuide" as const,
      id: row.id,
      code: row.code,
      href: `/bodega/guias/${row.id}`,
      status: row.status,
      at: row.issuedAt,
      worksiteId: row.worksiteId,
    }))),
    deliveries: collect(deliveryRows.map((row) => ({
      kind: "delivery" as const,
      id: row.id,
      // No existe pantalla de detalle de entrega: el comprobante imprimible es
      // la vista canónica, y es a donde enlaza también el listado de entregas.
      href: `/entregas/${row.id}/print`,
      code: row.code,
      status: row.destinationType,
      at: row.deliveredAt,
      worksiteId: row.worksiteId,
      // TR-08: la marca de anulación viaja ahora en la fila y se expone en la
      // tira; una entrega anulada ya no se confunde con una vigente.
      voided: row.voidedAt != null,
    }))),
  }

  // TR-01 (auditoría 2026-09-05): una entrega válida sin solicitud —salida
  // libre de stock— se perdía de la búsqueda por código. Su ancla tiene todos
  // los `requestItemId` nulos, así que `seedFromAnchor` devolvía `itemIds`
  // vacíos y la cadena quedaba vacía ("no encontrado") aunque la entrega
  // existiera y el usuario tuviera permiso. El ancla siempre se incluye en su
  // propio libro, respetando permisos y alcance.
  if (anchor.kind === "delivery") {
    const exists = chain.deliveries.some((doc) => doc.id === anchor.id)
    if (!exists && canSeeDeliveries) {
      const [anchorDelivery] = await db
        .select({
          id: deliveries.id,
          code: deliveries.code,
          destinationType: deliveries.destinationType,
          worksiteId: deliveries.worksiteId,
          deliveredAt: deliveries.deliveredAt,
          voidedAt: deliveries.voidedAt,
          voidReason: deliveries.voidReason,
        })
        .from(deliveries)
        .where(eq(deliveries.id, anchor.id))
        .limit(1)
      if (anchorDelivery && inScope(anchorDelivery.worksiteId)) {
        chain.deliveries = [{
          kind: "delivery" as const,
          id: anchorDelivery.id,
          href: `/entregas/${anchorDelivery.id}/print`,
          code: anchorDelivery.code,
          status: anchorDelivery.destinationType,
          at: anchorDelivery.deliveredAt,
          worksiteId: anchorDelivery.worksiteId,
          voided: anchorDelivery.voidedAt != null,
        }, ...chain.deliveries]
      }
    }
  }

  return chain
}

/** Atajo: resuelve un código y devuelve su cadena en una sola llamada. */
export async function getDocumentChainByCode(
  session: Session,
  code: string,
): Promise<{ anchor: ChainAnchor; chain: DocumentChain } | null> {
  const anchor = await findDocumentByCode(code)
  if (!anchor) return null
  const chain = await getDocumentChain(session, anchor)
  // El alcance de faena puede dejar la cadena vacía aunque el código exista: se
  // trata igual que "no encontrado" para no confirmar la existencia de un
  // documento de otra faena.
  return isChainEmpty(chain) ? null : { anchor, chain }
}
