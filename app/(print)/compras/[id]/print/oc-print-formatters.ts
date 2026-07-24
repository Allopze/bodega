/**
 * Formatting helpers for the Orden de Compra print view.
 */

export function formatOrderNumber(code: string): string {
  return code.replace(/^OC-/, "")
}

export function formatRequestReference(code: string): string {
  const match = code.match(/^SOL-(?:\d{4}-)?(\d+)$/)
  if (!match) return code.replace(/^SOL-/, "")
  return String(Number(match[1])).padStart(2, "0")
}

const PLAIN_CLP_FORMAT = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const DECIMAL_FORMAT = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatPlainCLP(amount: number): string {
  return PLAIN_CLP_FORMAT.format(amount)
}

export function formatDecimal(value: number): string {
  return DECIMAL_FORMAT.format(value)
}

export function formatDiscount(discount?: number | null): string {
  if (!discount || discount <= 0) return ""
  return `${formatPlainCLP(discount)}%`
}

export function formatUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase()
  if (["unidad", "unidades", "un", "u"].includes(normalized)) return "UN"
  return unit.trim().toUpperCase()
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}
