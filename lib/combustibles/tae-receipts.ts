/**
 * Ingesta del informe TAE de Copec como recepciones del ciclo físico.
 *
 * Cada fila del informe es una carga de una vasija propia en estación de servicio,
 * es decir combustible ENTRANDO al circuito de la faena. Se traduce a un
 * `fuel_cycle_movements` de tipo `received`, que es la fuente canónica de la etapa
 * contra la que se compara lo que la PWA reparte.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { fuelCycleMovements, fuelStorageLocations } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import type { ParsedTaeReceiptRow } from "./tae-receipt-import"

/** Sembrado en `db/seed-combustibles.ts`. */
const COPEC_SUPPLIER_ID = "fs-copec"
export const TAE_RECEIPT_SOURCE = "copec_tae"

export interface TaeReceiptImportOutcome {
  inserted: number
  /** Guías ya presentes: reimportar un mes es seguro y no duplica. */
  duplicates: number
  /** Tarjetas sin vasija asociada. No se inventa un destino: la recepción se
   *  omite y queda reportada para que operación cree/enlace el estanque. */
  unmappedCards: string[]
  unmappedLiters: number
}

function cardKey(cardNumber: string, productId: string) {
  return `${cardNumber}::${productId}`
}

export async function importTaeReceipts(rows: ParsedTaeReceiptRow[], importerId: string): Promise<TaeReceiptImportOutcome> {
  const empty: TaeReceiptImportOutcome = { inserted: 0, duplicates: 0, unmappedCards: [], unmappedLiters: 0 }
  if (!rows.length) return empty

  const cards = [...new Set(rows.map((row) => row.cardNumber))]
  const locations = await db.query.fuelStorageLocations.findMany({
    where: and(
      inArray(fuelStorageLocations.taeCardNumber, cards),
      isNotNull(fuelStorageLocations.taeCardNumber),
      eq(fuelStorageLocations.isActive, true),
    ),
    columns: { id: true, worksiteId: true, productId: true, taeCardNumber: true },
  })
  const byCard = new Map(locations.map((location) => [cardKey(location.taeCardNumber!, location.productId), location]))

  const unmapped = new Map<string, number>()
  const values: (typeof fuelCycleMovements.$inferInsert)[] = []
  for (const row of rows) {
    const location = byCard.get(cardKey(row.cardNumber, row.productId))
    if (!location) {
      unmapped.set(row.cardNumber, (unmapped.get(row.cardNumber) ?? 0) + row.liters)
      continue
    }
    values.push({
      id: nanoid(),
      eventType: "received" as const,
      worksiteId: location.worksiteId,
      productId: row.productId,
      quantity: row.liters,
      occurredAt: row.occurredAt,
      supplierId: COPEC_SUPPLIER_ID,
      targetLocationId: location.id,
      documentNumber: row.documentNumber,
      sourceType: TAE_RECEIPT_SOURCE,
      sourceId: row.documentNumber,
      notes: row.station || null,
      createdBy: importerId,
    })
  }

  const outcome: TaeReceiptImportOutcome = {
    ...empty,
    unmappedCards: [...unmapped.keys()].sort(),
    unmappedLiters: [...unmapped.values()].reduce((total, liters) => total + liters, 0),
  }
  if (!values.length) return outcome

  // El índice único parcial sobre (source_type, source_id) hace la idempotencia:
  // una guía ya cargada no se vuelve a insertar aunque se reimporte el período.
  const inserted = await db.transaction(async (tx) => {
    const created = await tx.insert(fuelCycleMovements).values(values).onConflictDoNothing().returning({ id: fuelCycleMovements.id })
    if (created.length) {
      await recordAudit({
        userId: importerId,
        action: "create",
        entityType: "fuel_cycle_movement_import",
        entityId: TAE_RECEIPT_SOURCE,
        newState: { received: created.length, liters: values.reduce((total, value) => total + value.quantity, 0) },
      }, tx)
    }
    return created.length
  })

  outcome.inserted = inserted
  outcome.duplicates = values.length - inserted
  return outcome
}
