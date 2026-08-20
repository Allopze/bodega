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

/** Cursores durables para todas las consultas paginadas que pueden reanudarse. */
export function usesDurableBillingCursor(provider: BillingProviderId, scope: string): boolean {
  return usesSalesXmlCursor(provider, scope)
    || (provider === "chipax" && (scope === "sales_invoices" || scope === "bank_transactions"))
}

export async function readSalesXmlCursor(provider: BillingProviderId, scope: string, period: string): Promise<string | null> {
  return readBillingCursor(provider, scope, period)
}

export async function readBillingCursor(provider: BillingProviderId, scope: string, period: string): Promise<string | null> {
  if (!usesDurableBillingCursor(provider, scope)) return null
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
  return writeBillingCursor(provider, scope, period, cursor)
}

/** Persiste el siguiente cursor sólo después de confirmar la página actual. */
export async function writeBillingCursor(
  provider: BillingProviderId,
  scope: string,
  period: string,
  cursor: string | null,
): Promise<void> {
  if (!usesDurableBillingCursor(provider, scope)) return
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
  // La clave empieza por la fecha de emisión, así que un documento registrado
  // con retraso aparece POR DEBAJO del cursor ya fijado. Descartarlo lo dejaba
  // fuera para siempre mientras el cursor no avanzara (un XML que nunca resuelve
  // basta para congelarlo). Se atiende primero lo que falta después del cursor y
  // el cupo que sobre se llena con los rezagados de antes.
  const ahead = cursor ? ordered.filter((candidate) => candidate.key > cursor) : ordered
  const behind = cursor ? ordered.filter((candidate) => candidate.key <= cursor) : []
  const items = [...ahead, ...behind].slice(0, limit)
  const deferred = items.length < ordered.length
  return {
    items,
    nextCursor: deferred ? items.at(-1)?.key ?? null : null,
    deferred,
  }
}
