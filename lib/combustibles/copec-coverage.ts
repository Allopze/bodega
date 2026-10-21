export type CopecCoverageStatus = "unknown" | "incomplete" | "failed" | "complete" | "legitimate_empty"
export type CopecCoverageChannel = "TCT" | "TAE"
export type CopecCoverageProduct = "diesel" | "bluemax"

export interface ProviderCoverageRow {
  provider: string
  sourceAccount: string
  channel: string
  product: string
  periodMonth: string
  status: string
}

const TERMINAL_STATUSES = new Set<CopecCoverageStatus>(["complete", "legitimate_empty"])
const CHANNELS: readonly CopecCoverageChannel[] = ["TCT", "TAE"]
const PRODUCTS: readonly CopecCoverageProduct[] = ["diesel", "bluemax"]

function firstOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`
}

function nextMonth(value: string): string {
  const date = new Date(`${firstOfMonth(value)}T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * Returns the earliest month that is not terminal for any Copec channel and
 * product. Missing rows are unknown by definition; legacy cursors are never
 * used as evidence that a source dimension was complete.
 */
export function findNextCopecCoverageMonth(
  rows: ProviderCoverageRow[],
  from: string,
  to: string,
): string | null {
  const first = firstOfMonth(from)
  const last = firstOfMonth(to)
  const covered = new Map(rows.map((row) => [`${row.provider}|${row.sourceAccount}|${row.channel}|${row.product}|${row.periodMonth}`, row.status]))

  for (let month = first; month <= last; month = nextMonth(month)) {
    for (const channel of CHANNELS) {
      for (const product of PRODUCTS) {
        const account = `${channel.toLowerCase()}:${product}`
        const status = covered.get(`copec|${account}|${channel}|${product}|${month}`)
        if (!status || !TERMINAL_STATUSES.has(status as CopecCoverageStatus)) return month
      }
    }
  }
  return null
}

/**
 * Whether an operator may close this channel/product month as legitimately
 * empty. Besides "no observation yet", it accepts a file Copec delivered with
 * no rows and no errors: the sync records it as `failed` because an empty file
 * alone is not evidence, so without this the month had no way to close.
 * A file with rejected rows, or pending/incomplete data, still cannot be
 * declared empty.
 */
export function canConfirmCopecEmpty(row: { status: string; sourceAvailability: string; rowsReceived: number } | undefined): boolean {
  if (!row || row.status === "unknown") return true
  return row.status === "failed" && row.sourceAvailability === "available" && row.rowsReceived === 0
}

export function isTerminalCopecCoverage(status: string): status is "complete" | "legitimate_empty" {
  return TERMINAL_STATUSES.has(status as CopecCoverageStatus)
}
