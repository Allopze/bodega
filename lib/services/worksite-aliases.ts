import { and, asc, eq, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { worksiteAliases, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { cleanName, nameKey } from "@/lib/mantencion/normalize"
import { worksiteAliasKey } from "@/lib/worksites/resolve-worksite"

/**
 * Alias de faena (Trinorma, 2026-11-21): otros nombres con que llega una faena en
 * las planillas («Horcones» → Arauco). Los importadores los resuelven con
 * `resolveWorksiteId`, que mira primero el nombre exacto y después esta tabla; por
 * eso un alias nunca puede ser el nombre de una faena ni repetirse: el importador
 * no adivina entre dos destinos.
 */

export const WORKSITE_ALIAS_MAX_LENGTH = 120

export interface WorksiteAliasActor {
  userId: string | null
  email?: string | null
}

export type WorksiteAliasResult<T = undefined> =
  | { ok: true; message: string; data: T }
  | { ok: false; message: string }

export interface WorksiteAliasRow {
  id: string
  worksiteId: string
  aliasText: string
}

/** ¿Por qué no se puede registrar `aliasText` para `worksiteId`? `null` = se puede. */
export async function worksiteAliasConflict(
  tx: Pick<Tx, "select">,
  worksiteId: string,
  aliasText: string,
): Promise<string | null> {
  const text = cleanName(aliasText)
  const key = worksiteAliasKey(text)
  if (!key) return "Escribe el alias."
  if (text.length > WORKSITE_ALIAS_MAX_LENGTH) return `El alias no puede pasar de ${WORKSITE_ALIAS_MAX_LENGTH} caracteres.`
  const sites = await tx.select({ id: worksites.id, name: worksites.name }).from(worksites)
  const sameName = sites.find((site) => nameKey(site.name) === key)
  if (sameName) {
    return sameName.id === worksiteId
      ? "Ese ya es el nombre de la faena: no hace falta un alias."
      : `«${text}» es el nombre de la faena ${sameName.name}: un alias no puede llamarse como otra faena.`
  }
  const [existing] = await tx.select({ worksiteId: worksiteAliases.worksiteId }).from(worksiteAliases).where(eq(worksiteAliases.aliasKey, key))
  if (existing) {
    if (existing.worksiteId === worksiteId) return "Esta faena ya tiene ese alias."
    const owner = sites.find((site) => site.id === existing.worksiteId)
    return `«${text}» ya es alias de la faena ${owner?.name ?? "otra faena"}.`
  }
  return null
}

/** Agrega un alias a una faena (misma transacción del llamador). Rechaza los conflictivos con su motivo. */
export async function addWorksiteAliasTx(
  tx: Tx,
  actor: WorksiteAliasActor,
  input: { worksiteId: string; aliasText: string; reason?: string },
): Promise<WorksiteAliasResult<{ id: string }>> {
  const [site] = await tx.select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites).where(eq(worksites.id, input.worksiteId))
  if (!site) return { ok: false, message: "Faena no encontrada." }
  const conflict = await worksiteAliasConflict(tx, input.worksiteId, input.aliasText)
  if (conflict) return { ok: false, message: conflict }
  const text = cleanName(input.aliasText)
  const id = nanoid()
  await tx.insert(worksiteAliases).values({
    id, worksiteId: site.id, aliasText: text, aliasKey: worksiteAliasKey(text), createdBy: actor.userId,
  })
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "create",
    entityType: "worksite_alias",
    entityId: id,
    entityCode: site.code,
    newState: { worksiteId: site.id, aliasText: text },
    reason: input.reason,
    worksiteId: site.id,
  }, tx)
  return { ok: true, message: `Alias «${text}» agregado a ${site.name}.`, data: { id } }
}

/** Quita un alias de la faena indicada. */
export async function removeWorksiteAliasTx(
  tx: Tx,
  actor: WorksiteAliasActor,
  input: { worksiteId: string; aliasId: string; reason?: string },
): Promise<WorksiteAliasResult> {
  const [row] = await tx.select().from(worksiteAliases)
    .where(and(eq(worksiteAliases.id, input.aliasId), eq(worksiteAliases.worksiteId, input.worksiteId)))
  if (!row) return { ok: false, message: "Ese alias ya no existe." }
  const [site] = await tx.select({ code: worksites.code }).from(worksites).where(eq(worksites.id, row.worksiteId))
  await tx.delete(worksiteAliases).where(eq(worksiteAliases.id, row.id))
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "delete",
    entityType: "worksite_alias",
    entityId: row.id,
    entityCode: site?.code,
    oldState: { worksiteId: row.worksiteId, aliasText: row.aliasText },
    reason: input.reason,
    worksiteId: row.worksiteId,
  }, tx)
  return { ok: true, message: `Alias «${row.aliasText}» quitado.`, data: undefined }
}

/** Alias de las faenas indicadas, ordenados por texto. */
export async function listWorksiteAliases(
  client: Pick<Tx, "select">,
  worksiteIds: readonly string[],
): Promise<WorksiteAliasRow[]> {
  if (worksiteIds.length === 0) return []
  return client.select({ id: worksiteAliases.id, worksiteId: worksiteAliases.worksiteId, aliasText: worksiteAliases.aliasText })
    .from(worksiteAliases)
    .where(inArray(worksiteAliases.worksiteId, [...worksiteIds]))
    .orderBy(asc(worksiteAliases.aliasText))
}
