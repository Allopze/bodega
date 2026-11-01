import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelProviderTransactions } from "@/db/schema"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"

/**
 * Una tarjeta de abastecimiento (TAE) o una patente con cargas pendientes en
 * una corrida de proveedor. Cada caso tiene su propio arreglo: la tarjeta
 * necesita un estanque activo; la patente, un vehículo en la flota con
 * asignación para ese mes.
 */
export interface ProviderPendingItem {
  kind: "tae_card" | "plate"
  /** La tarjeta o la patente tal como la informó el proveedor. */
  label: string
  loads: number
}

/**
 * Las tarjetas y patentes que dejaron cargas pendientes en la corrida, de la
 * que más cargas tiene a la que menos. Una carga se cuenta una sola vez aunque
 * el ledger la guarde dos veces: una tarjeta TAE sin estanque queda como
 * `unresolved_mapping` y también como `unmapped_tae_card`, con otra identidad.
 */
export async function listProviderPendingItems(runId: string): Promise<ProviderPendingItem[]> {
  const rows = await db
    .select({
      account: fuelProviderTransactions.sourceAccount,
      plate: fuelProviderTransactions.sourcePlate,
      occurredAt: fuelProviderTransactions.occurredAt,
      quantity: fuelProviderTransactions.quantity,
      amount: fuelProviderTransactions.amount,
    })
    .from(fuelProviderTransactions)
    .where(and(eq(fuelProviderTransactions.syncRunId, runId), eq(fuelProviderTransactions.status, "pending")))
  const items = new Map<string, { item: ProviderPendingItem; events: Set<string> }>()
  for (const row of rows) {
    const label = row.plate?.trim()
    if (!label) continue
    const kind = row.account.startsWith("tae:") ? "tae_card" : "plate"
    const key = `${kind}|${plateMatchKey(label)}`
    const entry = items.get(key) ?? { item: { kind, label, loads: 0 }, events: new Set<string>() }
    // Copec escribe la misma patente con y sin guion según el producto
    // («AB-CD12» en diésel, «ABCD12» en BlueMax): se muestra la que se lee mejor.
    if (!entry.item.label.includes("-") && label.includes("-")) entry.item.label = label
    entry.events.add(`${row.account}|${row.occurredAt}|${row.quantity}|${row.amount}`)
    entry.item.loads = entry.events.size
    items.set(key, entry)
  }
  return [...items.values()]
    .map(({ item }) => item)
    .sort((left, right) => right.loads - left.loads || left.label.localeCompare(right.label))
}

const SENTENCE_ITEMS = 3

/**
 * «tarjeta de abastecimiento 1-242269-00258-9-8 (8 cargas, sin estanque activo)
 * y patente AB-CD12 (2, sin vehículo o asignación)». Nombra las primeras y
 * resume el resto, para que el aviso quepa en una línea de estado.
 */
export function describeProviderPendingItems(items: readonly ProviderPendingItem[]): string {
  // Con una sola, la cifra ya la dice la frase que la rodea («8 cargas quedaron
  // pendientes…»): repetirla entre paréntesis sólo agrega ruido.
  if (items.length === 1) {
    const [item] = items
    return item!.kind === "tae_card"
      ? `la tarjeta de abastecimiento ${item!.label} no tiene estanque activo`
      : `la patente ${item!.label} no está en la flota o no tiene asignación para ese mes`
  }
  const named = items.slice(0, SENTENCE_ITEMS).map((item, index) => {
    const loads = index === 0 ? `${item.loads} carga${item.loads === 1 ? "" : "s"}` : String(item.loads)
    return item.kind === "tae_card"
      ? `tarjeta de abastecimiento ${item.label} (${loads}, sin estanque activo)`
      : `patente ${item.label} (${loads}, sin vehículo o asignación)`
  })
  const rest = items.length - named.length
  if (rest > 0) named.push(`${rest} más`)
  if (named.length <= 1) return named.join("")
  return `${named.slice(0, -1).join(", ")} y ${named.at(-1)}`
}
