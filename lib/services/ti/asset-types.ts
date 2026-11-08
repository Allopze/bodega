import { eq, and, ne, asc, sql } from "drizzle-orm"
import { db } from "@/db"
import { itAssetTypes } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import type { ItAssetCategory } from "@/lib/validation/ti"
import { isUniqueViolation } from "@/lib/action-error"

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
  const normalizedName = input.name.trim()
  try {
    await db.transaction(async (tx) => {
      // La comparación es por `lower(name)` y el índice único hace de guarda
      // final contra dos pestañas que crean «Notebook» y «notebook» a la vez.
      const nameMatch = sql`lower(${itAssetTypes.name}) = ${normalizedName.toLowerCase()}`
      const nameConflictWhere = input.id
        ? and(nameMatch, ne(itAssetTypes.id, input.id))
        : nameMatch
      const [conflict] = await tx.select({ id: itAssetTypes.id }).from(itAssetTypes).where(nameConflictWhere)
      if (conflict) throw new Error("Ya existe un tipo de activo con ese nombre")

      if (input.id) {
        const [existing] = await tx.select().from(itAssetTypes).where(eq(itAssetTypes.id, input.id)).for("update")
        if (!existing) throw new Error("Tipo de activo no encontrado")
        await tx.update(itAssetTypes).set({
          name: normalizedName,
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
          newState: { name: normalizedName, category: input.category, hasSpecs: input.hasSpecs },
        }, tx)
      } else {
        await tx.insert(itAssetTypes).values({
          id,
          name: normalizedName,
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
          newState: { name: normalizedName, category: input.category, hasSpecs: input.hasSpecs },
        }, tx)
      }
    })
  } catch (error) {
    // El chequeo previo no cubre dos pestañas simultáneas: el índice único sí.
    if (isUniqueViolation(error, "it_asset_types_name_lower_unique")) {
      throw new Error("Ya existe un tipo de activo con ese nombre")
    }
    throw error
  }
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
