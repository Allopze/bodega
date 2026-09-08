"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { eppProductFamilies, productCategories, products, preventionEppRequirements, eppTypes } from "@/db/schema"
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

/** Error de negocio que vuelve como error de campo, no como fallo genérico. */
class EppFamilyValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(message)
  }
}

/**
 * Corrección manual del `eppTypeId` de una familia.
 *
 * Las tres vías de alta (formulario manual, asistente de EPP e import XLSX)
 * clasifican con `classifyEppTypeIdByName` cuando el nombre declara un ítem
 * mapeable; queda sin clasificar lo que la inferencia no puede resolver sin
 * adivinar ("ALCOTEST DIGITAL", "BORDADO ESPALDA") y lo creado antes de que esa
 * inferencia existiera. Eso se arregla acá.
 *
 * Prevención hace INNER JOIN sobre este campo: una familia sin clasificar es
 * invisible para la cobertura y ninguna de sus entregas acredita a nadie.
 */
export async function setEppFamilyTypeAction(familyId: string, eppTypeId: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  if (!familyId || !eppTypeId) return { ok: false, message: "Familia y tipo son requeridos" }

  const family = await db.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.id, familyId) })
  if (!family) return { ok: false, message: "Familia no encontrada" }

  // La FK protegía la integridad, pero el 23503 escapaba crudo: el cliente sólo
  // tiene `.then/.finally`, así que la promesa rechazada dejaba el toast sin
  // emitir y el usuario sin saber qué pasó.
  const type = await db.query.eppTypes.findFirst({ where: eq(eppTypes.id, eppTypeId) })
  if (!type) return { ok: false, message: "El tipo de EPP indicado no existe" }

  try {
    await db.update(eppProductFamilies)
      .set({ eppTypeId, updatedAt: new Date().toISOString() })
      .where(eq(eppProductFamilies.id, familyId))

    await recordAudit({
      userId: session.user.id, userEmail: session.user.email ?? undefined,
      action: "update", entityType: "epp_product_family", entityId: familyId,
      entityCode: family.canonicalName,
      oldState: { eppTypeId: family.eppTypeId }, newState: { eppTypeId },
    })
  } catch (e) {
    logger.error("[admin/epps] setEppFamilyTypeAction", e)
    return { ok: false, message: safeActionMessage(e, "No se pudo actualizar el tipo") }
  }

  revalidatePath("/admin/epps")
  return { ok: true, message: "Tipo de EPP actualizado" }
}

/**
 * Fusiona dos familias: los productos de `sourceId` pasan a `targetId` y la
 * familia de origen se elimina.
 *
 * Existe porque `updateEppFamilyAction` ya instruía "fusiónalas" al chocar la
 * identidad, y la única forma de hacerlo era `scripts/normalize-epp-families.ts`
 * desde la CLI — un mensaje de error que pedía una acción que la UI no ofrecía.
 *
 * La ficha del destino se completa con la del origen **sólo en los campos que el
 * destino tiene vacíos**: fusionar no debe reescribir en silencio un dato que
 * alguien ya revisó, pero perder el único dato disponible tampoco sirve.
 */
export async function mergeEppFamiliesAction(sourceId: string, targetId: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  if (!sourceId || !targetId) return { ok: false, message: "Familia de origen y destino son requeridas" }
  if (sourceId === targetId) return { ok: false, message: "No se puede fusionar una familia con la misma familia" }

  try {
    const merged = await db.transaction(async (tx) => {
      const [source, target] = await Promise.all([
        tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.id, sourceId) }),
        tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.id, targetId) }),
      ])
      if (!source) throw new EppFamilyValidationError("sourceId", "La familia de origen no existe.")
      if (!target) throw new EppFamilyValidationError("targetId", "La familia de destino no existe.")

      const inherited: Partial<typeof eppProductFamilies.$inferInsert> = {}
      if (!target.eppTypeId       && source.eppTypeId)       inherited.eppTypeId = source.eppTypeId
      if (!target.brand           && source.brand)           inherited.brand = source.brand
      if (!target.model           && source.model)           inherited.model = source.model
      if (!target.certification   && source.certification)   inherited.certification = source.certification
      if (target.lifespanMonths == null && source.lifespanMonths != null) inherited.lifespanMonths = source.lifespanMonths
      if (!target.lifespanNotApplicable && source.lifespanNotApplicable)  inherited.lifespanNotApplicable = true
      if (!target.pictogramUrl    && source.pictogramUrl)    inherited.pictogramUrl = source.pictogramUrl

      await tx.update(products).set({ familyId: targetId, updatedAt: new Date().toISOString() })
        .where(eq(products.familyId, sourceId))

      // La FK de `preferred_family_id` es ON DELETE SET NULL: sin repuntarla, el
      // borrado del origen descartaría en silencio la familia sugerida que
      // alguien eligió en el requisito de Prevención.
      await tx.update(preventionEppRequirements).set({ preferredFamilyId: targetId })
        .where(eq(preventionEppRequirements.preferredFamilyId, sourceId))

      if (Object.keys(inherited).length > 0) {
        await tx.update(eppProductFamilies)
          .set({ ...inherited, updatedAt: new Date().toISOString() })
          .where(eq(eppProductFamilies.id, targetId))
      }

      await tx.delete(eppProductFamilies).where(eq(eppProductFamilies.id, sourceId))

      await recordAudit({
        userId: session.user.id, userEmail: session.user.email ?? undefined,
        action: "delete", entityType: "epp_product_family", entityId: sourceId,
        entityCode: source.canonicalName,
        oldState: { canonicalName: source.canonicalName, identityKey: source.identityKey },
        newState: { mergedInto: targetId, mergedIntoName: target.canonicalName, inherited },
      }, tx)

      return { sourceName: source.canonicalName, targetName: target.canonicalName }
    })

    revalidatePath("/admin/epps")
    return { ok: true, message: `«${merged.sourceName}» se fusionó en «${merged.targetName}»` }
  } catch (e) {
    if (e instanceof EppFamilyValidationError) return { ok: false, message: e.message }
    logger.error("[admin/epps] mergeEppFamiliesAction", e)
    return { ok: false, message: safeActionMessage(e, "No se pudo fusionar la familia") }
  }
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
    id:                    formData.get("id"),
    canonicalName:         formData.get("canonicalName"),
    categoryId:            formData.get("categoryId"),
    brand:                 formData.get("brand") || undefined,
    model:                 formData.get("model") || undefined,
    certification:         formData.get("certification") || undefined,
    lifespanMonths:        formData.get("lifespanMonths") || undefined,
    lifespanNotApplicable: formData.get("lifespanNotApplicable") || undefined,
    pictogramUrl:          formData.get("pictogramUrl") || undefined,
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

      // La categoría destino tiene que existir: `identityKey` se arma con su
      // nombre, así que un id inválido produciría una clave con la categoría en
      // blanco y podría chocar con otra familia por accidente.
      const category = await tx.query.productCategories.findFirst({
        where: eq(productCategories.id, d.categoryId),
      })
      if (!category) throw new EppFamilyValidationError("categoryId", "La categoría indicada no existe.")

      const brand = d.brand ?? null
      const model = d.model ?? null
      // Con los valores NUEVOS: el nombre y la categoría ahora son editables y
      // alimentan la clave igual que marca y modelo.
      const identityKey = buildEppFamilyIdentityKey({
        categoryName:  category.name,
        canonicalName: d.canonicalName,
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
        canonicalName: d.canonicalName,
        categoryId:    d.categoryId,
        brand, model,
        certification:  d.certification ?? null,
        lifespanMonths: d.lifespanMonths ?? null,
        lifespanNotApplicable: d.lifespanNotApplicable,
        pictogramUrl:   d.pictogramUrl || null,
        identityKey,
        updatedAt: new Date().toISOString(),
      }).where(eq(eppProductFamilies.id, d.id))

      await recordAudit({
        userId: session.user.id, userEmail: session.user.email ?? undefined,
        action: "update", entityType: "epp_product_family", entityId: d.id,
        entityCode: family.canonicalName,
        oldState: {
          canonicalName: family.canonicalName, categoryId: family.categoryId,
          brand: family.brand, model: family.model,
          certification: family.certification, lifespanMonths: family.lifespanMonths,
          lifespanNotApplicable: family.lifespanNotApplicable,
          pictogramUrl: family.pictogramUrl,
        },
        newState: {
          canonicalName: d.canonicalName, categoryId: d.categoryId,
          brand, model, certification: d.certification ?? null,
          lifespanMonths: d.lifespanMonths ?? null,
          lifespanNotApplicable: d.lifespanNotApplicable,
          pictogramUrl: d.pictogramUrl || null,
        },
      }, tx)  // con `tx`: el audit se revierte con el cambio, y sin él un
              // driver de conexión única se autobloquea dentro de la transacción
    })
  } catch (e) {
    if (e instanceof EppFamilyIdentityCollision) {
      return { ok: false, fieldErrors: { canonicalName: [`Ya existe la familia «${e.familyName}» con ese nombre, marca y modelo. Fusiónalas desde el listado o cambia el modelo.`] } }
    }
    if (e instanceof EppFamilyValidationError) {
      return { ok: false, fieldErrors: { [e.field]: [e.message] } }
    }
    logger.error("[admin/epps] updateEppFamilyAction", e)
    return { ok: false, message: safeActionMessage(e, "No se pudo guardar la familia") }
  }

  revalidatePath("/admin/epps")
  return { ok: true, message: "Familia actualizada" }
}
