import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelCycleMovements, fuelLoads, fuelProviderTransactions, fuelReconciliationLinks } from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { FuelProvider } from "./provider-validation"

export interface ProviderEvidence {
  provider: FuelProvider
  supplierId: string | null
  productId: string | null
  worksiteId: string | null
  vehicleId: string | null
  occurredAt: string | null
  quantity: number | null
  amount: number | null
}

export interface FuelLoadCandidate {
  id: string
  supplierId: string
  productId: string
  worksiteId: string
  vehicleId: string
  loadDate: string
  liters: number
  totalAmount: number
}

export interface ReconciliationDecision {
  status: "matched" | "ambiguous" | "unmatched"
  candidate: FuelLoadCandidate | null
  candidates: FuelLoadCandidate[]
  reason: string
  litersDelta: number | null
  amountDelta: number | null
}

export interface ReconciliationTolerances {
  liters: number
  amount: number
}

export interface CycleMovementCandidate {
  id: string
  supplierId: string
  productId: string
  worksiteId: string
  vehicleId: string
  occurredAt: string
  quantity: number
}

export interface CycleReconciliationDecision {
  status: "matched" | "ambiguous" | "unmatched"
  candidate: CycleMovementCandidate | null
  candidates: CycleMovementCandidate[]
  reason: string
  litersDelta: number | null
}

const DEFAULT_TOLERANCES: ReconciliationTolerances = { liters: 0.01, amount: 1 }

function datePart(value: string | null): string | null {
  return value?.slice(0, 10) ?? null
}

function withinTolerance(actual: number, expected: number, tolerance: number): boolean {
  // Numeric values come from PostgreSQL/Excel and can carry a binary-float
  // residue at an exact cent/liter boundary.
  return Math.abs(actual - expected) <= tolerance + 1e-9
}

/**
 * Matching conservador: primero exige proveedor/producto/faena/vehículo/día;
 * luego compara litros y monto con tolerancias declaradas. Una segunda carga
 * candidata nunca se resuelve por orden de llegada.
 */
export function decideFuelLoadMatch(
  evidence: ProviderEvidence,
  candidates: FuelLoadCandidate[],
  tolerances: ReconciliationTolerances = DEFAULT_TOLERANCES,
): ReconciliationDecision {
  const scoped = candidates.filter((candidate) => (
    evidence.supplierId !== null
    && candidate.supplierId === evidence.supplierId
    && evidence.productId !== null
    && candidate.productId === evidence.productId
    && evidence.worksiteId !== null
    && candidate.worksiteId === evidence.worksiteId
    && evidence.vehicleId !== null
    && candidate.vehicleId === evidence.vehicleId
    && datePart(evidence.occurredAt) === candidate.loadDate
  ))

  const quantity = evidence.quantity
  const amount = evidence.amount
  const matchingCandidates = scoped.filter((candidate) => (
    quantity !== null
    && amount !== null
    && withinTolerance(candidate.liters, quantity, tolerances.liters)
    && withinTolerance(candidate.totalAmount, amount, tolerances.amount)
  ))

  if (matchingCandidates.length === 1) {
    const candidate = matchingCandidates[0]!
    return {
      status: "matched",
      candidate,
      candidates: matchingCandidates,
      reason: "coincidencia exacta dentro de tolerancia",
      litersDelta: candidate.liters - quantity!,
      amountDelta: candidate.totalAmount - amount!,
    }
  }
  if (matchingCandidates.length > 1) {
    return { status: "ambiguous", candidate: null, candidates: matchingCandidates, reason: "más de una carga coincide dentro de tolerancia", litersDelta: null, amountDelta: null }
  }
  if (scoped.length > 0) {
    return { status: "unmatched", candidate: null, candidates: scoped, reason: "litros o monto fuera de tolerancia", litersDelta: null, amountDelta: null }
  }
  return { status: "unmatched", candidate: null, candidates: [], reason: "sin carga interna con proveedor, producto, faena, vehículo y fecha compatibles", litersDelta: null, amountDelta: null }
}

/** El canal físico usa sólo litros: no se compara monto contable contra estanque. */
export function decideCycleMovementMatch(
  evidence: ProviderEvidence,
  candidates: CycleMovementCandidate[],
  toleranceLiters = DEFAULT_TOLERANCES.liters,
): CycleReconciliationDecision {
  const scoped = candidates.filter((candidate) => (
    evidence.supplierId !== null
    && candidate.supplierId === evidence.supplierId
    && evidence.productId !== null
    && candidate.productId === evidence.productId
    && evidence.worksiteId !== null
    && candidate.worksiteId === evidence.worksiteId
    && evidence.vehicleId !== null
    && candidate.vehicleId === evidence.vehicleId
    && datePart(evidence.occurredAt) === datePart(candidate.occurredAt)
  ))
  const withinLitersTolerance = scoped.filter((candidate) => evidence.quantity !== null && withinTolerance(candidate.quantity, evidence.quantity, toleranceLiters))
  if (withinLitersTolerance.length === 1) {
    const candidate = withinLitersTolerance[0]!
    return { status: "matched", candidate, candidates: withinLitersTolerance, reason: "consumo proveedor coincide con entrega física dentro de tolerancia", litersDelta: candidate.quantity - evidence.quantity! }
  }
  if (withinLitersTolerance.length > 1) return { status: "ambiguous", candidate: null, candidates: withinLitersTolerance, reason: "más de una entrega física coincide dentro de tolerancia", litersDelta: null }
  if (scoped.length > 0) return { status: "unmatched", candidate: null, candidates: scoped, reason: "litros fuera de tolerancia para las entregas físicas candidatas", litersDelta: null }
  return { status: "unmatched", candidate: null, candidates: [], reason: "sin entrega física compatible por proveedor, producto, faena, vehículo y fecha", litersDelta: null }
}

/**
 * Deja UN vínculo por (transacción, tipo): reemplaza el anterior en vez de
 * sumarle uno.
 *
 * `onConflictDoNothing` no alcanzaba. El índice único incluye las columnas de
 * destino y en PostgreSQL los NULL son distintos entre sí, así que una
 * transacción sin match insertaba una fila NUEVA en cada corrida —verificado:
 * tres corridas idénticas dejaban tres filas—, y cuando la carga interna
 * aparecía, el `matched` se sumaba al `unmatched` viejo en vez de reemplazarlo.
 * `unmatched_reconciliation_links` del preflight habría crecido para siempre.
 *
 * Es el mismo criterio que la conciliación DTE ya aplicaba borrando primero.
 */
async function replaceLink(values: typeof fuelReconciliationLinks.$inferInsert): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(fuelReconciliationLinks).where(and(
      eq(fuelReconciliationLinks.providerTransactionId, values.providerTransactionId),
      eq(fuelReconciliationLinks.linkType, values.linkType),
    ))
    await tx.insert(fuelReconciliationLinks).values(values)
  })
}

/** Persiste una decisión de carga sin crear un vínculo artificial 1:1 con DTE. */
export async function reconcileProviderTransactionToFuelLoads(
  transactionId: string,
  tolerances: ReconciliationTolerances = DEFAULT_TOLERANCES,
): Promise<ReconciliationDecision> {
  const transaction = await db.query.fuelProviderTransactions.findFirst({
    where: eq(fuelProviderTransactions.id, transactionId),
    columns: {
      id: true,
      provider: true,
      supplierId: true,
      productId: true,
      worksiteId: true,
      vehicleId: true,
      occurredAt: true,
      quantity: true,
      amount: true,
    },
  })
  if (!transaction) throw new Error("La transacción externa no existe")

  const candidates = transaction.worksiteId && transaction.productId && transaction.vehicleId
    ? await db.query.fuelLoads.findMany({
        where: and(
          eq(fuelLoads.worksiteId, transaction.worksiteId),
          eq(fuelLoads.productId, transaction.productId),
          eq(fuelLoads.vehicleId, transaction.vehicleId),
        ),
        columns: { id: true, fuelSupplierId: true, productId: true, worksiteId: true, vehicleId: true, loadDate: true, liters: true, totalAmount: true },
      })
    : []

  const decision = decideFuelLoadMatch(transaction as ProviderEvidence, candidates.map((candidate) => ({
    id: candidate.id,
    supplierId: candidate.fuelSupplierId,
    productId: candidate.productId,
    worksiteId: candidate.worksiteId,
    vehicleId: candidate.vehicleId,
    loadDate: candidate.loadDate,
    liters: candidate.liters,
    totalAmount: candidate.totalAmount,
  })), tolerances)

  await replaceLink({
    id: nanoid(),
    providerTransactionId: transactionId,
    linkType: "fuel_load",
    fuelLoadId: decision.candidate?.id ?? null,
    status: decision.status,
    matchMethod: "provider_product_worksite_vehicle_date_amount",
    litersDelta: decision.litersDelta,
    amountDelta: decision.amountDelta,
    toleranceLiters: tolerances.liters,
    toleranceAmount: tolerances.amount,
    reason: decision.reason,
    updatedAt: new Date().toISOString(),
  })

  return decision
}

/** Vincula una transacción con una entrega directa/ciclo físico sin mezclarla
 * con la factura: cada evidencia conserva su propio vínculo. */
export async function reconcileProviderTransactionToCycleMovement(
  transactionId: string,
  toleranceLiters = DEFAULT_TOLERANCES.liters,
): Promise<CycleReconciliationDecision> {
  const transaction = await db.query.fuelProviderTransactions.findFirst({
    where: eq(fuelProviderTransactions.id, transactionId),
    columns: { provider: true, supplierId: true, productId: true, worksiteId: true, vehicleId: true, occurredAt: true, quantity: true },
  })
  if (!transaction) throw new Error("La transacción externa no existe")

  const candidates = transaction.worksiteId && transaction.productId && transaction.vehicleId
    ? await db.query.fuelCycleMovements.findMany({
        where: and(
          eq(fuelCycleMovements.eventType, "direct_delivery"),
          eq(fuelCycleMovements.worksiteId, transaction.worksiteId),
          eq(fuelCycleMovements.productId, transaction.productId),
          eq(fuelCycleMovements.vehicleId, transaction.vehicleId),
        ),
        columns: { id: true, supplierId: true, productId: true, worksiteId: true, vehicleId: true, occurredAt: true, quantity: true },
      })
    : []
  const decision = decideCycleMovementMatch(transaction as ProviderEvidence, candidates.map((candidate) => ({
    id: candidate.id,
    supplierId: candidate.supplierId ?? "",
    productId: candidate.productId,
    worksiteId: candidate.worksiteId,
    vehicleId: candidate.vehicleId!,
    occurredAt: candidate.occurredAt,
    quantity: candidate.quantity,
  })), toleranceLiters)

  await replaceLink({
    id: nanoid(),
    providerTransactionId: transactionId,
    linkType: "cycle_movement",
    cycleMovementId: decision.candidate?.id ?? null,
    status: decision.status,
    matchMethod: "provider_product_worksite_vehicle_date_liters",
    litersDelta: decision.litersDelta,
    toleranceLiters,
    reason: decision.reason,
    updatedAt: new Date().toISOString(),
  })
  return decision
}

/**
 * Concilia las transacciones aceptadas de una corrida contra las cargas
 * internas y las entregas del ciclo físico.
 *
 * Existe porque nadie llamaba a las funciones de arriba: `fuel_reconciliation_links`
 * no la escribía ningún camino de producción, así que las dos métricas que el
 * preflight saca de ahí daban cero por falta de datos y no por estar todo
 * cuadrado.
 *
 * Sólo las `accepted`: una `pending` no tiene faena, producto ni vehículo, así
 * que no hay contra qué compararla y sólo dejaría ruido.
 *
 * ponytail: el alcance es la corrida, no el histórico. Una transacción cuya
 * carga interna se registre después queda `unmatched` hasta que otra corrida la
 * vuelva a tocar; como ambas sincronizaciones reimportan una ventana —el mes
 * abierto en Copec, cuatro meses en Aramco— se resuelve sola dentro de ella. Más
 * atrás va a necesitar reconciliar bajo demanda, que es lo que corresponde
 * cuando exista la pantalla de revisión.
 */
export async function reconcileFuelProviderRun(runId: string): Promise<{ reconciled: number; matched: number; skippedAggregates: number }> {
  const accepted = await db.query.fuelProviderTransactions.findMany({
    where: and(eq(fuelProviderTransactions.syncRunId, runId), eq(fuelProviderTransactions.status, "accepted")),
    columns: { id: true, provider: true, supplierId: true, granularity: true },
  })

  // La evidencia agregada (informe TCT de Copec: una fila por patente y MES) no
  // es comparable con una carga interna. `decideFuelLoadMatch` exige misma
  // fecha civil y litros/monto dentro de tolerancia, así que le daba
  // `unmatched` a TODAS: un veredicto que decía "descuadre" donde sólo había
  // granularidades distintas, y que inflaba `unmatchedReconciliationLinks` del
  // preflight con ruido puro. Se saltan explícitamente.
  const transactions = accepted.filter((transaction) => transaction.granularity !== "period_aggregate")
  const skippedAggregates = accepted.length - transactions.length

  // Sin ficha en `fuel_suppliers` el primer filtro de `decideFuelLoadMatch`
  // corta siempre (`evidence.supplierId !== null`), así que conciliar dejaría
  // un `unmatched` por transacción y ninguna pista de la causa. Se corta antes
  // y se reporta: el llamador lo convierte en una corrida `partial` con motivo,
  // que es donde el operador lo puede ver.
  const orphanProviders = [...new Set(
    transactions.filter((transaction) => transaction.supplierId === null).map((transaction) => transaction.provider),
  )]
  if (transactions.length > 0 && orphanProviders.length > 0 && transactions.every((transaction) => transaction.supplierId === null)) {
    throw new Error(
      `No hay proveedor activo en el catálogo de combustibles para ${orphanProviders.join(", ")}: `
      + "crea su ficha en Combustibles → Proveedores para que la conciliación pueda cruzar sus transacciones.",
    )
  }

  let matched = 0
  for (const transaction of transactions) {
    // Secuencial a propósito y sin `Promise.all`: las dos ramas escriben en
    // `fuel_reconciliation_links` para la MISMA transacción y cada
    // `replaceLink` abre su transacción con un DELETE por (transacción, tipo).
    // El `const [a, b] = [await ..., await ...]` anterior parecía paralelo y no
    // lo era; esto dice lo que hace.
    const load = await reconcileProviderTransactionToFuelLoads(transaction.id)
    const cycle = await reconcileProviderTransactionToCycleMovement(transaction.id)
    if (load.status === "matched" || cycle.status === "matched") matched++
  }
  return { reconciled: transactions.length, matched, skippedAggregates }
}
