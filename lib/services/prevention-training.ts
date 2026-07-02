/**
 * lib/services/prevention-training.ts
 * Capacitaciones, competencias y vencimientos.
 *
 *   - El catálogo de cursos es único (no se particiona por faena).
 *   - La asignación une (course, worker, worksite) con un upsert idempotente sobre
 *     (workerId, courseId): re-asignar actualiza los campos en lugar de duplicar.
 *   - `listExpiredTrainings(scope, today)` devuelve asignaciones con `expiresAt`
 *     anterior o igual a la fecha indicada, dentro del scope del usuario.
 */

import { and, desc, eq, inArray, lte } from "drizzle-orm"
import { db } from "@/db"
import { trainingCourses, workerTrainingAssignments, workers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { trainingAssignSchema, trainingCourseCreateSchema } from "@/lib/validation/prevention"

export type WorksiteScope = string[] | "all"

export function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) {
    throw new Error("Capacitacion no encontrada o sin acceso.")
  }
}

async function assertWorkerBelongsToWorksite(workerId: string, worksiteId: string): Promise<void> {
  const [worker] = await db.select({ worksiteId: workers.worksiteId })
    .from(workers)
    .where(eq(workers.id, workerId))
    .limit(1)
  if (!worker || worker.worksiteId !== worksiteId) {
    throw new Error("El trabajador no pertenece a la faena seleccionada.")
  }
}

export async function createTrainingCourse(input: unknown, userId: string) {
  const data = trainingCourseCreateSchema.parse(input)
  const now = new Date().toISOString()
  const id = nanoid()

  await db.insert(trainingCourses).values({
    id,
    code: data.code,
    name: data.name,
    validityMonths: data.validityMonths ?? null,
    requiredForCargo: data.requiredForCargo,
    isActive: true,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(trainingCourses).where(eq(trainingCourses.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear la capacitacion.")
  return row
}

export async function assignTrainingToWorker(input: unknown, userId: string, scope: WorksiteScope) {
  const data = trainingAssignSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)
  await assertWorkerBelongsToWorksite(data.workerId, data.worksiteId)
  const now = new Date().toISOString()
  const id = nanoid()

  const [row] = await db.insert(workerTrainingAssignments)
    .values({
      id,
      courseId: data.courseId,
      workerId: data.workerId,
      worksiteId: data.worksiteId,
      completedAt: data.completedAt,
      expiresAt: data.expiresAt || null,
      score: data.score ?? null,
      evidenceUrl: data.evidenceUrl || null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workerTrainingAssignments.workerId, workerTrainingAssignments.courseId],
      set: {
        worksiteId: data.worksiteId,
        completedAt: data.completedAt,
        expiresAt: data.expiresAt || null,
        score: data.score ?? null,
        evidenceUrl: data.evidenceUrl || null,
        updatedAt: now,
      },
    })
    .returning()

  if (!row) throw new Error("No se pudo asignar la capacitacion.")
  return row
}

export async function listExpiredTrainings(scope: WorksiteScope, today: string) {
  if (scope !== "all" && scope.length === 0) return []
  const where = and(
    lte(workerTrainingAssignments.expiresAt, today),
    scope === "all" ? undefined : inArray(workerTrainingAssignments.worksiteId, scope),
  )
  return db.select().from(workerTrainingAssignments).where(where).orderBy(desc(workerTrainingAssignments.expiresAt))
}

export async function listTrainingCourses() {
  return db.select().from(trainingCourses).orderBy(trainingCourses.code)
}

/**
 * Construye un XLSX con el catálogo de cursos y las asignaciones del scope.
 *   - Hoja "Cursos": una fila por curso del catálogo.
 *   - Hoja "Asignaciones": una fila por asignación (vigente o vencida).
 */
export async function buildTrainingExport(scope: WorksiteScope): Promise<{
  filenameBase: string
  worksheetName: string
  headers: string[]
  rows: Array<Array<string | number>>
  sheets?: Array<{ worksheetName: string; headers: string[]; rows: Array<Array<string | number>> }>
}> {
  const courses = await listTrainingCourses()
  const where = scope === "all"
    ? undefined
    : inArray(workerTrainingAssignments.worksiteId, scope)
  const assignments = scope === "all" || scope.length > 0
    ? await db.select().from(workerTrainingAssignments).where(where).orderBy(desc(workerTrainingAssignments.expiresAt))
    : []

  const courseById = new Map(courses.map((c) => [c.id, c]))

  const today = new Date().toISOString().slice(0, 10)
  const assignmentRows = assignments.map((a) => {
    const c = courseById.get(a.courseId)
    const expired = a.expiresAt ? a.expiresAt <= today : false
    return [
      c?.code ?? "",
      c?.name ?? "",
      a.worksiteId,
      a.workerId,
      a.completedAt,
      a.expiresAt ?? "",
      expired ? "Vencida" : "Vigente",
      a.score ?? "",
    ] as Array<string | number>
  })

  const courseRows = courses.map((c) => [
    c.code,
    c.name,
    c.validityMonths ?? "",
    (c.requiredForCargo as string[]).join(" | "),
    c.isActive ? "Activo" : "Inactivo",
  ] as Array<string | number>)

  return {
    filenameBase: `capacitaciones_${new Date().toISOString().slice(0, 10)}`,
    worksheetName: "Asignaciones",
    headers: ["Curso código", "Curso nombre", "Faena", "Trabajador", "Realizada", "Vence", "Estado", "Nota"],
    rows: assignmentRows,
    sheets: [
      { worksheetName: "Cursos", headers: ["Código", "Nombre", "Vigencia (meses)", "Cargos requeridos", "Estado"], rows: courseRows },
      { worksheetName: "Asignaciones", headers: ["Curso código", "Curso nombre", "Faena", "Trabajador", "Realizada", "Vence", "Estado", "Nota"], rows: assignmentRows },
    ],
  }
}

export type TrainingMatrixRow = {
  courseId: string
  courseName: string
  cargo: string
  requiredCount: number
  compliantCount: number
}

// Cruce cargo × curso. Un trabajador "cumple" si tiene una asignación al curso
// cuya expiresAt es null (sin vencimiento) o >= today.
export async function getTrainingMatrix(scope: WorksiteScope, today: string): Promise<TrainingMatrixRow[]> {
  const courses = await listTrainingCourses()
  const withCargo = courses.filter((c) => c.isActive && Array.isArray(c.requiredForCargo) && (c.requiredForCargo as string[]).length > 0)
  if (withCargo.length === 0) return []

  const activeWhere = scope === "all"
    ? eq(workers.isActive, true)
    : scope.length === 0
      ? undefined
      : and(eq(workers.isActive, true), inArray(workers.worksiteId, scope))
  if (scope !== "all" && scope.length === 0) return []

  const workerRows = await db.select({ id: workers.id, position: workers.position }).from(workers).where(activeWhere)

  const assignmentWhere = scope === "all"
    ? undefined
    : inArray(workerTrainingAssignments.worksiteId, scope)
  const assignments = await db.select({
    courseId: workerTrainingAssignments.courseId,
    workerId: workerTrainingAssignments.workerId,
    expiresAt: workerTrainingAssignments.expiresAt,
  }).from(workerTrainingAssignments).where(assignmentWhere)

  const compliantByCourse = new Map<string, Set<string>>()
  for (const a of assignments) {
    if (a.expiresAt !== null && a.expiresAt < today) continue
    if (!compliantByCourse.has(a.courseId)) compliantByCourse.set(a.courseId, new Set())
    compliantByCourse.get(a.courseId)!.add(a.workerId)
  }

  const rows: TrainingMatrixRow[] = []
  for (const course of withCargo) {
    for (const cargo of course.requiredForCargo as string[]) {
      const requiredWorkers = workerRows.filter((w) => w.position === cargo)
      if (requiredWorkers.length === 0) continue
      const compliantSet = compliantByCourse.get(course.id) ?? new Set()
      const compliantCount = requiredWorkers.filter((w) => compliantSet.has(w.id)).length
      rows.push({
        courseId: course.id,
        courseName: course.name,
        cargo,
        requiredCount: requiredWorkers.length,
        compliantCount,
      })
    }
  }
  return rows
}
