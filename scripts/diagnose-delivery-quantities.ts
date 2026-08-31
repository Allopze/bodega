import { eq, inArray, notInArray, sql } from "drizzle-orm"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { db } from "@/db"
import {
  deliveries,
  deliveryItems,
  products,
  purchaseOrderItems,
  purchaseRequestItems,
  purchaseRequests,
  workers,
  worksites,
} from "@/db/schema"
import { TERMINAL_REQUEST_STATUSES } from "@/lib/approvals-queue"
import { getTraceableDeliveryBalance } from "@/lib/services/delivery-eligibility"
import { formatQty, quantityStep } from "@/lib/utils"

/**
 * Dos daños del mismo formulario de entregas, ambos de sólo lectura.
 *
 * 1. **Cantidades ×100 más chicas.** El campo tenía `min="0.01" step="0.01"`
 *    sobre un campo vacío: cada clic de la flecha sumaba un centésimo, así que
 *    seis clics para seis buzos registraron 0,06. Descontó stock por
 *    centésimos y dejó el papel de la entrega mintiendo.
 *
 * 2. **Líneas sin imputar a la solicitud.** Sin `requestItemId` no corre
 *    `deliverItemTx`: el ítem se queda en `received` y su solicitud no puede
 *    llegar nunca a `closed` —exige que todos sus ítems terminen `delivered` o
 *    `rejected`—, así que "Entregar …" y "Revisar solicitud" quedan en
 *    /pendientes para siempre.
 *
 * Las dos causas ya están cerradas en el código (`quantityStep` y el guardia de
 * `registerWorkerStockDelivery`). Lo que queda es el histórico, y **no se
 * corrige acá**: la cantidad que de verdad se entregó la sabe quien la entregó,
 * y multiplicar por 100 a ciegas fabricaría movimientos de kardex que nadie
 * hizo. Este script dice qué hay que rehacer y con qué cifra probable.
 */

export interface SuspectDeliveryLine {
  deliveryCode:   string
  deliveredAt:    string
  worksiteName:   string
  workerName:     string
  productName:    string
  unitOfMeasure:  string
  recordedQty:    number
  /** Cifra que el operador quiso escribir, si el registrado es su centésimo exacto. */
  inferredQty:    number | null
  linkedToRequest: boolean
}

export interface StrandedRequestItem {
  requestCode:    string
  requestStatus:  string
  worksiteName:   string
  productName:    string
  unitOfMeasure:  string
  requestedQty:   number
  receivedQty:    number
  deliveredQty:   number
  pendingQty:     number
}

/**
 * Líneas de entrega con cantidad fraccionaria sobre una unidad contable. La
 * unidad manda: 0,5 litros es legítimo, 0,06 buzos no.
 */
export async function findSuspectDeliveryLines(): Promise<SuspectDeliveryLine[]> {
  const rows = await db.select({
    deliveryCode:  deliveries.code,
    deliveredAt:   deliveries.deliveredAt,
    worksiteName:  worksites.name,
    workerFirst:   workers.firstName,
    workerLast:    workers.lastName,
    productName:   products.name,
    unitOfMeasure: deliveryItems.unitOfMeasure,
    recordedQty:   deliveryItems.quantity,
    requestItemId: deliveryItems.requestItemId,
  })
    .from(deliveryItems)
    .innerJoin(deliveries, eq(deliveries.id, deliveryItems.deliveryId))
    .leftJoin(worksites, eq(worksites.id, deliveries.worksiteId))
    .leftJoin(workers, eq(workers.id, deliveries.workerId))
    .leftJoin(products, eq(products.id, deliveryItems.productId))
    .where(sql`${deliveryItems.quantity} <> round(${deliveryItems.quantity}::numeric)`)
    .orderBy(deliveries.deliveredAt, deliveries.code)

  return rows
    .filter((row) => quantityStep(row.unitOfMeasure) === 1)
    .map((row) => {
      // El daño observado es exactamente ×100: 0,06 son 6 clics de 0,01 desde
      // vacío. Sólo se propone cuando el centésimo cuadra exacto; cualquier
      // otra fracción se reporta sin sugerencia, para que la revise una persona.
      const scaled = Math.round(row.recordedQty * 100)
      const exact = Math.abs(scaled - row.recordedQty * 100) < 1e-6
      return {
        deliveryCode:    row.deliveryCode,
        deliveredAt:     row.deliveredAt.slice(0, 10),
        worksiteName:    row.worksiteName ?? "—",
        workerName:      [row.workerFirst, row.workerLast].filter(Boolean).join(" ") || "—",
        productName:     row.productName ?? "(sin producto de catálogo)",
        unitOfMeasure:   row.unitOfMeasure,
        recordedQty:     row.recordedQty,
        inferredQty:     exact && scaled > 0 ? scaled : null,
        linkedToRequest: row.requestItemId !== null,
      }
    })
}

/**
 * Ítems recibidos en faena que nadie terminó de entregar. Cada uno bloquea el
 * cierre de su solicitud y sostiene dos filas en /pendientes: la de "Entregar"
 * y la de "Revisar solicitud".
 */
export async function findStrandedRequestItems(): Promise<StrandedRequestItem[]> {
  const rows = await db.select({
    requestCode:   purchaseRequests.code,
    requestStatus: purchaseRequests.status,
    worksiteName:  worksites.name,
    productName:   products.name,
    productFree:   purchaseRequestItems.productNameFree,
    unitOfMeasure: purchaseRequestItems.unitOfMeasure,
    requestedQty:  purchaseRequestItems.quantity,
    receivedQty:   sql<number>`coalesce((
      SELECT sum(${purchaseOrderItems.quantityReceived}) FROM ${purchaseOrderItems}
      WHERE ${purchaseOrderItems.requestItemId} = ${purchaseRequestItems.id}
    ), 0)`,
    deliveredQty:  sql<number>`coalesce((
      SELECT sum(${deliveryItems.quantity}) FROM ${deliveryItems}
      WHERE ${deliveryItems.requestItemId} = ${purchaseRequestItems.id}
    ), 0)`,
  })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
    .innerJoin(worksites, eq(worksites.id, purchaseRequests.worksiteId))
    .leftJoin(products, eq(products.id, purchaseRequestItems.productId))
    .where(sql`${notInArray(purchaseRequests.status, [...TERMINAL_REQUEST_STATUSES])}
      AND ${inArray(purchaseRequestItems.status, ["partially_received", "received", "partially_delivered"])}`)
    .orderBy(purchaseRequests.code)

  return rows
    .map((row) => ({
      requestCode:   row.requestCode,
      requestStatus: row.requestStatus,
      worksiteName:  row.worksiteName,
      productName:   row.productName ?? row.productFree ?? "(sin nombre)",
      unitOfMeasure: row.unitOfMeasure,
      requestedQty:  row.requestedQty,
      receivedQty:   Number(row.receivedQty ?? 0),
      deliveredQty:  Number(row.deliveredQty ?? 0),
      pendingQty:    getTraceableDeliveryBalance({
        requestedQuantity: row.requestedQty,
        receivedAtFaena:   Number(row.receivedQty ?? 0),
        deliveredQuantity: Number(row.deliveredQty ?? 0),
      }),
    }))
    .filter((row) => row.pendingQty > 0)
}

async function main() {
  const [suspect, stranded] = await Promise.all([
    findSuspectDeliveryLines(),
    findStrandedRequestItems(),
  ])

  console.log("\n── Entregas con cantidad sospechosa ──────────────────────────")
  if (suspect.length === 0) {
    console.log("Ninguna: toda línea sobre unidad contable tiene cantidad entera.")
  } else {
    console.log(`${suspect.length} línea(s) registran una fracción de una unidad que se cuenta entera.\n`)
    for (const line of suspect) {
      const propuesta = line.inferredQty === null
        ? "revisar a mano"
        : `probablemente ${formatQty(line.inferredQty, line.unitOfMeasure)}`
      console.log(
        `  ${line.deliveryCode}  ${line.deliveredAt}  ${line.worksiteName}\n` +
        `    ${line.productName}\n` +
        `    registrado ${formatQty(line.recordedQty, line.unitOfMeasure)} → ${propuesta}` +
        `${line.linkedToRequest ? "" : "  · sin imputar a solicitud"}\n` +
        `    recibió: ${line.workerName}`,
      )
    }
    console.log(
      "\n  Cada una descontó del stock sólo la fracción registrada, así que el saldo\n" +
      "  de bodega está sobrestimado en la diferencia. Confirma con quien entregó\n" +
      "  cuánto salió de verdad antes de tocar nada: la app no tiene anulación de\n" +
      "  entregas, y reescribir la cantidad sin su movimiento compensatorio dejaría\n" +
      "  el kardex mintiendo en el otro sentido.",
    )
  }

  console.log("\n── Ítems recibidos sin terminar de entregar ──────────────────")
  if (stranded.length === 0) {
    console.log("Ninguno: no hay solicitudes bloqueadas por una entrega a medias.")
  } else {
    const requests = new Set(stranded.map((row) => row.requestCode))
    console.log(
      `${stranded.length} ítem(s) en ${requests.size} solicitud(es). Ninguna puede llegar a\n` +
      `"cerrada" mientras le quede uno: exige que todos sus ítems terminen entregados\n` +
      `o rechazados. Sostienen ${stranded.length + requests.size} filas en /pendientes.\n`,
    )
    for (const row of stranded) {
      console.log(
        `  ${row.requestCode.padEnd(10)} ${row.worksiteName}\n` +
        `    ${row.productName}\n` +
        `    pedido ${formatQty(row.requestedQty, row.unitOfMeasure)}` +
        ` · recibido en faena ${formatQty(row.receivedQty, row.unitOfMeasure)}` +
        ` · entregado ${formatQty(row.deliveredQty, row.unitOfMeasure)}` +
        ` · falta ${formatQty(row.pendingQty, row.unitOfMeasure)}`,
      )
    }
    console.log(
      "\n  Se sacan de la cola registrando su entrega en /entregas e imputándola a la\n" +
      "  solicitud. Desde el arreglo del formulario esa imputación es obligatoria\n" +
      "  cuando existe, así que no vuelve a pasar.",
    )
  }
  console.log("")
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
