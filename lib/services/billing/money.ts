/**
 * lib/services/billing/money.ts
 *
 * Aritmética exacta de dinero para Facturación y Cobranza.
 *
 * Postgres guarda `numeric(14,2)` (exacto). Drizzle lo entrega como `number`
 * por convención del repositorio, así que el riesgo está en la aritmética en
 * JavaScript: `0.1 + 0.2 !== 0.3`. Este módulo lo resuelve operando siempre en
 * **unidades menores enteras** (centavos) y redondeando una sola vez al final.
 *
 * Reglas:
 * - Nunca sumar, restar ni comparar montos con los operadores nativos: usar
 *   `addAmounts`, `subtractAmounts`, `sumAmounts`, `compareAmounts`.
 * - Nunca sumar monedas distintas: `sumByCurrency` agrupa; `assertSameCurrency`
 *   falla ruidosamente si alguien lo intenta.
 * - CLP no usa decimales en la práctica, pero el esquema los permite (una nota
 *   de crédito proporcional puede traerlos), así que todo se maneja a 2.
 */

/** Decimales con los que trabaja el esquema (`numeric(14,2)`). */
const SCALE = 2
const FACTOR = 100

export class CurrencyMismatchError extends Error {
  constructor(readonly currencies: string[]) {
    super(`No se pueden sumar montos de monedas distintas: ${currencies.join(", ")}`)
    this.name = "CurrencyMismatchError"
  }
}

/** Convierte un monto a centavos enteros. Rechaza valores no finitos. */
export function toMinorUnits(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new TypeError(`Monto inválido: ${amount}`)
  }
  // Math.round sobre el producto es exacto para los rangos de numeric(14,2):
  // el peor caso (1e12 * 100) sigue muy por debajo de Number.MAX_SAFE_INTEGER.
  return Math.round(amount * FACTOR)
}

/** Convierte centavos enteros de vuelta a monto con 2 decimales. */
export function fromMinorUnits(minor: number): number {
  return Math.round(minor) / FACTOR
}

/**
 * Normaliza un monto a la escala del esquema (2 decimales).
 *
 * Limitación heredada del doble, no de esta función: un literal como `1.005`
 * ya vale `1.00499999999999989` antes de llegar acá, así que redondea a la
 * baja. Por eso los montos entran desde `numeric(14,2)` (exacto) o desde
 * entrada validada — nunca desde un cálculo en coma flotante previo.
 */
export function roundAmount(amount: number): number {
  return fromMinorUnits(toMinorUnits(amount))
}

export function addAmounts(a: number, b: number): number {
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b))
}

export function subtractAmounts(a: number, b: number): number {
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b))
}

/** Suma una lista de montos. Asume que ya están en la misma moneda. */
export function sumAmounts(amounts: readonly number[]): number {
  let minor = 0
  for (const amount of amounts) minor += toMinorUnits(amount)
  return fromMinorUnits(minor)
}

/**
 * Multiplica un monto por una cantidad (ej: precio unitario × cantidad).
 * La cantidad puede tener hasta 4 decimales (`numeric(14,4)` en los ítems).
 */
export function multiplyAmount(unitPrice: number, quantity: number): number {
  if (!Number.isFinite(quantity)) throw new TypeError(`Cantidad inválida: ${quantity}`)
  // Se escala la cantidad a enteros para no arrastrar el error del float.
  const QTY_FACTOR = 10_000
  const qtyMinor = Math.round(quantity * QTY_FACTOR)
  return fromMinorUnits(Math.round((toMinorUnits(unitPrice) * qtyMinor) / QTY_FACTOR))
}

/** Aplica una tasa de impuesto (ej: 0,19) a un neto. */
export function applyTaxRate(netAmount: number, taxRate: number): number {
  if (!Number.isFinite(taxRate) || taxRate < 0) throw new TypeError(`Tasa inválida: ${taxRate}`)
  return fromMinorUnits(Math.round(toMinorUnits(netAmount) * taxRate))
}

/** -1, 0 o 1. Comparación exacta a la escala del esquema. */
export function compareAmounts(a: number, b: number): -1 | 0 | 1 {
  const diff = toMinorUnits(a) - toMinorUnits(b)
  return diff === 0 ? 0 : diff < 0 ? -1 : 1
}

export function amountsEqual(a: number, b: number): boolean {
  return compareAmounts(a, b) === 0
}

/** True si |a − b| ≤ tolerancia (en la misma moneda). */
export function amountsWithinTolerance(a: number, b: number, tolerance: number): boolean {
  return Math.abs(toMinorUnits(a) - toMinorUnits(b)) <= toMinorUnits(Math.abs(tolerance))
}

export function isZero(amount: number): boolean {
  return toMinorUnits(amount) === 0
}

/** Valor absoluto exacto. */
export function absAmount(amount: number): number {
  return fromMinorUnits(Math.abs(toMinorUnits(amount)))
}

// ── Monedas ──────────────────────────────────────────────────────────────────

export interface MoneyAmount {
  amount: number
  currency: string
}

/**
 * Falla si la lista mezcla monedas. Úsalo antes de cualquier total agregado que
 * la UI vaya a mostrar como una sola cifra.
 */
export function assertSameCurrency(items: readonly MoneyAmount[]): string | null {
  const currencies = [...new Set(items.map((i) => i.currency))]
  if (currencies.length > 1) throw new CurrencyMismatchError(currencies)
  return currencies[0] ?? null
}

/**
 * Agrupa y suma por moneda. Es la forma correcta de totalizar una lista mixta:
 * devuelve un total por moneda, nunca una suma inventada.
 */
export function sumByCurrency(items: readonly MoneyAmount[]): MoneyAmount[] {
  const byCurrency = new Map<string, number>()
  for (const item of items) {
    byCurrency.set(item.currency, (byCurrency.get(item.currency) ?? 0) + toMinorUnits(item.amount))
  }
  return [...byCurrency.entries()]
    .map(([currency, minor]) => ({ currency, amount: fromMinorUnits(minor) }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

// ── Formato ──────────────────────────────────────────────────────────────────

/** Formatea con la moneda visible. CLP sin decimales; el resto con 2. */
export function formatMoney(amount: number, currency = "CLP"): string {
  const fractionDigits = currency === "CLP" ? 0 : SCALE
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
}

/** Tasa de IVA configurada (`TAX_RATE`, default 0,19). */
export function taxRate(): number {
  const parsed = Number(process.env.TAX_RATE)
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 1 ? parsed : 0.19
}
