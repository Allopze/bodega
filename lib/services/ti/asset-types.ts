import { eq, asc } from "drizzle-orm"
import { db } from "@/db"
import { itAssetTypes } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"

export interface UpsertAssetTypeInput {
  id?: string
  name: string
  category: string
  hasSpecs: boolean
  isActive?: boolean
}

export async function upsertAssetType(
  input: UpsertAssetTypeInput,
  actor: { userId: string; userEmail?: string },
): Promise<string> {
  const id = input.id ?? nanoid()
  await db.transaction(async (tx) => {
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
