import { createHash } from "node:crypto"

export type FuelProvider = "copec" | "aramco"

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
  plate: string
  sourceProduct: string | null
  product: string
  quantity: number
  amount: number
  unitPrice: number | null
  payload: unknown
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
]

function compact(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
}

function normalizePlate(value: string): string {
  return compact(value).toUpperCase()
}

function canonicalProduct(value: string | null): string | null {
  if (!value) return null
  const key = compact(value)
  return productAliases.find(([alias]) => alias === key)?.[1]
    ?? (key.includes("adblue") || key.includes("bluemax") || key.includes("blue") ? "bluemax" : null)
    ?? (key.includes("diesel") ? "diesel" : null)
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
    input.plate ? normalizePlate(input.plate) : "",
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
    const plate = input.plate ? normalizePlate(input.plate) : ""
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
      sourceProduct: input.product,
      product,
      quantity: input.quantity,
      amount: input.amount,
      unitPrice: input.quantity > 0 ? Math.round(input.amount / input.quantity * 10_000) / 10_000 : null,
      payload: input.payload,
    })
  }

  return { accepted, rejected, pending }
}
