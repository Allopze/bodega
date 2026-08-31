"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { eppProductFamilies } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { safeActionMessage } from "@/lib/action-error"
import { buildEppFamilyIdentityKey } from "@/lib/services/epp-import"
import { eppProductFamilySchema } from "@/lib/validation/product-catalogs"
import type { ActionState } from "@/lib/validation/masters"

/** Marca el choque de `identityKey` para distinguirlo de un error del driver. */
class EppFamilyIdentityCollision extends Error {
  constructor(readonly familyName: string) {
    super("Colisión de identidad de familia EPP")
  }
}

/**
 * The only place that lets an admin set (or fix) a family's `eppTypeId` —
 * every automatic write path (manual product form, EPP variant wizard, XLSX
 * import) only fills it in when it can infer one, so a family created before
 * that inference existed, or one it couldn't map, needs a manual fix here.
 * Prevención's EPP coverage tracking joins on this field: an unclassified
 * family is invisible to it, and no delivery of it ever counts as coverage.
 */
export async function setEppFamilyTypeAction(familyId: string, eppTypeId: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  if (!familyId || !eppTypeId) return { ok: false, message: "Familia y tipo son requeridos" }

  const family = await db.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.id, familyId) })
  if (!family) return { ok: false, message: "Familia no encontrada" }

  await db.update(eppProductFamilies).set({ eppTypeId, updatedAt: new Date().toISOString() }).where(eq(eppProductFamilies.id, familyId))

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "update", entityType: "epp_product_family", entityId: familyId,
    entityCode: family.canonicalName,
    oldState: { eppTypeId: family.eppTypeId }, newState: { eppTypeId },
  })

  revalidatePath("/admin/epps")
  return { ok: true, message: "Tipo de EPP actualizado" }
}

/**
 * Edita los datos de ficha de una familia EPP.
 *
 * `identityKey` es UNIQUE y **derivado** de categoría + nombre canónico +
 * marca + modelo (`buildEppFamilyIdentityKey`). El import deduplica familias
 * por esa clave, así que guardar marca/modelo sin recalcularla desincroniza el
 * dedup y la próxima importación crea una familia duplicada. Recalcular tiene
 * su propio riesgo — chocar con la clave de otra familia — así que se
 * comprueba antes y se devuelve un error de campo legible en vez de dejar
 * escapar un 23505 crudo.
 */
export async function updateEppFamilyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = eppProductFamilySchema.safeParse({
    id:             formData.get("id"),
    brand:          formData.get("brand") || undefined,
    model:          formData.get("model") || undefined,
    certification:  formData.get("certification") || undefined,
    lifespanMonths: formData.get("lifespanMonths") || undefined,
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  try {
    await db.transaction(async (tx) => {
      const family = await tx.query.eppProductFamilies.findFirst({
        where: eq(eppProductFamilies.id, d.id),
        with: { category: true },
      })
      if (!family) throw new Error("Familia no encontrada")

      const brand = d.brand ?? null
      const model = d.model ?? null
      const identityKey = buildEppFamilyIdentityKey({
        categoryName:  family.category?.name ?? "",
        canonicalName: family.canonicalName,
        brand,
        model,
      })

      if (identityKey !== family.identityKey) {
        const collision = await tx.query.eppProductFamilies.findFirst({
          where: eq(eppProductFamilies.identityKey, identityKey),
        })
        if (collision && collision.id !== family.id) {
          throw new EppFamilyIdentityCollision(collision.canonicalName)
        }
      }

      await tx.update(eppProductFamilies).set({
        brand, model,
        certification:  d.certification ?? null,
        lifespanMonths: d.lifespanMonths ?? null,
        identityKey,
        updatedAt: new Date().toISOString(),
      }).where(eq(eppProductFamilies.id, d.id))

      await recordAudit({
        userId: session.user.id, userEmail: session.user.email ?? undefined,
        action: "update", entityType: "epp_product_family", entityId: d.id,
        entityCode: family.canonicalName,
        oldState: {
          brand: family.brand, model: family.model,
          certification: family.certification, lifespanMonths: family.lifespanMonths,
        },
        newState: { brand, model, certification: d.certification ?? null, lifespanMonths: d.lifespanMonths ?? null },
      }, tx)  // con `tx`: el audit se revierte con el cambio, y sin él un
              // driver de conexión única se autobloquea dentro de la transacción
    })
  } catch (e) {
    if (e instanceof EppFamilyIdentityCollision) {
      return { ok: false, fieldErrors: { brand: [`Ya existe la familia «${e.familyName}» con esa marca y modelo. Fusiónalas o usa otro modelo.`] } }
    }
    logger.error("[admin/epps] updateEppFamilyAction", e)
    return { ok: false, message: safeActionMessage(e, "No se pudo guardar la familia") }
  }

  revalidatePath("/admin/epps")
  return { ok: true, message: "Familia actualizada" }
}
