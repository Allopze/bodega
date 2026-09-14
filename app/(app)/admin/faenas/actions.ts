"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { can, canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { worksiteSchema, type ActionState } from "@/lib/validation/masters"
import { setWorksiteActive } from "@/lib/services/worksite-lifecycle"
import { ensurePreventionTrainingOccurrencesForWorksiteTx } from "@/lib/services/prevention-training-occurrences"

const REVALIDATE = "/admin/faenas"

// ── Worksites ─────────────────────────────────────────────────────────────────

export async function createWorksite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { return { ok: false, message: "Sin permisos" } }
  if (resolveWorksiteScope(session).mode !== "all") {
    return { ok: false, message: "Solo usuarios con alcance global pueden crear faenas" }
  }

  const parsed = worksiteSchema.safeParse({
    name:     formData.get("name"),
    code:     formData.get("code"),
    address:  formData.get("address") || undefined,
    region:   formData.get("region")  || undefined,
    adminContratoLabel: formData.get("adminContratoLabel") || undefined,
    isActive: formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  // Code uniqueness
  const exists = await db.query.worksites.findFirst({ where: eq(worksites.code, d.code) })
  if (exists) return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }

  const id = nanoid()
  try {
    await db.transaction(async (tx) => {
      await tx.insert(worksites).values({ id, name: d.name, code: d.code, address: d.address ?? null, region: d.region ?? null, adminContratoLabel: d.adminContratoLabel || null, isActive: d.isActive })
      if (d.isActive) await ensurePreventionTrainingOccurrencesForWorksiteTx(tx, id)
      await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "worksite", entityId: id, entityCode: d.code, newState: { name: d.name, code: d.code, isActive: d.isActive } }, tx)
    })
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo crear la faena") }
  }

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Faena ${d.name} creada` }
}

export async function updateWorksite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = worksiteSchema.safeParse({
    id:       formData.get("id"),
    name:     formData.get("name"),
    code:     formData.get("code"),
    address:  formData.get("address") || undefined,
    region:   formData.get("region")  || undefined,
    adminContratoLabel: formData.get("adminContratoLabel") || undefined,
    isActive: formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }

  const conflict = await db.query.worksites.findFirst({ where: eq(worksites.code, d.code) })
  if (conflict && conflict.id !== d.id) return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }

  const current = await db.query.worksites.findFirst({ where: eq(worksites.id, d.id) })
  if (!current) return { ok: false, message: "Faena no encontrada" }
  if (!canAccessWorksite(session, current.id)) {
    return { ok: false, message: "No tienes acceso a esta faena" }
  }

  await db.update(worksites).set({ name: d.name, code: d.code, address: d.address ?? null, region: d.region ?? null, adminContratoLabel: d.adminContratoLabel || null, updatedAt: new Date().toISOString() }).where(eq(worksites.id, d.id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "worksite", entityId: d.id, entityCode: d.code, oldState: { name: current.name }, newState: { name: d.name } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Faena ${d.name} actualizada` }
}

export async function toggleWorksiteActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id       = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return { ok: false, message: "ID requerido" }

  // Cerrar una faena no puede dejar hallazgos abiertos sin dueño: sus acciones
  // correctivas y obligaciones pendientes se cancelan con el motivo del cierre,
  // que queda escrito en cada una. Por eso el motivo es obligatorio al
  // desactivar (y su largo mínimo lo exigen los CHECK de las dos tablas).
  const motivo = ((formData.get("motivo") as string | null) ?? "").trim()
  if (!activate && motivo.length < 10) {
    return { ok: false, message: "Indica el motivo del cierre de faena (mínimo 10 caracteres)." }
  }
  const current = await db.query.worksites.findFirst({ where: eq(worksites.id, id) })
  if (!current) return { ok: false, message: "Faena no encontrada" }
  if (!canAccessWorksite(session, current.id)) {
    return { ok: false, message: "No tienes acceso a esta faena" }
  }

  // Devolver el saldo mueve inventario real: administrar faenas no lo autoriza
  // por sí solo. Quien no tenga el permiso de bodega vacía la faena por el
  // camino normal y después la cierra.
  const returnStockToOffice = !activate && formData.get("returnStock") === "on"
  if (returnStockToOffice && !can(session, "warehouse:adjust_stock")) {
    return { ok: false, message: "Sin permisos para mover inventario: pide a bodega que vacíe la faena antes de cerrarla" }
  }

  // El servicio rechaza con mensaje accionable (saldo en bodega, fuera de
  // alcance): sin este catch el throw revienta la server action y el usuario ve
  // el error genérico de Next en vez del motivo.
  let result
  try {
    result = await setWorksiteActive({
      worksiteId: id,
      activate,
      reason: motivo,
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? undefined,
      scope: resolveWorksiteScope(session),
      returnStockToOffice,
    })
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "No se pudo cambiar el estado de la faena") }
  }

  revalidatePath(REVALIDATE)
  revalidatePath("/prevencion/pdtp")
  if (!activate) {
    revalidatePath("/prevencion/capa")
    if (result.stockReturned) revalidatePath("/bodega")
    const partes = [
      result.stockReturned
        ? `${result.stockReturned.products} producto(s) devueltos a ${result.stockReturned.officeName}`
        : null,
      result.programsDropped > 0 ? `retirada de ${result.programsDropped} programa(s)` : null,
      result.capaCancelled > 0 ? `${result.capaCancelled} CAPA cancelada(s)` : null,
      result.obligationsCancelled > 0 ? `${result.obligationsCancelled} obligación(es) cancelada(s)` : null,
    ].filter(Boolean)
    return {
      ok: true,
      message: partes.length > 0 ? `Faena desactivada: ${partes.join(", ")}.` : "Faena desactivada",
    }
  }
  return { ok: true, message: "Faena activada" }
}
