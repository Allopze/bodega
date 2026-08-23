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

import ExcelJS from "exceljs"
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
import { normKey, sheetToRecords } from "@/lib/combustibles/xlsx-utils"

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
  /** Fila real de Excel, para poder corregirla en la planilla. */
  line: number
  values?: Omit<z.infer<typeof createSchema>, "worksiteId">
  error?: string
}

/**
 * Columnas de la planilla. Se buscan **por nombre**, no por posición: así el
 * orden de las columnas puede cambiar sin romper la carga, y el usuario ve en su
 * propia planilla cómo se llama cada una.
 */
export const INVENTORY_IMPORT_COLUMNS = {
  name: "NOMBRE",
  kind: "TIPO",
  location: "UBICACION",
  serialNumber: "SERIE",
  nextInspectionAt: "PROXIMA INSPECCION",
  expiresAt: "VENCIMIENTO",
} as const

const REQUIRED_HEADERS = [
  INVENTORY_IMPORT_COLUMNS.name,
  INVENTORY_IMPORT_COLUMNS.kind,
  INVENTORY_IMPORT_COLUMNS.location,
]

/** Excel entrega fechas como `Date`; la columna del inventario es texto ISO corto. */
function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim() || null
}

/** Texto de celda. Separado de `toIsoDate` a propósito: una serie no es una fecha. */
function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return String(value).trim() || null
}

function cell(record: Record<string, unknown>, header: string): unknown {
  for (const [key, value] of Object.entries(record)) {
    if (normKey(key) === normKey(header)) return value
  }
  return null
}

/**
 * Lee la planilla del inventario. Mismo patrón que la importación de vehículos
 * (`lib/combustibles/fleet-xlsx-import.ts`): encabezados por nombre, una fila
 * por recurso y **un error por fila** en vez de un rechazo del lote entero — que
 * es lo que hace cargable una planilla de doscientos extintores.
 *
 * Los dos padrones de la plataforma se cargan igual a propósito: tener uno por
 * archivo y otro por pegado obligaba a recordar cuál era cuál.
 */
export async function parseInventoryXlsx(fileBuffer: ArrayBuffer | Buffer): Promise<ParsedInventoryRow[]> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(fileBuffer as never)
  } catch {
    return [{ line: 0, error: "Archivo Excel inválido o corrupto." }]
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) return [{ line: 0, error: "No se encontró una hoja con datos." }]

  const headers: string[] = []
  sheet.getRow(1).eachCell({ includeEmpty: true }, (item, columnNumber) => {
    headers[columnNumber - 1] = normKey(String(item.value ?? ""))
  })
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(normKey(header)))
  if (missing.length > 0) {
    return [{ line: 1, error: `Faltan columnas requeridas: ${missing.join(", ")}.` }]
  }

  const rows: ParsedInventoryRow[] = []
  for (const record of sheetToRecords(sheet)) {
    const candidate = {
      worksiteId: "placeholder",
      name: String(cell(record, INVENTORY_IMPORT_COLUMNS.name) ?? "").trim(),
      kind: String(cell(record, INVENTORY_IMPORT_COLUMNS.kind) ?? "").trim(),
      location: String(cell(record, INVENTORY_IMPORT_COLUMNS.location) ?? "").trim(),
      serialNumber: toText(cell(record, INVENTORY_IMPORT_COLUMNS.serialNumber)),
      nextInspectionAt: toIsoDate(cell(record, INVENTORY_IMPORT_COLUMNS.nextInspectionAt)),
      expiresAt: toIsoDate(cell(record, INVENTORY_IMPORT_COLUMNS.expiresAt)),
    }
    // Fila totalmente vacía: la planilla suele traer decenas al final.
    if (!candidate.name && !candidate.kind && !candidate.location) continue

    const parsed = createSchema.safeParse(candidate)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      rows.push({ line: record.__row, error: `${first?.path.join(".") ?? "fila"}: ${first?.message ?? "dato inválido"}` })
      continue
    }
    const { worksiteId: _ignored, ...values } = parsed.data
    rows.push({ line: record.__row, values })
  }
  return rows
}

export interface ImportResult {
  created: number
  /** Filas rechazadas, con su número de fila en la planilla y el motivo. */
  rejected: Array<{ line: number; error: string }>
}

export async function importWorksiteResources(
  input: { worksiteId: string; fileBuffer: ArrayBuffer | Buffer },
  access: InventoryAccess,
): Promise<ImportResult> {
  requireAccess(access)
  const worksiteId = z.string().min(1).parse(input.worksiteId)

  const [worksite] = await db.select({ id: worksites.id })
    .from(worksites).where(eq(worksites.id, worksiteId)).limit(1)
  if (!worksite) throw new Error("La faena no existe.")

  const rows = await parseInventoryXlsx(input.fileBuffer)
  const valid = rows.filter((row) => row.values)
  const rejected = rows.filter((row) => row.error).map((row) => ({ line: row.line, error: row.error! }))

  if (valid.length === 0) return { created: 0, rejected }

  /* Todo o nada por lote: una carga a medias deja al usuario sin saber qué
   * quedó dentro, y reintentar duplicaría lo ya insertado — el inventario no
   * tiene clave natural que lo impida (dos extintores pueden compartir nombre
   * y ubicación). Las filas inválidas se informan y no bloquean al lote. */
  await db.insert(preventionEmergencyResources).values(valid.map((row) => ({
    id: `pemgre-${nanoid()}`,
    worksiteId,
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
    entityId: worksiteId,
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
