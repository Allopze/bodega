import { eq } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings, type BillingProviderId } from "@/db/schema"

const SALES_XML_CURSOR_PREFIX = "billing.sync_cursor"

export function salesXmlCursorSettingKey(provider: BillingProviderId, scope: string, period: string): string {
  return `${SALES_XML_CURSOR_PREFIX}.${provider}.${scope}.${period}`
}

export function usesSalesXmlCursor(provider: BillingProviderId, scope: string): boolean {
  return provider === "factura_en_linea" && scope === "sales_invoices"
}

export async function readSalesXmlCursor(provider: BillingProviderId, scope: string, period: string): Promise<string | null> {
  if (!usesSalesXmlCursor(provider, scope)) return null
  const key = salesXmlCursorSettingKey(provider, scope, period)
  const rows = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1)
  return rows[0]?.value ?? null
}

/** Called only after every selected XML has been durably handled by the sync. */
export async function writeSalesXmlCursor(
  provider: BillingProviderId,
  scope: string,
  period: string,
  cursor: string | null,
): Promise<void> {
  if (!usesSalesXmlCursor(provider, scope)) return
  const key = salesXmlCursorSettingKey(provider, scope, period)
  if (cursor === null) {
    await db.delete(systemSettings).where(eq(systemSettings.key, key))
    return
  }
  await db.insert(systemSettings).values({ key, value: cursor, updatedAt: new Date().toISOString() }).onConflictDoUpdate({
    target: systemSettings.key,
    set: { value: cursor, updatedAt: new Date().toISOString() },
  })
}

export function chooseSalesXmlCandidates<T extends { key: string }>(
  candidates: readonly T[],
  cursor: string | null | undefined,
  limit: number,
): { items: T[]; nextCursor: string | null; deferred: boolean } {
  const ordered = [...candidates].sort((left, right) => left.key.localeCompare(right.key))
  if (ordered.length === 0) return { items: [], nextCursor: null, deferred: false }
  let start = 0
  if (cursor) {
    const after = ordered.findIndex((candidate) => candidate.key > cursor)
    start = after === -1 ? 0 : after
  }
  const items = ordered.slice(start, start + limit)
  const deferred = start + items.length < ordered.length
  return {
    items,
    nextCursor: deferred ? items.at(-1)?.key ?? null : null,
    deferred,
  }
}
