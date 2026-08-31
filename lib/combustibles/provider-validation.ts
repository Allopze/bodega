import { createHash } from "node:crypto"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"

export type FuelProvider = "copec" | "aramco"

/**
 * Qué representa una fila de la fuente.
 *
 * `period_aggregate` es el informe TCT de Copec: una fila por patente y MES.
 * No se puede cruzar contra una carga interna por fecha y monto, así que la
 * conciliación la salta explícitamente.
 */
export type ProviderRowGranularity = "transaction" | "period_aggregate"

export interface ProviderRowInput {
  provider: FuelProvider
  accountKey: string
  sourceRowKey: string
  externalId: string | number | null
  occurredAt: string | null
  plate: string | null
  product: string | null
  quantity: unknown
  amount: unknown
  payload: unknown
  /** Por defecto `transaction`: sólo Copec TCT declara agregado. */
  granularity?: ProviderRowGranularity
}

export type ProviderValidationCode =
  | "missing_identity"
  | "invalid_date"
  | "date_out_of_range"
  | "invalid_quantity"
  | "negative_quantity"
  | "invalid_amount"
  | "negative_amount"
  | "unknown_product"
  | "missing_plate"
  | "duplicate_identity"

export interface ProviderValidationIssue {
  sourceRowKey: string
  code: ProviderValidationCode
  message: string
  input: ProviderRowInput
}

export interface AcceptedProviderRow {
  provider: FuelProvider
  accountKey: string
  sourceRowKey: string
  externalId: string | null
  identityKey: string
  fingerprint: string
  occurredAt: string
  /** Clave de comparación (`plateMatchKey`), para resolver el vehículo. */
  plate: string
  /**
   * Patente TAL COMO la entregó la fuente.
   *
   * `fuel_provider_transactions.source_plate` guardaba la forma compacta para
   * las filas aceptadas y la CRUDA para las rechazadas y pendientes, o sea dos
   * representaciones distintas en la misma columna. La columna significa "lo
   * que mandó el proveedor" —así la usa la exportación de calidad, donde el
   * operador va a buscar esa patente al portal— y el matching ya normaliza por
   * su cuenta. Mismo par que `sourceProduct`/`product`.
   */
  sourcePlate: string | null
  sourceProduct: string | null
  product: string
  quantity: number
  amount: number
  unitPrice: number | null
  payload: unknown
  granularity: ProviderRowGranularity
}

export interface ProviderValidationResult {
  accepted: AcceptedProviderRow[]
  rejected: ProviderValidationIssue[]
  pending: ProviderValidationIssue[]
}

const productAliases: Array<[string, string]> = [
  ["diesel", "diesel"],
  ["petroleodiesel", "diesel"],
  ["petroleodieselcopec", "diesel"],
  ["bluemax", "bluemax"],
  ["adblue", "bluemax"],
  ["aditivoblue", "bluemax"],
  ["gasolina", "gasolina"],
  ["bencina", "gasolina"],
  ["kerosene", "kerosene"],
  ["keroseno", "kerosene"],
  ["parafina", "kerosene"],
]

function compact(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
}

// La normalización de patente ya vivía en `xlsx-utils.plateMatchKey`, con la
// MISMA semántica (mayúsculas sin separadores). Tener una copia local llamada
// `normalizePlate` era peor que una duplicación: en `xlsx-utils` ese nombre
// designa otra cosa (conserva los guiones), así que el módulo tenía un tercer
// significado del mismo identificador.

/**
 * Nombre externo de producto -> producto canónico, o `null` si no se reconoce.
 *
 * Gasolina y kerosene se reconocen desde 2026-08-28: antes caían en `null`, la
 * fila quedaba `pending` por "producto sin mapping canónico" y sus litros nunca
 * llegaban a un lote — con lo cual la fuente `Aramco Fleet Otros`, que existe
 * exactamente para recogerlos, era inalcanzable. Un producto que de verdad no
 * se reconozca SIGUE yendo a revisión: la puerta no se abrió, se completó el
 * catálogo de lo que las cuentas tienen habilitado.
 */
function canonicalProduct(value: string | null): string | null {
  if (!value) return null
  const key = compact(value)
  return productAliases.find(([alias]) => alias === key)?.[1]
    // El orden es el mismo que en `fuelProductIdForLegacy`: la familia BLUE
    // gana sobre DIESEL porque "Aditivo BlueMax Diesel" es aditivo.
    ?? (key.includes("adblue") || key.includes("bluemax") || key.includes("blue") || key.includes("flua") ? "bluemax" : null)
    ?? (key.includes("diesel") ? "diesel" : null)
    ?? (key.includes("gasolina") || key.includes("bencina") || key.includes("gasoline") ? "gasolina" : null)
    ?? (key.includes("kerosen") || key.includes("parafina") ? "kerosene" : null)
}

function validPlainDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) return false
  const datePart = value.slice(0, 10)
  const [year, month, day] = datePart.split("-").map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

function datePart(value: string): string {
  return value.slice(0, 10)
}

function issue(input: ProviderRowInput, code: ProviderValidationCode, message: string): ProviderValidationIssue {
  return { sourceRowKey: input.sourceRowKey, code, message, input }
}

/** Fingerprint only uses canonical scalar fields, never object key order. */
export function fingerprintProviderRow(input: ProviderRowInput): string {
  const value = [
    input.provider,
    input.accountKey,
    input.sourceRowKey,
    input.externalId ?? "",
    input.occurredAt ?? "",
    input.plate ? plateMatchKey(input.plate) : "",
    input.product ? compact(input.product) : "",
    typeof input.quantity === "number" ? input.quantity : String(input.quantity ?? ""),
    typeof input.amount === "number" ? input.amount : String(input.amount ?? ""),
  ].join("|")
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function externalIdValue(value: ProviderRowInput["externalId"]): string | null {
  if (value === null || value === undefined || value === "") return null
  const normalized = String(value).trim()
  return normalized || null
}

export function validateProviderRows(
  inputs: ProviderRowInput[],
  period: { from: string; to: string },
): ProviderValidationResult {
  const accepted: AcceptedProviderRow[] = []
  const rejected: ProviderValidationIssue[] = []
  const pending: ProviderValidationIssue[] = []
  const identities = new Set<string>()

  for (const input of inputs) {
    const externalId = externalIdValue(input.externalId)
    if (!input.sourceRowKey.trim() && !externalId) {
      rejected.push(issue(input, "missing_identity", "La fila no tiene una identidad externa ni una clave de fila estable"))
      continue
    }

    if (!input.occurredAt || !validPlainDate(input.occurredAt)) {
      rejected.push(issue(input, "invalid_date", "La fecha de la transacción no es válida"))
      continue
    }
    const occurred = datePart(input.occurredAt)
    if (occurred < period.from || occurred > period.to) {
      rejected.push(issue(input, "date_out_of_range", "La fecha de la transacción está fuera del período solicitado"))
      continue
    }

    if (typeof input.quantity !== "number" || !Number.isFinite(input.quantity)) {
      rejected.push(issue(input, "invalid_quantity", "La cantidad no es un número finito"))
      continue
    }
    if (input.quantity < 0) {
      rejected.push(issue(input, "negative_quantity", "La cantidad negativa requiere revisión como reversa externa"))
      continue
    }
    if (typeof input.amount !== "number" || !Number.isFinite(input.amount)) {
      rejected.push(issue(input, "invalid_amount", "El monto no es un número finito"))
      continue
    }
    if (input.amount < 0) {
      rejected.push(issue(input, "negative_amount", "El monto negativo requiere revisión como reversa externa"))
      continue
    }

    const product = canonicalProduct(input.product)
    // `sourceRowKey` is the stable fallback identity for providers such as
    // Copec that do not expose a native transaction id. The fingerprint stays
    // separate so a corrected amount updates the same ledger row instead of
    // creating a second transaction.
    const identityKey = externalId
      ? `external:${externalId}`
      : `row:${input.provider}:${input.accountKey}:${input.sourceRowKey}`
    if (identities.has(identityKey)) {
      rejected.push(issue(input, "duplicate_identity", `La identidad ${identityKey} se repite dentro de la respuesta externa`))
      continue
    }
    identities.add(identityKey)

    if (!product) {
      pending.push(issue(input, "unknown_product", "El producto externo no tiene mapping canónico; requiere revisión"))
      continue
    }
    const plate = input.plate ? plateMatchKey(input.plate) : ""
    if (!plate) {
      pending.push(issue(input, "missing_plate", "La transacción no trae patente para resolver vehículo y faena"))
      continue
    }

    accepted.push({
      provider: input.provider,
      accountKey: input.accountKey,
      sourceRowKey: input.sourceRowKey,
      externalId,
      identityKey,
      fingerprint: fingerprintProviderRow(input),
      occurredAt: input.occurredAt,
      plate,
      sourcePlate: input.plate,
      sourceProduct: input.product,
      product,
      quantity: input.quantity,
      amount: input.amount,
      unitPrice: input.quantity > 0 ? Math.round(input.amount / input.quantity * 10_000) / 10_000 : null,
      payload: input.payload,
      granularity: input.granularity ?? "transaction",
    })
  }

  return { accepted, rejected, pending }
}
