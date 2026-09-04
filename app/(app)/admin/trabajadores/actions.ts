"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { parseCatalogWorkbook } from "@/lib/services/catalog-import"
import { onWorkerEnteredDotacion } from "@/lib/services/pdtp-adapters/worker-lifecycle-connector"
import { evaluateWorksitePreventiveOrganization } from "@/lib/services/pdtp-adapters/preventive-organization-connector"
import { importLifecycleEvents, insertWorker, setWorkerActive, updateWorkerFields, type WorkerLifecycleEvent } from "@/lib/services/workers"
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
    sizeTop:    formData.get("sizeTop") || undefined,
    sizeBottom: formData.get("sizeBottom") || undefined,
    sizeShoe:   formData.get("sizeShoe") || undefined,
    sizeGloves: formData.get("sizeGloves") || undefined,
    sizeHelmet: formData.get("sizeHelmet") || undefined,
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
  const { events } = await insertWorker({
    id,
    rut:        d.rut ?? null,
    firstName:  d.firstName,
    lastName:   d.lastName,
    position:   d.position  ?? null,
    worksiteId: d.worksiteId,
    isActive:   d.isActive,
    sizeTop:    d.sizeTop || null,
    sizeBottom: d.sizeBottom || null,
    sizeShoe:   d.sizeShoe || null,
    sizeGloves: d.sizeGloves || null,
    sizeHelmet: d.sizeHelmet || null,
  })

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "create",
    entityType: "worker",
    entityId:   id,
    newState:   { firstName: d.firstName, lastName: d.lastName, rut: d.rut },
  })

  await notifyDotacionChange(events, session.user.id)

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
    sizeTop:    formData.get("sizeTop") || undefined,
    sizeBottom: formData.get("sizeBottom") || undefined,
    sizeShoe:   formData.get("sizeShoe") || undefined,
    sizeGloves: formData.get("sizeGloves") || undefined,
    sizeHelmet: formData.get("sizeHelmet") || undefined,
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

  const { events } = await updateWorkerFields(d.id, {
    rut:        d.rut ?? null,
    firstName:  d.firstName,
    lastName:   d.lastName,
    position:   d.position ?? null,
    worksiteId: d.worksiteId,
    isActive:   d.isActive,
    sizeTop:    d.sizeTop || null,
    sizeBottom: d.sizeBottom || null,
    sizeShoe:   d.sizeShoe || null,
    sizeGloves: d.sizeGloves || null,
    sizeHelmet: d.sizeHelmet || null,
  }, current)

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "worker",
    entityId:   d.id,
    oldState:   { firstName: current.firstName, lastName: current.lastName },
    newState:   { firstName: d.firstName, lastName: d.lastName, rut: d.rut },
  })

  await notifyDotacionChange(events, session.user.id)

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

  const { events } = await setWorkerActive(id, activate, current)

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "worker",
    entityId:   id,
    oldState:   { isActive: !activate },
    newState:   { isActive: activate },
  })

  await notifyDotacionChange(events, session.user.id)

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? "Trabajador activado" : "Trabajador desactivado" }
}

export async function importWorkersFromXlsx(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:workers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, fieldErrors: { file: ["Selecciona un archivo Excel"] } }
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, fieldErrors: { file: ["El archivo debe estar en formato .xlsx"] } }

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await parseCatalogWorkbook(buffer)
  if (!result.ok) return { ok: false, message: result.errors.join("; ") }

  let created = 0; let updated = 0; let skipped = 0
  // Estado antes/después de cada fila escrita, para derivar los eventos de
  // entrada a la dotación con la misma regla que el alta manual. Se acumula
  // dentro de la transacción y se consume después del commit.
  const lifecyclePairs: Parameters<typeof importLifecycleEvents>[0][number][] = []

  try {
    await db.transaction(async (tx) => {
      const worksiteScope = worksiteScopeSql(session, worksites.id)
      const visibleWorksites = await tx.query.worksites.findMany({
        columns: { id: true, name: true },
        where: worksiteScope,
      })
      const worksiteByName = new Map(visibleWorksites.map((worksite) => [worksiteMatchKey(worksite.name), worksite.id]))
      const updateIds = result.rows
        .filter((row) => row.decision === "update" && row.existingId)
        .map((row) => row.existingId!)
      const visibleWorkers = updateIds.length > 0
        ? await tx.query.workers.findMany({
            // `worksiteId` e `isActive` viajan además del id para derivar el
            // evento de entrada: una fila que pasa de inactiva a activa es una
            // reincorporación y vuelve a hacer exigible la inducción.
            columns: { id: true, worksiteId: true, isActive: true },
            where: and(inArray(workers.id, updateIds), worksiteScopeSql(session, workers.worksiteId)),
          })
        : []
      const visibleWorkerIds = new Set(visibleWorkers.map((worker) => worker.id))
      const stateBefore = new Map(visibleWorkers.map((worker) => [worker.id, { worksiteId: worker.worksiteId, isActive: worker.isActive }]))

      for (const row of result.rows) {
        if (!row.existingId || row.decision !== "update") continue
        if (!visibleWorkerIds.has(row.existingId)) {
          throw new Error(`Fila ${row.rowNumber}: el trabajador indicado no pertenece a una faena de tu alcance`)
        }
      }

      const destinationByRow = new Map<number, string>()
      for (const row of result.rows) {
        if (row.decision !== "create" || !Object.values(row.values).some(Boolean)) continue
        const worksiteName = (row.values["Faena"] ?? "").trim()
        const worksiteId = worksiteByName.get(worksiteMatchKey(worksiteName))
        if (!worksiteId) {
          throw new Error(`Fila ${row.rowNumber}: indica una faena existente y accesible en la columna "Faena"`)
        }
        destinationByRow.set(row.rowNumber, worksiteId)
      }

      for (const row of result.rows) {
        const v = row.values
        const firstName = (v["Nombre"] ?? "").trim()
        const lastName = (v["Apellido"] ?? "").trim()
        if (!firstName && !lastName) { skipped++; continue }
        const isActive = v["Activo"]?.trim() !== "No"

        if (row.decision === "update" && row.existingId) {
          const changed = await tx.update(workers).set({
            rut: (v["RUT"] ?? "").trim() || null,
            firstName, lastName,
            position: (v["Cargo"] ?? "").trim() || null,
            supervisor: (v["Supervisor"] ?? "").trim() || null,
            prevencionista: (v["Prevencionista"] ?? "").trim() || null,
            isActive,
          }).where(and(eq(workers.id, row.existingId), worksiteScopeSql(session, workers.worksiteId))).returning({ id: workers.id })
          if (changed.length !== 1) {
            throw new Error(`Fila ${row.rowNumber}: el trabajador dejó de pertenecer a una faena de tu alcance`)
          }
          const before = stateBefore.get(row.existingId)
          // La rama de actualización no mueve `worksiteId`, así que la faena de
          // después es la de antes: el único evento posible acá es reincorporar.
          if (before) lifecyclePairs.push({ before, after: { id: row.existingId, worksiteId: before.worksiteId, isActive } })
          updated++
        } else {
          const worksiteId = destinationByRow.get(row.rowNumber)
          if (!worksiteId) throw new Error(`Fila ${row.rowNumber}: falta una faena destino accesible`)
          created++
          const newId = nanoid()
          lifecyclePairs.push({ before: null, after: { id: newId, worksiteId, isActive } })
          await tx.insert(workers).values({
            id: newId, rut: (v["RUT"] ?? "").trim() || null,
            firstName, lastName,
            position: (v["Cargo"] ?? "").trim() || null,
            supervisor: (v["Supervisor"] ?? "").trim() || null,
            prevencionista: (v["Prevencionista"] ?? "").trim() || null,
            worksiteId,
            isActive,
            createdAt: new Date().toISOString(),
          })
        }
      }
    })
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "worker", entityId: "import_xlsx", newState: { created, updated, skipped } })
    await notifyDotacionChange(importLifecycleEvents(lifecyclePairs), session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true, message: `Importados: ${created} creados, ${updated} actualizados, ${skipped} omitidos`, data: { created, updated, skipped } }
  } catch (err) {
    logger.error("[admin/trabajadores] importXlsx", err)
    return { ok: false, message: (err as Error).message }
  }
}

/**
 * Lo que el resto de la plataforma tiene que saber cuando cambia la dotación.
 *
 * Va **después** del commit y nunca propaga su error: el trabajador ya está
 * escrito, y un problema del PDTP no puede deshacerlo ni hacer fallar la
 * pantalla de administración.
 *
 * Dos cosas distintas cuelgan de acá. La entrada de una persona abre su
 * inducción (N°15, N°16, N°52). Y la faena que la recibe puede haber cruzado el
 * umbral de dotación que obliga a constituir comité paritario (N°11): el
 * barrido diario lo detectaría igual, pero evaluarlo acá hace que se note el
 * mismo día en que ocurre.
 */
async function notifyDotacionChange(events: WorkerLifecycleEvent[], userId: string): Promise<void> {
  if (events.length === 0) return
  try {
    await onWorkerEnteredDotacion(events, userId)
    await evaluateWorksitePreventiveOrganization(events.map((event) => event.worksiteId))
  } catch (err) {
    logger.error("[admin/trabajadores] no se pudo registrar el cambio de dotación en el PDTP", err)
  }
}

function worksiteMatchKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
}
