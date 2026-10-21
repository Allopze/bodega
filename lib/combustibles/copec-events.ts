import { createHash } from "node:crypto"
import { plateMatchKey } from "./xlsx-utils"
import { withoutPersonalData } from "./meter-readings"
import type { ParsedCopecTransaction } from "./consumption-import"
import type { ProviderRowInput } from "./provider-validation"

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 32)
}

function guideToken(value: string): string {
  return digest(value.trim().toUpperCase().replace(/\s+/g, ""))
}

function eventSignature(transaction: ParsedCopecTransaction): string {
  return digest({
    sourceDate: transaction.sourceDate,
    occurredAt: transaction.occurredAt,
    plate: plateMatchKey(transaction.plate),
    cardNumber: transaction.cardNumber,
    product: transaction.product,
    liters: transaction.liters,
    unitPrice: transaction.unitPrice,
    amount: transaction.amount,
    station: transaction.station,
  })
}

function relatedPrefix(month: string, transaction: ParsedCopecTransaction): string {
  if (transaction.sourceRef?.trim()) return `${month}:${transaction.product}:guide:${guideToken(transaction.sourceRef)}:`
  return `${month}:${transaction.product}:date:${transaction.sourceDate}:plate:${plateMatchKey(transaction.plate)}:`
}

/** Stable synthetic identities; native Copec ids are intentionally not asserted as unique. */
export function buildCopecTransactionRows(
  from: string,
  to: string,
  product: "diesel" | "bluemax",
  transactions: ParsedCopecTransaction[],
  channel: "TCT" | "TAE" = "TCT",
): ProviderRowInput[] {
  const month = from.slice(0, 7)
  const occurrences = new Map<string, number>()
  return transactions.map((transaction) => {
    const signature = eventSignature(transaction)
    const prefix = relatedPrefix(month, transaction)
    const occurrenceKey = `${prefix}${signature}`
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1
    occurrences.set(occurrenceKey, occurrence)
    return {
      provider: "copec",
      accountKey: `${channel.toLowerCase()}:${product}`,
      sourceRowKey: `${prefix}sig:${signature}:${occurrence}`,
      externalId: null,
      documentNumber: transaction.sourceRef,
      occurredAt: transaction.occurredAt,
      sourceDate: transaction.sourceDate,
      plate: transaction.plate,
      product,
      quantity: transaction.liters,
      unitPrice: transaction.unitPrice,
      amount: transaction.amount,
      payload: withoutPersonalData(transaction.rawPayload),
      granularity: "transaction",
    }
  })
}

/**
 * A reused guide with different contents, or a no-guide event for the same
 * vehicle/day with changed contents, cannot safely be called a correction or a
 * second load. Keep it in review rather than replacing either observation.
 */
export function hasPossibleCopecCorrection(
  sourceRowKey: string,
  previous: Array<{ sourceRowKey: string }>,
): boolean {
  const marker = ":sig:"
  const markerIndex = sourceRowKey.lastIndexOf(marker)
  if (markerIndex < 0) return false
  const prefix = sourceRowKey.slice(0, markerIndex + 1)
  const signature = sourceRowKey.slice(markerIndex + marker.length).split(":")[0]
  return previous.some((row) => {
    const priorIndex = row.sourceRowKey.lastIndexOf(marker)
    if (priorIndex < 0 || row.sourceRowKey.slice(0, priorIndex + 1) !== prefix) return false
    return row.sourceRowKey.slice(priorIndex + marker.length).split(":")[0] !== signature
  })
}
