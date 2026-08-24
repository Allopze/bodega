import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments, fuelProviderTransactions, fuelReconciliationLinks } from "@/db/schema"
import { nanoid } from "@/lib/id"

export interface FuelDteEvidence {
  id: string
  tipoDte: string
  rutEmisor: string
  montoTotal: number
}

export interface FuelDteTransactionEvidence {
  id: string
  supplierRut: string | null
  amount: number | null
}

export interface FuelDteGroupCandidate {
  transactionIds: string[]
  supplierRut: string | null
  totalAmount: number
}

export interface FuelDteGroupDecision {
  status: "matched" | "ambiguous" | "unmatched"
  transactionIds: string[]
  difference: number
  reason: string
}

const DTE_AMOUNT_TOLERANCE = 1

function normalizeRut(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9kK]/g, "").toUpperCase()
}

/** A DTE group may aggregate rows, but only from one known issuer. */
export function buildFuelDteGroupCandidate(
  transactions: FuelDteTransactionEvidence[],
): FuelDteGroupCandidate | null {
  if (transactions.length === 0) return null
  const normalizedRuts = transactions.map((transaction) => normalizeRut(transaction.supplierRut))
  if (normalizedRuts.some((rut) => !rut) || new Set(normalizedRuts).size !== 1) return null
  return {
    transactionIds: transactions.map((transaction) => transaction.id),
    supplierRut: transactions[0]?.supplierRut ?? null,
    totalAmount: transactions.reduce((sum, transaction) => sum + Number(transaction.amount ?? 0), 0),
  }
}

/**
 * DTE grouping is explicit: this function never searches by folio or picks a
 * transaction because its amount happens to match. Credit/debit notes remain
 * visible but require a human decision because their document semantics are
 * not equivalent to a positive fuel invoice.
 */
export function decideFuelDteGroup(
  dte: FuelDteEvidence,
  candidates: FuelDteGroupCandidate[],
  tolerance = DTE_AMOUNT_TOLERANCE,
): FuelDteGroupDecision {
  if (["56", "61"].includes(dte.tipoDte)) {
    return { status: "unmatched", transactionIds: [], difference: 0, reason: "NC/ND requiere decisión humana explícita" }
  }

  const sameSupplier = candidates.filter((candidate) => normalizeRut(candidate.supplierRut) === normalizeRut(dte.rutEmisor))
  const withinTolerance = sameSupplier.filter((candidate) => Math.abs(candidate.totalAmount - dte.montoTotal) <= tolerance)
  if (withinTolerance.length === 1) {
    const candidate = withinTolerance[0]!
    return {
      status: "matched",
      transactionIds: candidate.transactionIds,
      difference: candidate.totalAmount - dte.montoTotal,
      reason: "grupo explícito de transacciones dentro de tolerancia de monto",
    }
  }
  if (withinTolerance.length > 1) {
    return { status: "ambiguous", transactionIds: [], difference: 0, reason: "más de un grupo explícito coincide con el monto DTE" }
  }
  if (sameSupplier.length > 0) {
    const closest = sameSupplier[0]!
    return { status: "unmatched", transactionIds: [], difference: closest.totalAmount - dte.montoTotal, reason: "el grupo explícito no cuadra con el monto DTE" }
  }
  return { status: "unmatched", transactionIds: [], difference: 0, reason: "sin transacciones explícitas del mismo RUT emisor" }
}

/**
 * Persiste un vínculo DTE 1:N a partir de IDs elegidos por una revisión. El
 * caller debe entregar el grupo: no existe auto-match por folio. Las notas
 * 56/61 y diferencias quedan sin target para que el constraint las mantenga
 * como excepciones revisables, sin corromper `dte_documents.fuel_load_id`.
 */
export async function reconcileFuelTransactionsToDte(
  dteDocumentId: string,
  transactionIds: string[],
  tolerance = DTE_AMOUNT_TOLERANCE,
): Promise<FuelDteGroupDecision> {
  const ids = [...new Set(transactionIds)]
  if (ids.length === 0) throw new Error("El grupo DTE requiere al menos una transacción")

  const [dte, transactions] = await Promise.all([
    db.query.dteDocuments.findFirst({
      where: eq(dteDocuments.id, dteDocumentId),
      columns: { id: true, tipoDte: true, rutEmisor: true, montoTotal: true },
    }),
    db.query.fuelProviderTransactions.findMany({
      where: inArray(fuelProviderTransactions.id, ids),
      columns: { id: true, amount: true },
      with: { supplier: { columns: { rut: true } } },
    }),
  ])
  if (!dte) throw new Error("El DTE no existe")
  if (transactions.length !== ids.length) throw new Error("Una o más transacciones externas no existen")

  const candidate = buildFuelDteGroupCandidate(transactions.map((transaction) => ({
    id: transaction.id,
    supplierRut: transaction.supplier?.rut ?? null,
    amount: transaction.amount,
  })))
  if (!candidate) throw new Error("Las transacciones del grupo DTE deben pertenecer al mismo proveedor con RUT conocido")
  const decision = decideFuelDteGroup(dte, [candidate], tolerance)

  await db.transaction(async (tx) => {
    // Una transacción externa pertenece a una sola evidencia DTE; el DTE es
    // el que puede agrupar N transacciones. Reconciliar de nuevo reemplaza la
    // decisión previa en vez de acumular vínculos documentales contradictorios.
    await tx.delete(fuelReconciliationLinks).where(and(
      inArray(fuelReconciliationLinks.providerTransactionId, ids),
      eq(fuelReconciliationLinks.linkType, "dte"),
    ))
    for (const transactionId of ids) {
      await tx.insert(fuelReconciliationLinks).values({
        id: nanoid(),
        providerTransactionId: transactionId,
        linkType: "dte",
        dteDocumentId: decision.status === "matched" ? dte.id : null,
        status: decision.status,
        matchMethod: "explicit_provider_transaction_group",
        amountDelta: decision.difference,
        toleranceAmount: tolerance,
        reason: decision.reason,
        updatedAt: new Date().toISOString(),
      }).onConflictDoNothing()
    }
  })

  return decision
}
