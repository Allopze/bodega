import { MONTH_LABELS, formatQty } from "@/lib/utils"

const MISSING = "—"

export const litersText = (value: number | null | undefined): string =>
  value === null || value === undefined ? MISSING : `${formatQty(value, undefined, { maximumFractionDigits: 1 })} L`

export const numberText = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined ? MISSING : formatQty(value, undefined, { maximumFractionDigits: digits })

export const pctText = (value: number | null | undefined): string =>
  value === null || value === undefined ? MISSING : `${formatQty(value, undefined, { maximumFractionDigits: 1 })} %`

/** «2026-03» → «Mar 2026». */
export function monthText(key: string): string {
  const [year, month] = key.split("-")
  const label = MONTH_LABELS[Number(month) - 1]
  return label && year ? `${label} ${year}` : key
}

/** «2026-03-10 11:00» (ya en hora de Chile, como lo entrega el historial de sellos) → «10-03-2026 11:00», sin pasar por `Date`. */
export function plainChileDateTime(value: string | null | undefined): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(value) : null
  return match ? `${match[3]}-${match[2]}-${match[1]} ${match[4]}` : MISSING
}
