/**
 * lib/services/prevention-containers.ts
 *
 * Catálogo de contenedores por faena.
 *
 * La inspección del Anexo 14 existía desde antes que el padrón: el contenedor
 * se nombraba escribiendo texto libre en `subjectLabel`, así que nadie podía
 * responder qué inspecciones acumulaba un contenedor concreto y dos inspectores
 * escribían la misma unidad con dos nombres distintos. Esta es la ficha que
 * faltaba, y es el sujeto que `prevention-inspections` exige para esa plantilla.
 *
 * Vive en Administración y no en Prevención por el mismo criterio que el
 * inventario de faena: el contenedor existe por la operación, y Prevención sólo
 * lo consume para inspeccionarlo.
 */

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionContainers,
  preventionInspectionPrograms,
  preventionInspectionRuns,
  worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { CONTAINER_STATUSES } from "@/lib/prevention/containers"

export { containerLabel, CONTAINER_STATUS_LABELS, CONTAINER_STATUSES } from "@/lib/prevention/containers"
export type { ContainerStatus } from "@/lib/prevention/containers"

export interface ContainerAccess {
  userId: string
  permissions: readonly string[]
  scope: readonly string[] | "all"
}

const PERMISSION = "admin:containers"

/** Mismo texto para todo lo no encontrado o fuera de permiso: no filtra existencia. */
const NOT_FOUND = "Contenedor no encontrado o fuera de alcance."

function requireAccess(access: ContainerAccess) {
  if (!access.permissions.includes(PERMISSION)) throw new Error(NOT_FOUND)
}

function assertWorksiteScope(access: ContainerAccess, worksiteId: string) {
  if (access.scope !== "all" && !access.scope.includes(worksiteId)) throw new Error(NOT_FOUND)
}

function scopeCondition(access: ContainerAccess) {
  return access.scope === "all"
    ? undefined
    : access.scope.length > 0
      ? inArray(preventionContainers.worksiteId, [...access.scope])
      : sql`false`
}

/* ── Validación ──────────────────────────────────────────────────────────── */

/* El código es la identidad del activo y se compara en mayúsculas: "ct-014" y
 * "CT-014" son el mismo contenedor, y sin normalizar el índice único los
 * dejaría convivir. */
const codeField = z.string().trim().min(2, "El código es obligatorio.").max(60)
  .transform((value) => value.toLocaleUpperCase("es-CL"))

const createSchema = z.object({
  worksiteId: z.string().min(1),
  code: codeField,
  location: z.string().trim().min(2, "La ubicación es obligatoria.").max(300),
  status: z.enum(CONTAINER_STATUSES).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})

const updateSchema = z.object({
  containerId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  worksiteId: z.string().min(1).optional(),
  code: codeField.optional(),
  location: z.string().trim().min(2).max(300).optional(),
  status: z.enum(CONTAINER_STATUSES).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
})

async function assertWorksiteExists(worksiteId: string) {
  const [worksite] = await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(eq(worksites.id, worksiteId)).limit(1)
  if (!worksite) throw new Error("La faena no existe.")
  return worksite
}

/** El código es único global porque el contenedor se traslada entre faenas. */
async function assertCodeAvailable(code: string, exceptId?: string) {
  const [taken] = await db.select({ id: preventionContainers.id })
    .from(preventionContainers)
    .where(exceptId
      ? and(eq(preventionContainers.code, code), ne(preventionContainers.id, exceptId))
      : eq(preventionContainers.code, code))
    .limit(1)
  if (taken) throw new Error(`Ya existe un contenedor con el código ${code}.`)
}

/* ── Consultas ───────────────────────────────────────────────────────────── */

export async function listContainers(access: ContainerAccess) {
  requireAccess(access)
  return db.select({
    container: preventionContainers,
    worksiteName: worksites.name,
    /* Cuántas inspecciones lo tomaron como sujeto. Gobierna si se puede borrar
     * y, sobre todo, le dice a quien mira que esa ficha ya sostiene evidencia. */
    inspectionCount: sql<number>`(
      SELECT COUNT(*)::int FROM prevention_inspection_runs r
      WHERE r.subject_container_id = ${preventionContainers.id}
    )`,
  })
    .from(preventionContainers)
    .innerJoin(worksites, eq(worksites.id, preventionContainers.worksiteId))
    .where(scopeCondition(access))
    .orderBy(asc(preventionContainers.code))
    .limit(1000)
}

/** Faenas donde el usuario puede dar de alta contenedores. */
export async function listWorksitesForContainers(access: ContainerAccess) {
  requireAccess(access)
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(access.scope === "all"
      ? eq(worksites.isActive, true)
      : access.scope.length > 0
        ? and(eq(worksites.isActive, true), inArray(worksites.id, [...access.scope]))
        : sql`false`)
    .orderBy(asc(worksites.name))
}

/**
 * Contenedores inspeccionables de una faena.
 *
 * Sin guardia de permisos a propósito: la llaman los selectores de sujeto de
 * Prevención y de PDTP, que ya validaron su propio permiso sobre la faena.
 * Mismo criterio que `listWorksiteVehicles` para la flota.
 */
export async function listContainersForWorksite(worksiteId: string) {
  return db.select({
    id: preventionContainers.id,
    code: preventionContainers.code,
    location: preventionContainers.location,
    status: preventionContainers.status,
  })
    .from(preventionContainers)
    .where(and(
      eq(preventionContainers.worksiteId, worksiteId),
      eq(preventionContainers.isActive, true),
    ))
    .orderBy(asc(preventionContainers.code))
    .limit(500)
}

/** Igual que la anterior, en lote: evita una consulta por faena en las bandejas. */
export async function listContainersByWorksite(worksiteIds: string[]) {
  if (worksiteIds.length === 0) return {} as Record<string, Awaited<ReturnType<typeof listContainersForWorksite>>>
  const rows = await db.select({
    id: preventionContainers.id,
    worksiteId: preventionContainers.worksiteId,
    code: preventionContainers.code,
    location: preventionContainers.location,
    status: preventionContainers.status,
  })
    .from(preventionContainers)
    .where(and(
      inArray(preventionContainers.worksiteId, worksiteIds),
      eq(preventionContainers.isActive, true),
    ))
    .orderBy(asc(preventionContainers.code))
    .limit(2000)

  const grouped: Record<string, { id: string; code: string; location: string; status: string }[]> = {}
  for (const worksiteId of worksiteIds) grouped[worksiteId] = []
  for (const row of rows) {
    grouped[row.worksiteId] ??= []
    grouped[row.worksiteId]!.push({ id: row.id, code: row.code, location: row.location, status: row.status })
  }
  return grouped
}

export async function getContainerDetail(containerId: string, access: ContainerAccess) {
  requireAccess(access)
  const [row] = await db.select({ container: preventionContainers, worksiteName: worksites.name })
    .from(preventionContainers)
    .innerJoin(worksites, eq(worksites.id, preventionContainers.worksiteId))
    .where(eq(preventionContainers.id, containerId))
    .limit(1)
  if (!row) throw new Error(NOT_FOUND)
  assertWorksiteScope(access, row.container.worksiteId)

  /* La etiqueta congelada se muestra tal cual quedó: si el contenedor se
   * renombró o se movió después, la inspección sigue diciendo lo que decía. */
  const inspections = await db.select({
    id: preventionInspectionRuns.id,
    code: preventionInspectionRuns.code,
    status: preventionInspectionRuns.status,
    subjectLabel: preventionInspectionRuns.subjectLabel,
    executedAt: preventionInspectionRuns.executedAt,
    compliancePercent: preventionInspectionRuns.compliancePercent,
    nonConformingCount: preventionInspectionRuns.nonConformingCount,
  })
    .from(preventionInspectionRuns)
    .where(eq(preventionInspectionRuns.subjectContainerId, containerId))
    .orderBy(desc(preventionInspectionRuns.createdAt))
    .limit(100)

  /* El conteo del listado ya sólo suma corridas de inspección, así que la ficha
   * y la tabla vuelven a decir lo mismo sin necesidad de explicar un sumando. */
  return { ...row, inspections }
}

/* ── Alta ────────────────────────────────────────────────────────────────── */

export async function createContainer(input: unknown, access: ContainerAccess) {
  requireAccess(access)
  const data = createSchema.parse(input)
  assertWorksiteScope(access, data.worksiteId)
  const worksite = await assertWorksiteExists(data.worksiteId)
  await assertCodeAvailable(data.code)

  const [created] = await db.insert(preventionContainers).values({
    id: `pcont-${nanoid()}`,
    worksiteId: data.worksiteId,
    code: data.code,
    location: data.location,
    status: data.status ?? "operational",
    notes: data.notes ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el contenedor.")

  await recordAudit({
    action: "create",
    entityType: "prevention_container",
    entityId: created.id,
    entityCode: created.code,
    userId: access.userId,
    newState: created,
    reason: `Catálogo de contenedores: alta de ${created.code} en ${worksite.name}`,
  })
  return created
}

/* ── Edición y traslado ──────────────────────────────────────────────────── */

/**
 * Edita la ficha, incluido el traslado de faena.
 *
 * El traslado es un cambio de la ficha, no de la evidencia: las inspecciones ya
 * ejecutadas conservan su propia faena y su `subjectLabel` congelado. Queda en
 * auditoría porque "dónde estuvo este contenedor" es justamente lo que se
 * pregunta cuando aparece un hallazgo viejo.
 */
export async function updateContainer(input: unknown, access: ContainerAccess) {
  requireAccess(access)
  const data = updateSchema.parse(input)

  const [current] = await db.select().from(preventionContainers)
    .where(eq(preventionContainers.id, data.containerId)).limit(1)
  if (!current) throw new Error(NOT_FOUND)
  assertWorksiteScope(access, current.worksiteId)
  if (current.version !== data.expectedVersion) {
    throw new Error("El contenedor cambió en otra sesión. Recarga antes de continuar.")
  }

  let movedTo: { id: string; name: string } | null = null
  if (data.worksiteId && data.worksiteId !== current.worksiteId) {
    assertWorksiteScope(access, data.worksiteId)
    movedTo = await assertWorksiteExists(data.worksiteId)
    /* Una programación viva en la faena de origen quedaría apuntando a un
     * contenedor de otra faena: `resolveSubject` la rechaza, el barrido diario
     * la cuenta como error y no avanza su `nextDueOn`, así que el programa deja
     * de producir inspecciones sin que nadie se entere. Mejor frenar el
     * traslado y decir qué falta. */
    const [blocking] = await db.select({ id: preventionInspectionPrograms.id })
      .from(preventionInspectionPrograms)
      .where(and(
        eq(preventionInspectionPrograms.subjectContainerId, current.id),
        eq(preventionInspectionPrograms.worksiteId, current.worksiteId),
        eq(preventionInspectionPrograms.isActive, true),
      )).limit(1)
    if (blocking) {
      throw new Error(
        `${current.code} tiene una programación de inspecciones activa en su faena actual. Detenla o cámbiale el sujeto antes de trasladarlo.`,
      )
    }
  }
  if (data.code && data.code !== current.code) await assertCodeAvailable(data.code, current.id)

  const [updated] = await db.update(preventionContainers).set({
    worksiteId: data.worksiteId ?? current.worksiteId,
    code: data.code ?? current.code,
    location: data.location ?? current.location,
    status: data.status ?? current.status,
    notes: data.notes === undefined ? current.notes : data.notes,
    isActive: data.isActive ?? current.isActive,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  })
    // La versión va en el WHERE además de compararse arriba: entre la lectura y
    // la escritura cabe otra sesión.
    .where(and(
      eq(preventionContainers.id, current.id),
      eq(preventionContainers.version, data.expectedVersion),
    ))
    .returning()
  if (!updated) throw new Error("El contenedor cambió en otra sesión. Recarga antes de continuar.")

  await recordAudit({
    action: "update",
    entityType: "prevention_container",
    entityId: updated.id,
    entityCode: updated.code,
    userId: access.userId,
    oldState: current,
    newState: updated,
    reason: movedTo
      ? `Catálogo de contenedores: ${updated.code} trasladado a ${movedTo.name}`
      : `Catálogo de contenedores: se editó ${updated.code}`,
  })
  return updated
}

/* ── Baja ────────────────────────────────────────────────────────────────── */

/**
 * Borra la ficha. Sólo si ninguna inspección la tomó como sujeto: en cuanto lo
 * hizo, la ficha sostiene evidencia y la baja correcta es marcarla fuera de
 * servicio, que conserva el historial. Mismo criterio que el inventario de
 * faena; el borrado existe porque un código mal tecleado tiene que poder
 * deshacerse.
 */
export async function deleteContainer(input: unknown, access: ContainerAccess) {
  requireAccess(access)
  const { containerId } = z.object({ containerId: z.string().min(1) }).parse(input)

  const [container] = await db.select().from(preventionContainers)
    .where(eq(preventionContainers.id, containerId)).limit(1)
  if (!container) throw new Error(NOT_FOUND)
  assertWorksiteScope(access, container.worksiteId)

  const [usedByRun] = await db.select({ id: preventionInspectionRuns.id })
    .from(preventionInspectionRuns)
    .where(eq(preventionInspectionRuns.subjectContainerId, containerId)).limit(1)
  if (usedByRun) {
    throw new Error(
      "Este contenedor ya fue inspeccionado, así que su ficha es evidencia y no se borra. Márcalo como «fuera de servicio».",
    )
  }

  /* Una programación que lo apunta no es evidencia, pero la FK es
   * `ON DELETE SET NULL`: borrarlo la dejaría sin sujeto, el materializador
   * generaría inspecciones de contenedor sin contenedor, y el programa ya no
   * podría editarse porque editar exige sujeto. Se bloquea con nombre propio. */
  const [usedByProgram] = await db.select({ id: preventionInspectionPrograms.id })
    .from(preventionInspectionPrograms)
    .where(eq(preventionInspectionPrograms.subjectContainerId, containerId)).limit(1)
  if (usedByProgram) {
    throw new Error(
      "Hay una programación de inspecciones que apunta a este contenedor. Detenla o cámbiale el sujeto antes de borrarlo.",
    )
  }

  await db.delete(preventionContainers).where(eq(preventionContainers.id, containerId))

  await recordAudit({
    action: "delete",
    entityType: "prevention_container",
    entityId: containerId,
    entityCode: container.code,
    userId: access.userId,
    oldState: container,
    reason: `Catálogo de contenedores: se borró ${container.code}, nunca inspeccionado`,
  })
  return { deleted: true as const }
}
