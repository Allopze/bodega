import { eq, and, ne, asc } from "drizzle-orm"
import { db } from "@/db"
import { itAssetTypes } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import type { ItAssetCategory } from "@/lib/validation/ti"

export interface UpsertAssetTypeInput {
  id?: string
  name: string
  category: ItAssetCategory
  hasSpecs: boolean
  isActive?: boolean
}

export async function upsertAssetType(
  input: UpsertAssetTypeInput,
  actor: { userId: string; userEmail?: string },
): Promise<string> {
  const id = input.id ?? nanoid()
  await db.transaction(async (tx) => {
    const nameConflictWhere = input.id
      ? and(eq(itAssetTypes.name, input.name), ne(itAssetTypes.id, input.id))
      : eq(itAssetTypes.name, input.name)
    const [conflict] = await tx.select({ id: itAssetTypes.id }).from(itAssetTypes).where(nameConflictWhere)
    if (conflict) throw new Error("Ya existe un tipo de activo con ese nombre")

    if (input.id) {
      const [existing] = await tx.select().from(itAssetTypes).where(eq(itAssetTypes.id, input.id)).for("update")
      if (!existing) throw new Error("Tipo de activo no encontrado")
      await tx.update(itAssetTypes).set({
        name: input.name,
        category: input.category,
        hasSpecs: input.hasSpecs,
        isActive: input.isActive ?? existing.isActive,
        updatedAt: new Date().toISOString(),
      }).where(eq(itAssetTypes.id, input.id))
      await recordAudit({
        userId: actor.userId,
        userEmail: actor.userEmail,
        action: "update",
        entityType: "it_asset_type",
        entityId: id,
        oldState: { name: existing.name, category: existing.category, hasSpecs: existing.hasSpecs },
        newState: { name: input.name, category: input.category, hasSpecs: input.hasSpecs },
      }, tx)
    } else {
      await tx.insert(itAssetTypes).values({
        id,
        name: input.name,
        category: input.category,
        hasSpecs: input.hasSpecs,
        isActive: input.isActive ?? true,
      })
      await recordAudit({
        userId: actor.userId,
        userEmail: actor.userEmail,
        action: "create",
        entityType: "it_asset_type",
        entityId: id,
        newState: { name: input.name, category: input.category, hasSpecs: input.hasSpecs },
      }, tx)
    }
  })
  return id
}

export async function listAssetTypes(options?: { includeInactive?: boolean }) {
  return db
    .select()
    .from(itAssetTypes)
    .where(options?.includeInactive ? undefined : eq(itAssetTypes.isActive, true))
    .orderBy(asc(itAssetTypes.name))
}

/**
 * Activa/desactiva un tipo de activo sin tocar el resto de sus campos.
 *
 * A diferencia de reenviar todo el registro a `upsertAssetType` (frágil: una
 * edición concurrente puede pisarse con valores viejos leídos de la fila en
 * pantalla), acá el UPDATE solo toca `isActive`.
 */
export async function setAssetTypeActive(
  id: string,
  isActive: boolean,
  actor: { userId: string; userEmail?: string },
): Promise<{ id: string; name: string; isActive: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itAssetTypes).where(eq(itAssetTypes.id, id)).for("update")
    if (!existing) throw new Error("Tipo de activo no encontrado")

    await tx.update(itAssetTypes).set({
      isActive,
      updatedAt: new Date().toISOString(),
    }).where(eq(itAssetTypes.id, id))

    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "it_asset_type",
      entityId: id,
      oldState: { isActive: existing.isActive },
      newState: { isActive },
    }, tx)

    return { id, name: existing.name, isActive }
  })
}
