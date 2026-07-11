"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { workers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { parseCatalogWorkbook } from "@/lib/services/catalog-import"
import { workerSchema, type ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/trabajadores"

export async function createWorker(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:workers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = workerSchema.safeParse({
    firstName:  formData.get("firstName"),
    lastName:   formData.get("lastName"),
    rut:        formData.get("rut") || undefined,
    position:   formData.get("position") || undefined,
    worksiteId: formData.get("worksiteId"),
    isActive:   formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  if (!canAccessWorksite(session, d.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  if (d.rut) {
    const rutConflict = await db.query.workers.findFirst({ where: eq(workers.rut, d.rut) })
    if (rutConflict) return { ok: false, fieldErrors: { rut: ["Este RUT ya está registrado"] } }
  }

  const id = nanoid()
  await db.insert(workers).values({
    id,
    rut:        d.rut ?? null,
    firstName:  d.firstName,
    lastName:   d.lastName,
    position:   d.position  ?? null,
    worksiteId: d.worksiteId,
    isActive:   d.isActive,
  })

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "create",
    entityType: "worker",
    entityId:   id,
    newState:   { firstName: d.firstName, lastName: d.lastName, rut: d.rut },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Trabajador ${d.firstName} ${d.lastName} creado` }
}

export async function updateWorker(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:workers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = workerSchema.safeParse({
    id:         formData.get("id"),
    firstName:  formData.get("firstName"),
    lastName:   formData.get("lastName"),
    rut:        formData.get("rut") || undefined,
    position:   formData.get("position") || undefined,
    worksiteId: formData.get("worksiteId"),
    isActive:   formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }

  if (d.rut) {
    const conflict = await db.query.workers.findFirst({ where: eq(workers.rut, d.rut) })
    if (conflict && conflict.id !== d.id) return { ok: false, fieldErrors: { rut: ["Este RUT ya está registrado"] } }
  }

  const current = await db.query.workers.findFirst({ where: eq(workers.id, d.id) })
  if (!current) return { ok: false, message: "Trabajador no encontrado" }
  if (!canAccessWorksite(session, current.worksiteId) || !canAccessWorksite(session, d.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  await db.update(workers).set({
    rut:        d.rut ?? null,
    firstName:  d.firstName,
    lastName:   d.lastName,
    position:   d.position ?? null,
    worksiteId: d.worksiteId,
    isActive:   d.isActive,
  }).where(eq(workers.id, d.id))

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "worker",
    entityId:   d.id,
    oldState:   { firstName: current.firstName, lastName: current.lastName },
    newState:   { firstName: d.firstName, lastName: d.lastName, rut: d.rut },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Trabajador ${d.firstName} ${d.lastName} actualizado` }
}

export async function toggleWorkerActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:workers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id       = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return { ok: false, message: "ID requerido" }

  const current = await db.query.workers.findFirst({ where: eq(workers.id, id) })
  if (!current) return { ok: false, message: "Trabajador no encontrado" }
  if (!canAccessWorksite(session, current.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de este trabajador" }
  }

  await db.update(workers).set({ isActive: activate }).where(eq(workers.id, id))

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "worker",
    entityId:   id,
    oldState:   { isActive: !activate },
    newState:   { isActive: activate },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? "Trabajador activado" : "Trabajador desactivado" }
}

export async function importWorkersFromXlsx(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:workers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, fieldErrors: { file: ["Selecciona un archivo XLSX"] } }
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, fieldErrors: { file: ["El archivo debe estar en formato .xlsx"] } }

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await parseCatalogWorkbook(buffer)
  if (!result.ok) return { ok: false, message: result.errors.join("; ") }

  let created = 0; let updated = 0; let skipped = 0

  try {
    await db.transaction(async (tx) => {
      for (const row of result.rows) {
        const v = row.values
        const firstName = (v["Nombre"] ?? "").trim()
        const lastName = (v["Apellido"] ?? "").trim()
        if (!firstName && !lastName) { skipped++; continue }
        const isActive = v["Activo"]?.trim() !== "No"

        if (row.decision === "update" && row.existingId) {
          updated++
          await tx.update(workers).set({
            rut: (v["RUT"] ?? "").trim() || null,
            firstName, lastName,
            position: (v["Cargo"] ?? "").trim() || null,
            supervisor: (v["Supervisor"] ?? "").trim() || null,
            prevencionista: (v["Prevencionista"] ?? "").trim() || null,
            isActive,
          }).where(eq(workers.id, row.existingId!))
        } else {
          created++
          await tx.insert(workers).values({
            id: nanoid(), rut: (v["RUT"] ?? "").trim() || null,
            firstName, lastName,
            position: (v["Cargo"] ?? "").trim() || null,
            supervisor: (v["Supervisor"] ?? "").trim() || null,
            prevencionista: (v["Prevencionista"] ?? "").trim() || null,
            worksiteId: session.user.primaryWorksiteId || "ws-default",
            isActive,
            createdAt: new Date().toISOString(),
          })
        }
      }
    })
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "worker", entityId: "import_xlsx", newState: { created, updated, skipped } })
    revalidatePath(REVALIDATE)
    return { ok: true, message: `Importados: ${created} creados, ${updated} actualizados, ${skipped} omitidos`, data: { created, updated, skipped } }
  } catch (err) {
    logger.error("[admin/trabajadores] importXlsx", err)
    return { ok: false, message: (err as Error).message }
  }
}
