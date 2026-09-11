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
import {
  recordWorkerPositionChange,
  resolveWorkerPosition,
  WorkerPositionDomainError,
} from "@/lib/services/worker-positions"
import { normalizeWorkerPositionKey } from "@/lib/services/worker-positions/normalization"
import { workerSchema, type ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/trabajadores"

/** Identifica un cargo del XLSX por lo que de verdad decide su identidad: el
 *  código explícito y la clave normalizada del nombre — la misma sobre la que
 *  el trigger de unicidad toma su lock. Ordenar por ella hace determinista el
 *  orden de bloqueo de toda la importación. */
function positionCacheKey(code: string | undefined, name: string | undefined): string {
  return `${normalizeWorkerPositionKey(name ?? "")}|${(code ?? "").trim().toUpperCase()}`
}

export async function createWorker(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:workers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = workerSchema.safeParse({
    firstName:  formData.get("firstName"),
    lastName:   formData.get("lastName"),
    rut:        formData.get("rut") || undefined,
    positionId: formData.get("positionId") || undefined,
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
  let events: WorkerLifecycleEvent[] = []
  let positionName = "Sin clasificar"
  try {
    await db.transaction(async (tx) => {
      const resolved = await resolveWorkerPosition({ id: d.positionId, name: d.position }, {}, tx)
      positionName = resolved.position.name
      const inserted = await insertWorker({
        id,
        rut:        d.rut ?? null,
        firstName:  d.firstName,
        lastName:   d.lastName,
        positionId: resolved.position.id,
        position:   resolved.position.name,
        worksiteId: d.worksiteId,
        isActive:   d.isActive,
        sizeTop:    d.sizeTop || null,
        sizeBottom: d.sizeBottom || null,
        sizeShoe:   d.sizeShoe || null,
        sizeGloves: d.sizeGloves || null,
        sizeHelmet: d.sizeHelmet || null,
      }, tx)
      events = inserted.events
      await recordWorkerPositionChange({
        workerId: id,
        nextPosition: resolved.position,
        source: "admin",
        reason: "Cargo asignado al crear el trabajador",
        actorUserId: session.user.id,
      }, tx)
    })
  } catch (err) {
    if (err instanceof WorkerPositionDomainError) {
      return { ok: false, fieldErrors: { positionId: [err.message], position: [err.message] } }
    }
    throw err
  }

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "create",
    entityType: "worker",
    entityId:   id,
    newState:   { firstName: d.firstName, lastName: d.lastName, rut: d.rut, position: positionName },
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
    positionId: formData.get("positionId") || undefined,
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

  let events: WorkerLifecycleEvent[] = []
  let positionName = current.position ?? "Sin clasificar"
  try {
    await db.transaction(async (tx) => {
      const resolved = await resolveWorkerPosition({ id: d.positionId, name: d.position }, {}, tx)
      positionName = resolved.position.name
      const updated = await updateWorkerFields(d.id!, {
        rut:        d.rut ?? null,
        firstName:  d.firstName,
        lastName:   d.lastName,
        positionId: resolved.position.id,
        position:   resolved.position.name,
        worksiteId: d.worksiteId,
        isActive:   d.isActive,
        sizeTop:    d.sizeTop || null,
        sizeBottom: d.sizeBottom || null,
        sizeShoe:   d.sizeShoe || null,
        sizeGloves: d.sizeGloves || null,
        sizeHelmet: d.sizeHelmet || null,
      }, current, tx)
      events = updated.events
      await recordWorkerPositionChange({
        workerId: d.id!,
        previousPositionId: current.positionId,
        previousPositionLabel: current.position,
        nextPosition: resolved.position,
        source: "admin",
        reason: "Cargo actualizado desde la ficha del trabajador",
        actorUserId: session.user.id,
      }, tx)
    })
  } catch (err) {
    if (err instanceof WorkerPositionDomainError) {
      return { ok: false, fieldErrors: { positionId: [err.message], position: [err.message] } }
    }
    throw err
  }

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "worker",
    entityId:   d.id,
    oldState:   { firstName: current.firstName, lastName: current.lastName, position: current.position },
    newState:   { firstName: d.firstName, lastName: d.lastName, rut: d.rut, position: positionName },
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
  const createdPositionIds = new Set<string>()
  const pendingPositionNames = new Set<string>()
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
            columns: { id: true, worksiteId: true, isActive: true, positionId: true, position: true },
            where: and(inArray(workers.id, updateIds), worksiteScopeSql(session, workers.worksiteId)),
          })
        : []
      const visibleWorkerIds = new Set(visibleWorkers.map((worker) => worker.id))
      const stateBefore = new Map(visibleWorkers.map((worker) => [worker.id, { worksiteId: worker.worksiteId, isActive: worker.isActive }]))
      const positionBefore = new Map(visibleWorkers.map((worker) => [worker.id, {
        positionId: worker.positionId,
        position: worker.position,
      }]))

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

      // Los cargos se resuelven antes del bucle y en orden estable de clave
      // normalizada. Crear un cargo toma un advisory lock sobre esa clave que
      // dura hasta el commit, así que dos importaciones simultáneas que
      // introdujeran cargos nuevos en orden distinto podían quedar en deadlock
      // y perder la importación entera. Con un orden común no hay ciclo posible.
      const positionInputs = new Map<string, { code?: string; name?: string }>()
      for (const row of result.rows) {
        const v = row.values
        if (!(v["Nombre"] ?? "").trim() && !(v["Apellido"] ?? "").trim()) continue
        const code = v["Código cargo"] ?? v["Codigo cargo"]
        const name = v["Cargo"]
        positionInputs.set(positionCacheKey(code, name), { code, name })
      }
      const resolvedPositions = new Map<string, Awaited<ReturnType<typeof resolveWorkerPosition>>>()
      for (const key of [...positionInputs.keys()].sort()) {
        const resolved = await resolveWorkerPosition(positionInputs.get(key)!, {}, tx)
        resolvedPositions.set(key, resolved)
        if (resolved.created) {
          createdPositionIds.add(resolved.position.id)
          pendingPositionNames.add(resolved.position.name)
        }
      }

      for (const row of result.rows) {
        const v = row.values
        const firstName = (v["Nombre"] ?? "").trim()
        const lastName = (v["Apellido"] ?? "").trim()
        if (!firstName && !lastName) { skipped++; continue }
        const isActive = v["Activo"]?.trim() !== "No"
        const resolvedPosition = resolvedPositions.get(positionCacheKey(v["Código cargo"] ?? v["Codigo cargo"], v["Cargo"]))!

        if (row.decision === "update" && row.existingId) {
          const changed = await tx.update(workers).set({
            rut: (v["RUT"] ?? "").trim() || null,
            firstName, lastName,
            positionId: resolvedPosition.position.id,
            position: resolvedPosition.position.name,
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
          const previousPosition = positionBefore.get(row.existingId)
          await recordWorkerPositionChange({
            workerId: row.existingId,
            previousPositionId: previousPosition?.positionId,
            previousPositionLabel: previousPosition?.position,
            nextPosition: resolvedPosition.position,
            source: "import",
            reason: `Cargo importado desde fila ${row.rowNumber}`,
            actorUserId: session.user.id,
          }, tx)
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
            positionId: resolvedPosition.position.id,
            position: resolvedPosition.position.name,
            supervisor: (v["Supervisor"] ?? "").trim() || null,
            prevencionista: (v["Prevencionista"] ?? "").trim() || null,
            worksiteId,
            isActive,
            createdAt: new Date().toISOString(),
          })
          await recordWorkerPositionChange({
            workerId: newId,
            nextPosition: resolvedPosition.position,
            source: "import",
            reason: `Cargo asignado desde fila ${row.rowNumber}`,
            actorUserId: session.user.id,
          }, tx)
        }
      }
    })
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "worker", entityId: "import_xlsx", newState: { created, updated, skipped } })
    await notifyDotacionChange(importLifecycleEvents(lifecyclePairs), session.user.id)
    revalidatePath(REVALIDATE)
    const reviewSuffix = pendingPositionNames.size > 0
      ? `. Cargos nuevos pendientes de revisión: ${[...pendingPositionNames].join(", ")}`
      : ""
    return {
      ok: true,
      message: `Importados: ${created} creados, ${updated} actualizados, ${skipped} omitidos${reviewSuffix}`,
      data: {
        created,
        updated,
        skipped,
        positionsCreated: createdPositionIds.size,
        pendingPositionNames: [...pendingPositionNames],
      },
    }
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
