/**
 * lib/services/worksite-inventory.ts
 *
 * Inventario físico por faena: extintores, kits de derrame y cualquier otro
 * recurso instalado en terreno.
 *
 * Vive como dato maestro y no como contenido de Prevención. La tabla ya lo
 * modelaba así —`worksite_id` es obligatorio y `plan_id` es nullable con
 * `onDelete: set null`, con el comentario "el equipo pertenece a la faena; el
 * plan es sólo el documento que lo declara"—, pero la única alta que existía
 * (`addEmergencyResource`) exigía un plan de emergencias **en borrador**. El
 * resultado era que un extintor que llegaba al pañol no podía registrarse si el
 * plan de la faena ya estaba aprobado: la realidad física quedaba rehén del
 * estado de un documento.
 *
 * Acá el alta es de faena y no pide plan. Prevención sigue declarando en su plan
 * qué recursos cubre, pero eligiéndolos del inventario en vez de crearlos.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionEmergencyPlans,
  preventionEmergencyResources,
  preventionInspectionRuns,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { z } from "zod"

export interface InventoryAccess {
  userId: string
  permissions: readonly string[]
}

const PERMISSION = "admin:worksite_inventory"

/** Mismo texto para todo lo no encontrado o fuera de permiso: no filtra existencia. */
const NOT_FOUND = "Recurso no encontrado o fuera de alcance."

function requireAccess(access: InventoryAccess) {
  if (!access.permissions.includes(PERMISSION)) throw new Error(NOT_FOUND)
}

/** Fecha ISO corta. Se guarda como texto igual que el resto del inventario. */
const dateField = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (aaaa-mm-dd).").nullable().optional()

const resourceFields = {
  name: z.string().trim().min(2).max(200),
  kind: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(300),
  serialNumber: z.string().trim().max(120).nullable().optional(),
  lastInspectedAt: dateField,
  nextInspectionAt: dateField,
  expiresAt: dateField,
}

const createSchema = z.object({ worksiteId: z.string().min(1), ...resourceFields })

/* ── Consultas ───────────────────────────────────────────────────────────── */

export async function listWorksiteInventory(access: InventoryAccess) {
  requireAccess(access)
  return db.select({
    resource: preventionEmergencyResources,
    worksiteName: worksites.name,
    planName: preventionEmergencyPlans.title,
    /* Cuántas inspecciones lo tomaron como sujeto. Gobierna si se puede borrar
     * y, sobre todo, le dice a quien mira que esa ficha ya sostiene evidencia. */
    inspectionCount: sql<number>`(
      SELECT COUNT(*)::int FROM prevention_inspection_runs r
      WHERE r.subject_resource_id = ${preventionEmergencyResources.id}
    )`,
  })
    .from(preventionEmergencyResources)
    .innerJoin(worksites, eq(worksites.id, preventionEmergencyResources.worksiteId))
    .leftJoin(preventionEmergencyPlans, eq(preventionEmergencyPlans.id, preventionEmergencyResources.planId))
    .orderBy(asc(worksites.name), asc(preventionEmergencyResources.name))
}

export async function listWorksitesForInventory(access: InventoryAccess) {
  requireAccess(access)
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(eq(worksites.isActive, true))
    .orderBy(asc(worksites.name))
}

/**
 * Recursos de la faena que el plan todavía no declara. Los alimenta el selector
 * de Emergencias, que reemplazó al alta: el plan elige del inventario.
 */
export async function listLinkableResources(worksiteId: string) {
  return db.select({
    id: preventionEmergencyResources.id,
    name: preventionEmergencyResources.name,
    kind: preventionEmergencyResources.kind,
    location: preventionEmergencyResources.location,
  })
    .from(preventionEmergencyResources)
    .where(and(
      eq(preventionEmergencyResources.worksiteId, worksiteId),
      isNull(preventionEmergencyResources.planId),
    ))
    .orderBy(asc(preventionEmergencyResources.name))
}

/* ── Alta ────────────────────────────────────────────────────────────────── */

export async function createWorksiteResource(input: unknown, access: InventoryAccess) {
  requireAccess(access)
  const data = createSchema.parse(input)

  const [worksite] = await db.select({ id: worksites.id })
    .from(worksites).where(eq(worksites.id, data.worksiteId)).limit(1)
  if (!worksite) throw new Error("La faena no existe.")

  const [created] = await db.insert(preventionEmergencyResources).values({
    id: `pemgre-${nanoid()}`,
    worksiteId: data.worksiteId,
    // Nace sin plan: es inventario, no contenido de un documento. Prevención lo
    // vincula después si su plan de emergencias lo declara.
    planId: null,
    name: data.name,
    kind: data.kind,
    location: data.location,
    serialNumber: data.serialNumber ?? null,
    lastInspectedAt: data.lastInspectedAt ?? null,
    nextInspectionAt: data.nextInspectionAt ?? null,
    expiresAt: data.expiresAt ?? null,
  }).returning()
  if (!created) throw new Error("No se pudo agregar el recurso.")

  await recordAudit({
    action: "create",
    entityType: "prevention_emergency_resource",
    entityId: created.id,
    userId: access.userId,
    newState: created,
    reason: `Inventario de faena: ${data.kind} "${data.name}"`,
  })
  return created
}

/* ── Carga masiva ────────────────────────────────────────────────────────── */

export interface ParsedInventoryRow {
  line: number
  values?: z.infer<typeof createSchema> extends infer T ? T extends { worksiteId: string } ? Omit<T, "worksiteId"> : never : never
  error?: string
}

const IMPORT_COLUMNS = ["nombre", "tipo", "ubicación", "serie", "próxima inspección", "vencimiento"] as const

/** Cabecera que se le muestra al usuario y que el parser espera en ese orden. */
export const INVENTORY_IMPORT_HEADER = IMPORT_COLUMNS.join("\t")

/**
 * Parsea el pegado de una planilla. Se acepta texto tabulado o con punto y coma
 * porque es lo que produce copiar celdas desde Excel: exigir un archivo `.xlsx`
 * obligaría a subirlo, validar su MIME y guardarlo, para el mismo dato que ya
 * está en el portapapeles.
 *
 * Función pura y exportada: la validación por fila es lo que hace usable una
 * carga de doscientos extintores, y es lo que hay que poder probar sin base.
 *
 * ponytail: pegado de texto, no lectura de xlsx. Si algún día hay que importar
 * un formato con celdas combinadas o varias hojas, el reemplazo es el panel de
 * subida que ya existe en Admin → Productos.
 */
export function parseInventoryPaste(text: string): ParsedInventoryRow[] {
  const rows: ParsedInventoryRow[] = []
  const lines = text.split(/\r?\n/)

  for (const [index, raw] of lines.entries()) {
    const line = index + 1
    if (!raw.trim()) continue
    // El separador se decide por línea: una pegada de Excel es tabulada, pero
    // un CSV exportado a mano llega con punto y coma.
    const cells = (raw.includes("\t") ? raw.split("\t") : raw.split(";")).map((cell) => cell.trim())

    // Cabecera repetida al copiar desde la planilla: se salta sin protestar.
    if (cells[0]?.toLowerCase() === "nombre") continue

    const [name, kind, location, serialNumber, nextInspectionAt, expiresAt] = cells
    const candidate = {
      worksiteId: "placeholder",
      name: name ?? "",
      kind: kind ?? "",
      location: location ?? "",
      serialNumber: serialNumber || null,
      nextInspectionAt: nextInspectionAt || null,
      expiresAt: expiresAt || null,
    }
    const parsed = createSchema.safeParse(candidate)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      rows.push({ line, error: `${first?.path.join(".") ?? "fila"}: ${first?.message ?? "dato inválido"}` })
      continue
    }
    const { worksiteId: _ignored, ...values } = parsed.data
    rows.push({ line, values: values as ParsedInventoryRow["values"] })
  }
  return rows
}

export interface ImportResult {
  created: number
  /** Filas rechazadas, con su número de línea y el motivo. */
  rejected: Array<{ line: number; error: string }>
}

export async function importWorksiteResources(input: unknown, access: InventoryAccess): Promise<ImportResult> {
  requireAccess(access)
  const data = z.object({
    worksiteId: z.string().min(1),
    text: z.string().min(1).max(200_000),
  }).parse(input)

  const [worksite] = await db.select({ id: worksites.id })
    .from(worksites).where(eq(worksites.id, data.worksiteId)).limit(1)
  if (!worksite) throw new Error("La faena no existe.")

  const rows = parseInventoryPaste(data.text)
  const valid = rows.filter((row) => row.values)
  const rejected = rows.filter((row) => row.error).map((row) => ({ line: row.line, error: row.error! }))

  if (valid.length === 0) return { created: 0, rejected }

  /* Todo o nada por lote: una carga a medias deja al usuario sin saber qué
   * quedó dentro, y reintentar duplicaría lo ya insertado — el inventario no
   * tiene clave natural que lo impida (dos extintores pueden compartir nombre
   * y ubicación). Las filas inválidas se informan y no bloquean al lote. */
  await db.insert(preventionEmergencyResources).values(valid.map((row) => ({
    id: `pemgre-${nanoid()}`,
    worksiteId: data.worksiteId,
    planId: null,
    name: row.values!.name,
    kind: row.values!.kind,
    location: row.values!.location,
    serialNumber: row.values!.serialNumber ?? null,
    lastInspectedAt: null,
    nextInspectionAt: row.values!.nextInspectionAt ?? null,
    expiresAt: row.values!.expiresAt ?? null,
  })))

  await recordAudit({
    action: "create",
    entityType: "prevention_emergency_resource",
    entityId: data.worksiteId,
    userId: access.userId,
    reason: `Carga masiva de inventario: ${valid.length} recurso(s) creado(s), ${rejected.length} fila(s) rechazada(s)`,
  })
  return { created: valid.length, rejected }
}

/* ── Baja ────────────────────────────────────────────────────────────────── */

/**
 * Borra la ficha. Sólo si ninguna inspección la tomó como sujeto: en cuanto lo
 * hizo, la ficha sostiene evidencia y la baja correcta es
 * `status: 'out_of_service'` desde Prevención, que conserva el historial.
 *
 * Mismo criterio que `retireInspectionTemplate`: se borra lo que nunca se usó y
 * se retira lo que sí. El borrado existe porque una carga masiva con un error
 * de tipeo tiene que poder deshacerse.
 */
export async function deleteWorksiteResource(input: unknown, access: InventoryAccess) {
  requireAccess(access)
  const { resourceId } = z.object({ resourceId: z.string().min(1) }).parse(input)

  const [resource] = await db.select().from(preventionEmergencyResources)
    .where(eq(preventionEmergencyResources.id, resourceId)).limit(1)
  if (!resource) throw new Error(NOT_FOUND)

  const [used] = await db.select({ id: preventionInspectionRuns.id })
    .from(preventionInspectionRuns)
    .where(eq(preventionInspectionRuns.subjectResourceId, resourceId)).limit(1)
  if (used) {
    throw new Error(
      "Este recurso ya fue inspeccionado, así que su ficha es evidencia y no se borra. Dale de baja como «fuera de servicio» desde el plan de emergencias.",
    )
  }

  await db.delete(preventionEmergencyResources)
    .where(eq(preventionEmergencyResources.id, resourceId))

  await recordAudit({
    action: "delete",
    entityType: "prevention_emergency_resource",
    entityId: resourceId,
    userId: access.userId,
    oldState: resource,
    reason: `Inventario de faena: se borró "${resource.name}", nunca inspeccionado`,
  })
  return { deleted: true as const }
}

/* ── Vínculo con el plan de emergencias ──────────────────────────────────── */

/**
 * Declara en un plan los recursos que ya existen en el inventario de su faena.
 * Reemplaza al alta: Prevención elige, no crea.
 *
 * Lo guarda `prevention:emergency:manage` desde la acción; acá se comprueba que
 * los recursos pertenezcan a la faena del plan, que es la invariante que el
 * selector no puede garantizar por sí solo.
 */
export async function linkResourcesToPlan(input: unknown, actorUserId: string) {
  const data = z.object({
    planId: z.string().min(1),
    resourceIds: z.array(z.string().min(1)).min(1).max(500),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [plan] = await tx.select({ id: preventionEmergencyPlans.id, worksiteId: preventionEmergencyPlans.worksiteId })
      .from(preventionEmergencyPlans)
      .where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new Error("Plan no encontrado.")

    const rows = await tx.select({ id: preventionEmergencyResources.id })
      .from(preventionEmergencyResources)
      .where(and(
        inArray(preventionEmergencyResources.id, data.resourceIds),
        eq(preventionEmergencyResources.worksiteId, plan.worksiteId),
      ))
    if (rows.length !== data.resourceIds.length) {
      throw new Error("Algún recurso no pertenece a la faena de este plan.")
    }

    await tx.update(preventionEmergencyResources)
      .set({ planId: plan.id, updatedAt: new Date().toISOString() })
      .where(inArray(preventionEmergencyResources.id, data.resourceIds))

    await recordAudit({
      action: "update",
      entityType: "prevention_emergency_plan",
      entityId: plan.id,
      userId: actorUserId,
      newState: { linkedResourceIds: data.resourceIds },
      reason: `El plan declara ${rows.length} recurso(s) del inventario de la faena`,
    }, tx)
    return { linked: rows.length }
  })
}
