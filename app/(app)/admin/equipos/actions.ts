"use server"

import { revalidatePath } from "next/cache"
import { and, eq, ne } from "drizzle-orm"
import { db } from "@/db"
import { serviceEquipment } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { serviceEquipmentSchema, type ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/equipos"

/**
 * El registro es dato maestro propio: quien mantiene el parque de instrumentos
 * no es necesariamente quien mantiene el catálogo de productos. Lo tiene
 * `jefe_mantencion`, que es quien los manda a calibrar, además de
 * administración y secretaría.
 */
const PERMISSION = "admin:service_equipment" as const

function parse(formData: FormData) {
  return serviceEquipmentSchema.safeParse({
    id:           formData.get("id") || undefined,
    code:         formData.get("code"),
    name:         formData.get("name"),
    kind:         formData.get("kind"),
    brand:        formData.get("brand") || undefined,
    model:        formData.get("model") || undefined,
    serialNumber: formData.get("serialNumber") || undefined,
    worksiteId:   formData.get("worksiteId"),
    notes:        formData.get("notes") || undefined,
    isActive:     formData.get("isActive") === "on",
  })
}

/** El código interno identifica al equipo; repetirlo haría inútil el registro. */
async function codeTaken(code: string, exceptId?: string): Promise<boolean> {
  const conflict = await db.query.serviceEquipment.findFirst({
    where: exceptId
      ? and(eq(serviceEquipment.code, code), ne(serviceEquipment.id, exceptId))
      : eq(serviceEquipment.code, code),
  })
  return !!conflict
}

export async function createServiceEquipment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission(PERMISSION) }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = parse(formData)
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  if (await codeTaken(d.code)) {
    return { ok: false, fieldErrors: { code: ["Ese código interno ya está registrado"] } }
  }

  const id = nanoid()
  await db.insert(serviceEquipment).values({
    id, code: d.code, name: d.name, kind: d.kind,
    brand: d.brand || null, model: d.model || null, serialNumber: d.serialNumber || null,
    worksiteId: d.worksiteId, notes: d.notes || null, isActive: d.isActive,
  })

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "create", entityType: "service_equipment", entityId: id, entityCode: d.code,
    newState: { code: d.code, name: d.name, kind: d.kind, worksiteId: d.worksiteId },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Equipo ${d.code} creado` }
}

export async function updateServiceEquipment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission(PERMISSION) }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = parse(formData)
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }

  const previous = await db.query.serviceEquipment.findFirst({ where: eq(serviceEquipment.id, d.id) })
  if (!previous) return { ok: false, message: "Equipo no encontrado" }

  if (await codeTaken(d.code, d.id)) {
    return { ok: false, fieldErrors: { code: ["Ese código interno ya está registrado"] } }
  }

  await db.update(serviceEquipment).set({
    code: d.code, name: d.name, kind: d.kind,
    brand: d.brand || null, model: d.model || null, serialNumber: d.serialNumber || null,
    worksiteId: d.worksiteId, notes: d.notes || null, isActive: d.isActive,
    updatedAt: new Date().toISOString(),
  }).where(eq(serviceEquipment.id, d.id))

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "update", entityType: "service_equipment", entityId: d.id, entityCode: d.code,
    oldState: { code: previous.code, kind: previous.kind, worksiteId: previous.worksiteId, isActive: previous.isActive },
    newState: { code: d.code, kind: d.kind, worksiteId: d.worksiteId, isActive: d.isActive },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Equipo ${d.code} actualizado` }
}

/**
 * Baja lógica y no borrado: las solicitudes históricas apuntan al equipo por FK,
 * y su historial de mantenciones es justamente lo que este registro conserva.
 */
export async function toggleServiceEquipmentActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission(PERMISSION) }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return { ok: false, message: "ID requerido" }

  await db.update(serviceEquipment)
    .set({ isActive: activate, updatedAt: new Date().toISOString() })
    .where(eq(serviceEquipment.id, id))

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "update", entityType: "service_equipment", entityId: id,
    oldState: { isActive: !activate }, newState: { isActive: activate },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? "Equipo activado" : "Equipo dado de baja" }
}
