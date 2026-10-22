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
