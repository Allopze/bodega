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
import { createHash } from "node:crypto"
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  fuelVehicles,
  preventionEmergencyPlans,
  preventionEmergencyResourceAssignments,
  preventionEmergencyResourceEvents,
  preventionEmergencyResourceImportBatches,
  preventionEmergencyResourcePoints,
  preventionEmergencyResourceServiceCases,
  preventionEmergencyResourceTypes,
  preventionEmergencyResources,
  preventionInspectionRuns,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  receiptItems,
  receipts,
  suppliers,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { z } from "zod"
import { normKey, sheetToRecords } from "@/lib/combustibles/xlsx-utils"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"
import {
  buildEmergencyInventoryPreview,
  calculateEmergencyCoverage,
  type EmergencyImportContext,
  type EmergencyImportPreview,
} from "@/lib/services/emergency-resource-catalog"
import { todayInChile } from "@/lib/utils"

export interface InventoryAccess {
  userId: string
  permissions: readonly string[]
  scope: readonly string[] | "all"
}

const PERMISSION = "admin:worksite_inventory"
const SERVICE_PERMISSION = "admin:worksite_inventory_service"

/** Mismo texto para todo lo no encontrado o fuera de permiso: no filtra existencia. */
const NOT_FOUND = "Recurso no encontrado o fuera de alcance."

function requireAccess(access: InventoryAccess) {
  if (!access.permissions.includes(PERMISSION)) throw new Error(NOT_FOUND)
}

function requireViewAccess(access: InventoryAccess) {
  if (!access.permissions.includes(PERMISSION) && !access.permissions.includes(SERVICE_PERMISSION)) throw new Error(NOT_FOUND)
}

function requireServiceAccess(access: InventoryAccess) {
  if (!access.permissions.includes(SERVICE_PERMISSION)) throw new Error(NOT_FOUND)
}

function assertWorksiteScope(access: InventoryAccess, worksiteId: string) {
  if (access.scope !== "all" && !access.scope.includes(worksiteId)) throw new Error(NOT_FOUND)
}

function scopeCondition(access: InventoryAccess) {
  return access.scope === "all"
    ? undefined
    : access.scope.length > 0
      ? inArray(preventionEmergencyResources.worksiteId, [...access.scope])
      : sql`false`
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
  requireViewAccess(access)
  return db.select({
    resource: preventionEmergencyResources,
    technicalType: preventionEmergencyResourceTypes,
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
    .leftJoin(preventionEmergencyResourceTypes, eq(preventionEmergencyResources.typeId, preventionEmergencyResourceTypes.id))
    .leftJoin(preventionEmergencyPlans, eq(preventionEmergencyPlans.id, preventionEmergencyResources.planId))
    .where(scopeCondition(access))
    .orderBy(asc(worksites.name), asc(preventionEmergencyResources.name))
}

export async function listWorksitesForInventory(access: InventoryAccess) {
  requireViewAccess(access)
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(
      eq(worksites.isActive, true),
      access.scope === "all"
        ? undefined
        : access.scope.length > 0 ? inArray(worksites.id, [...access.scope]) : sql`false`,
    ))
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
  assertWorksiteScope(access, data.worksiteId)

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
  input: { worksiteId: string; fileBuffer: ArrayBuffer | Buffer; fileName?: string },
  access: InventoryAccess,
): Promise<ImportResult> {
  const result = await confirmEmergencyInventoryImport({
    worksiteId: input.worksiteId,
    fileBuffer: input.fileBuffer,
    fileName: input.fileName ?? "inventario.xlsx",
  }, access)
  return { created: result.created, rejected: [] }
}

type InventoryReader = Pick<DB | Tx, "select">

function fingerprint(fileBuffer: ArrayBuffer | Buffer) {
  return createHash("sha256").update(toBuffer(fileBuffer)).digest("hex")
}

function toBuffer(fileBuffer: ArrayBuffer | Buffer): Buffer {
  return Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(new Uint8Array(fileBuffer))
}

function pointCode(row: EmergencyImportPreview["rows"][number]) {
  if (row.vehicleId && row.plate) return `VEH-${plateMatchKey(row.plate)}`
  const normalized = (row.fixedLocation ?? "SIN-UBICACION")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")
  return `FIX-${normalized.slice(0, 80)}`
}

async function loadEmergencyImportContext(client: InventoryReader, worksiteId: string): Promise<EmergencyImportContext> {
  const vehicles = await client.select({
    id: fuelVehicles.id,
    worksiteId: fuelVehicles.worksiteId,
    plate: fuelVehicles.plate,
    brand: fuelVehicles.brand,
    category: fuelVehicles.type,
  }).from(fuelVehicles).where(and(
    eq(fuelVehicles.worksiteId, worksiteId),
    eq(fuelVehicles.isActive, true),
  ))

  const resources = await client.select({
    id: preventionEmergencyResources.id,
    worksiteId: preventionEmergencyResources.worksiteId,
    assetCode: preventionEmergencyResources.assetCode,
    agent: preventionEmergencyResourceTypes.agent,
    capacity: preventionEmergencyResourceTypes.capacity,
    capacityUnit: preventionEmergencyResourceTypes.capacityUnit,
    lastMaintenanceAt: preventionEmergencyResources.lastMaintenanceAt,
    expiresAt: preventionEmergencyResources.expiresAt,
    status: preventionEmergencyResources.status,
  }).from(preventionEmergencyResources)
    .leftJoin(preventionEmergencyResourceTypes, eq(preventionEmergencyResources.typeId, preventionEmergencyResourceTypes.id))
    .where(eq(preventionEmergencyResources.worksiteId, worksiteId))

  const placements = await client.select({
    resourceId: preventionEmergencyResourceAssignments.resourceId,
    vehicleId: preventionEmergencyResourcePoints.vehicleId,
    fixedLocation: preventionEmergencyResourcePoints.fixedLocation,
  }).from(preventionEmergencyResourceAssignments)
    .innerJoin(preventionEmergencyResourcePoints, eq(preventionEmergencyResourceAssignments.pointId, preventionEmergencyResourcePoints.id))
    .where(and(
      eq(preventionEmergencyResourcePoints.worksiteId, worksiteId),
      isNull(preventionEmergencyResourceAssignments.unassignedAt),
    ))

  return {
    worksiteId,
    vehicles,
    existingResources: resources.map((resource) => ({
      ...resource,
      status: resource.status as EmergencyImportContext["existingResources"][number]["status"],
    })),
    existingPlacements: placements,
  }
}

export interface EmergencyInventoryPreviewResult extends EmergencyImportPreview {
  fingerprint: string
  alreadyApplied: boolean
}

export async function previewEmergencyInventoryImport(
  input: { worksiteId: string; fileBuffer: ArrayBuffer | Buffer },
  access: InventoryAccess,
): Promise<EmergencyInventoryPreviewResult> {
  requireAccess(access)
  const worksiteId = z.string().min(1).parse(input.worksiteId)
  assertWorksiteScope(access, worksiteId)
  const [worksite] = await db.select({ id: worksites.id }).from(worksites)
    .where(eq(worksites.id, worksiteId)).limit(1)
  if (!worksite) throw new Error("La faena no existe.")

  const fileFingerprint = fingerprint(input.fileBuffer)
  const [existingBatch] = await db.select({ id: preventionEmergencyResourceImportBatches.id })
    .from(preventionEmergencyResourceImportBatches)
    .where(and(
      eq(preventionEmergencyResourceImportBatches.worksiteId, worksiteId),
      eq(preventionEmergencyResourceImportBatches.fileFingerprint, fileFingerprint),
      or(
        eq(preventionEmergencyResourceImportBatches.status, "applied"),
        eq(preventionEmergencyResourceImportBatches.status, "superseded"),
      ),
    )).limit(1)
  const context = await loadEmergencyImportContext(db, worksiteId)
  const preview = await buildEmergencyInventoryPreview(input.fileBuffer, context)
  return { ...preview, fingerprint: fileFingerprint, alreadyApplied: Boolean(existingBatch) }
}

export interface ConfirmEmergencyInventoryResult {
  batchId: string
  created: number
  updated: number
  unchanged: number
  points: number
}

/** Confirma el mismo archivo previsualizado, recalculando todo dentro del tx. */
export async function confirmEmergencyInventoryImport(
  input: { worksiteId: string; fileBuffer: ArrayBuffer | Buffer; fileName: string },
  access: InventoryAccess,
): Promise<ConfirmEmergencyInventoryResult> {
  requireAccess(access)
  const data = z.object({
    worksiteId: z.string().min(1),
    fileName: z.string().trim().min(1).max(255),
  }).parse({ worksiteId: input.worksiteId, fileName: input.fileName })
  assertWorksiteScope(access, data.worksiteId)
  const fileFingerprint = fingerprint(input.fileBuffer)

  return db.transaction(async (tx) => {
    const [worksite] = await tx.select({ id: worksites.id }).from(worksites)
      .where(eq(worksites.id, data.worksiteId)).limit(1)
    if (!worksite) throw new Error("La faena no existe.")

    const [duplicate] = await tx.select({ id: preventionEmergencyResourceImportBatches.id })
      .from(preventionEmergencyResourceImportBatches)
      .where(and(
        eq(preventionEmergencyResourceImportBatches.worksiteId, data.worksiteId),
        eq(preventionEmergencyResourceImportBatches.fileFingerprint, fileFingerprint),
        or(
          eq(preventionEmergencyResourceImportBatches.status, "applied"),
          eq(preventionEmergencyResourceImportBatches.status, "superseded"),
        ),
      )).limit(1)
    if (duplicate) throw new Error("Este archivo ya fue confirmado para la faena. No se duplicó ningún registro.")

    const context = await loadEmergencyImportContext(tx, data.worksiteId)
    const preview = await buildEmergencyInventoryPreview(input.fileBuffer, context)
    if (!preview.canConfirm) {
      const first = preview.conflicts[0]
      throw new Error(first ? `Hay conflictos sin resolver. Fila ${first.line}: ${first.message}` : "La planilla no contiene filas confirmables.")
    }

    const snapshots: Array<Record<string, unknown>> = []
    let created = 0
    let updated = 0
    const affectedPointIds = new Set<string>()

    for (const row of preview.rows) {
      let [type] = await tx.select().from(preventionEmergencyResourceTypes).where(and(
        eq(preventionEmergencyResourceTypes.resourceClass, "extinguisher"),
        eq(preventionEmergencyResourceTypes.agent, row.agent),
        eq(preventionEmergencyResourceTypes.capacity, row.capacity),
        eq(preventionEmergencyResourceTypes.capacityUnit, row.capacityUnit),
      )).limit(1)
      if (!type) {
        ;[type] = await tx.insert(preventionEmergencyResourceTypes).values({
          id: `pemgrt-${nanoid()}`,
          resourceClass: "extinguisher",
          agent: row.agent,
          capacity: row.capacity,
          capacityUnit: row.capacityUnit,
          canonicalName: `Extintor ${row.agent} ${row.capacity} ${row.capacityUnit}`,
          serviceProductId: "prod-srv-recarga-extintor",
        }).returning()
      }
      if (!type) throw new Error("No se pudo clasificar el tipo técnico.")

      let [resource] = await tx.select().from(preventionEmergencyResources).where(and(
        eq(preventionEmergencyResources.worksiteId, data.worksiteId),
        eq(preventionEmergencyResources.assetCode, row.assetCode),
      )).limit(1)
      snapshots.push({ line: row.line, decision: row.decision, before: resource ?? null })
      const location = row.placementKind === "vehicle" ? `Vehículo ${row.plate}` : row.fixedLocation!
      if (!resource) {
        ;[resource] = await tx.insert(preventionEmergencyResources).values({
          id: `pemgre-${nanoid()}`,
          worksiteId: data.worksiteId,
          planId: null,
          assetCode: row.assetCode,
          typeId: type.id,
          name: `Extintor ${row.assetCode}`,
          kind: "Extintor",
          location,
          serialNumber: null,
          lastMaintenanceAt: row.lastMaintenanceAt,
          expiresAt: row.expiresAt,
          status: row.status,
        }).returning()
        created += 1
      } else if (row.decision === "update") {
        ;[resource] = await tx.update(preventionEmergencyResources).set({
          typeId: type.id,
          location,
          lastMaintenanceAt: row.lastMaintenanceAt,
          expiresAt: row.expiresAt,
          status: row.status,
          version: sql`${preventionEmergencyResources.version} + 1`,
          updatedAt: new Date().toISOString(),
        }).where(eq(preventionEmergencyResources.id, resource.id)).returning()
        updated += 1
      }
      if (!resource) throw new Error(`No se pudo guardar ${row.assetCode}.`)

      const code = pointCode(row)
      let [point] = await tx.select().from(preventionEmergencyResourcePoints).where(and(
        eq(preventionEmergencyResourcePoints.worksiteId, data.worksiteId),
        eq(preventionEmergencyResourcePoints.code, code),
      )).limit(1)
      if (!point) {
        ;[point] = await tx.insert(preventionEmergencyResourcePoints).values({
          id: `pemgrp-${nanoid()}`,
          worksiteId: data.worksiteId,
          code,
          label: location,
          pointKind: row.placementKind,
          vehicleId: row.vehicleId,
          fixedLocation: row.fixedLocation,
          requiredTypeId: type.id,
        }).returning()
      } else {
        ;[point] = await tx.update(preventionEmergencyResourcePoints).set({
          label: location,
          requiredTypeId: type.id,
          vehicleId: row.vehicleId,
          fixedLocation: row.fixedLocation,
          pointKind: row.placementKind,
          version: sql`${preventionEmergencyResourcePoints.version} + 1`,
          updatedAt: new Date().toISOString(),
        }).where(eq(preventionEmergencyResourcePoints.id, point.id)).returning()
      }
      if (!point) throw new Error(`No se pudo guardar el punto de ${row.assetCode}.`)
      affectedPointIds.add(point.id)

      const [currentAssignment] = await tx.select().from(preventionEmergencyResourceAssignments)
        .where(and(
          eq(preventionEmergencyResourceAssignments.resourceId, resource.id),
          isNull(preventionEmergencyResourceAssignments.unassignedAt),
        )).limit(1)
      if (currentAssignment && currentAssignment.pointId !== point.id) {
        await tx.update(preventionEmergencyResourceAssignments).set({
          unassignedAt: new Date().toISOString(),
          reason: "Reconciliación mediante importación supervisada",
        }).where(eq(preventionEmergencyResourceAssignments.id, currentAssignment.id))
      }
      if (!currentAssignment || currentAssignment.pointId !== point.id) {
        await tx.insert(preventionEmergencyResourceAssignments).values({
          id: `pemgra-${nanoid()}`,
          pointId: point.id,
          resourceId: resource.id,
          actorUserId: access.userId,
          reason: "Carga supervisada de inventario",
        })
      }

      if (row.decision !== "unchanged") {
        await tx.insert(preventionEmergencyResourceEvents).values({
          id: `pemgrev-${nanoid()}`,
          worksiteId: data.worksiteId,
          resourceId: resource.id,
          eventType: row.eventType,
          actorUserId: access.userId,
          sourceType: "inventory_import",
          sourceId: fileFingerprint,
          notes: row.eventType === "used" ? "Percutado en simulacro según planilla importada" : "Activo reconciliado desde planilla",
          snapshot: { line: row.line, assetCode: row.assetCode, status: row.status },
        })
      }
    }

    const batchId = `pemgrib-${nanoid()}`
    await tx.insert(preventionEmergencyResourceImportBatches).values({
      id: batchId,
      worksiteId: data.worksiteId,
      fileName: data.fileName,
      fileFingerprint,
      fileSize: toBuffer(input.fileBuffer).byteLength,
      summary: { ...preview.counts, points: affectedPointIds.size },
      snapshots,
      createdByUserId: access.userId,
    })
    await recordAudit({
      action: "create",
      entityType: "prevention_emergency_resource_import_batch",
      entityId: batchId,
      userId: access.userId,
      newState: { fingerprint: fileFingerprint, ...preview.counts, points: affectedPointIds.size },
      reason: `Carga supervisada: ${created} alta(s), ${updated} actualización(es), ${preview.counts.unchanged} sin cambio(s)`,
    }, tx)
    return { batchId, created, updated, unchanged: preview.counts.unchanged, points: affectedPointIds.size }
  })
}

export async function exportEmergencyInventoryXlsx(access: InventoryAccess): Promise<Buffer> {
  const [rows, coverage] = await Promise.all([
    listWorksiteInventory(access),
    listEmergencyResourceCoverage(access),
  ])
  const placementByResource = new Map(coverage.flatMap((row) => row.assignedResourceId ? [[row.assignedResourceId, row] as const] : []))
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Activos de emergencia")
  sheet.columns = [
    { header: "N°", key: "number", width: 8 },
    { header: "Categoría", key: "category", width: 24 },
    { header: "Patente", key: "plate", width: 16 },
    { header: "Marca", key: "brand", width: 18 },
    { header: "ID extintor", key: "assetCode", width: 16 },
    { header: "Agente", key: "agent", width: 14 },
    { header: "Capacidad", key: "capacity", width: 14 },
    { header: "Última mantención", key: "lastMaintenanceAt", width: 22 },
    { header: "Próximo vencimiento", key: "expiresAt", width: 22 },
    { header: "Ubicación", key: "location", width: 32 },
    { header: "Estado técnico", key: "status", width: 24 },
  ]
  sheet.getRow(1).font = { bold: true }
  sheet.autoFilter = { from: "A1", to: "K1" }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  for (const [index, row] of rows.entries()) {
    const placement = placementByResource.get(row.resource.id)
    sheet.addRow({
    number: index + 1,
    category: placement?.point.pointKind === "vehicle" ? placement.vehicleCategory ?? "Vehículo" : placement?.point.label ?? row.resource.kind,
    plate: placement?.vehiclePlate ?? null,
    brand: placement?.vehicleBrand ?? null,
    assetCode: row.resource.assetCode,
    agent: row.technicalType?.agent,
    capacity: row.technicalType?.capacity === null || row.technicalType?.capacity === undefined
      ? null
      : `${row.technicalType.capacity} ${row.technicalType.capacityUnit ?? ""}`.trim(),
    location: row.resource.location,
    lastMaintenanceAt: row.resource.lastMaintenanceAt,
    expiresAt: row.resource.expiresAt,
    status: row.resource.status === "needs_maintenance"
      ? "REQUIERE MANTENCIÓN"
      : row.resource.status === "out_of_service" ? "FUERA DE SERVICIO" : "OK",
  })
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function listEmergencyResourceCoverage(access: InventoryAccess) {
  requireViewAccess(access)
  const pointRows = await db.select({
    point: preventionEmergencyResourcePoints,
    vehiclePlate: fuelVehicles.plate,
    vehicleBrand: fuelVehicles.brand,
    vehicleCategory: fuelVehicles.type,
    assignmentId: preventionEmergencyResourceAssignments.id,
    assignedResourceId: preventionEmergencyResourceAssignments.resourceId,
    assetCode: preventionEmergencyResources.assetCode,
    resourceName: preventionEmergencyResources.name,
    resourceTypeId: preventionEmergencyResources.typeId,
    resourceStatus: preventionEmergencyResources.status,
    expiresAt: preventionEmergencyResources.expiresAt,
    nextInspectionAt: preventionEmergencyResources.nextInspectionAt,
  }).from(preventionEmergencyResourcePoints)
    .leftJoin(fuelVehicles, eq(preventionEmergencyResourcePoints.vehicleId, fuelVehicles.id))
    .leftJoin(preventionEmergencyResourceAssignments, and(
      eq(preventionEmergencyResourceAssignments.pointId, preventionEmergencyResourcePoints.id),
      isNull(preventionEmergencyResourceAssignments.unassignedAt),
    ))
    .leftJoin(preventionEmergencyResources, eq(preventionEmergencyResourceAssignments.resourceId, preventionEmergencyResources.id))
    .where(and(
      eq(preventionEmergencyResourcePoints.isActive, true),
      access.scope === "all"
        ? undefined
        : access.scope.length > 0
          ? inArray(preventionEmergencyResourcePoints.worksiteId, [...access.scope])
          : sql`false`,
    ))
    .orderBy(asc(preventionEmergencyResourcePoints.label))

  const calculated = calculateEmergencyCoverage({
    today: todayInChile(),
    placements: pointRows.map((row) => ({
      id: row.point.id,
      isActive: row.point.isActive,
      requiredTypeId: row.point.requiredTypeId,
    })),
    assignments: pointRows.flatMap((row) => row.assignmentId && row.assignedResourceId
      ? [{ placementId: row.point.id, resourceId: row.assignedResourceId, active: true }]
      : []),
    resources: pointRows.flatMap((row) => row.assignedResourceId
      ? [{
        id: row.assignedResourceId,
        typeId: row.resourceTypeId,
        status: row.resourceStatus as "operational" | "needs_maintenance" | "out_of_service",
        expiresAt: row.expiresAt,
        nextInspectionAt: row.nextInspectionAt,
      }]
      : []),
  })
  const byPoint = new Map(calculated.map((row) => [row.placementId, row]))
  return pointRows.map((row) => ({ ...row, coverage: byPoint.get(row.point.id)! }))
}

/** Ficha canónica y trazabilidad cruzada del activo, siempre acotada a faena. */
export async function getEmergencyResourceDetail(access: InventoryAccess, resourceId: string) {
  requireViewAccess(access)
  const [resource] = await db.select({
    resource: preventionEmergencyResources,
    technicalType: preventionEmergencyResourceTypes,
    worksiteName: worksites.name,
  }).from(preventionEmergencyResources)
    .innerJoin(worksites, eq(worksites.id, preventionEmergencyResources.worksiteId))
    .leftJoin(preventionEmergencyResourceTypes, eq(preventionEmergencyResources.typeId, preventionEmergencyResourceTypes.id))
    .where(eq(preventionEmergencyResources.id, resourceId))
    .limit(1)
  if (!resource) throw new Error(NOT_FOUND)
  assertWorksiteScope(access, resource.resource.worksiteId)

  const [assignments, events, inspections, serviceCases] = await Promise.all([
    db.select({
      id: preventionEmergencyResourceAssignments.id,
      assignedAt: preventionEmergencyResourceAssignments.assignedAt,
      unassignedAt: preventionEmergencyResourceAssignments.unassignedAt,
      reason: preventionEmergencyResourceAssignments.reason,
      pointId: preventionEmergencyResourcePoints.id,
      pointLabel: preventionEmergencyResourcePoints.label,
    }).from(preventionEmergencyResourceAssignments)
      .innerJoin(preventionEmergencyResourcePoints, eq(preventionEmergencyResourceAssignments.pointId, preventionEmergencyResourcePoints.id))
      .where(eq(preventionEmergencyResourceAssignments.resourceId, resourceId))
      .orderBy(desc(preventionEmergencyResourceAssignments.assignedAt)),
    db.select().from(preventionEmergencyResourceEvents)
      .where(eq(preventionEmergencyResourceEvents.resourceId, resourceId))
      .orderBy(desc(preventionEmergencyResourceEvents.occurredAt)),
    db.select({
      id: preventionInspectionRuns.id,
      code: preventionInspectionRuns.code,
      status: preventionInspectionRuns.status,
      subjectLabel: preventionInspectionRuns.subjectLabel,
      executedAt: preventionInspectionRuns.executedAt,
      reviewedAt: preventionInspectionRuns.reviewedAt,
      compliancePercent: preventionInspectionRuns.compliancePercent,
      nonConformingCount: preventionInspectionRuns.nonConformingCount,
    }).from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.subjectResourceId, resourceId))
      .orderBy(desc(preventionInspectionRuns.createdAt)),
    db.select({
      id: preventionEmergencyResourceServiceCases.id,
      status: preventionEmergencyResourceServiceCases.status,
      openedAt: preventionEmergencyResourceServiceCases.openedAt,
      completedAt: preventionEmergencyResourceServiceCases.completedAt,
      requestId: purchaseRequests.id,
      requestCode: purchaseRequests.code,
      requestStatus: purchaseRequests.status,
      requestItemId: purchaseRequestItems.id,
      orderId: purchaseOrders.id,
      orderCode: purchaseOrders.code,
      orderStatus: purchaseOrders.status,
      supplierName: suppliers.name,
      unitPrice: purchaseOrderItems.unitPrice,
      subtotal: purchaseOrderItems.subtotal,
      receiptId: receipts.id,
      receiptCode: receipts.code,
      receiptStatus: receiptItems.status,
      receivedAt: receipts.receivedAt,
    }).from(preventionEmergencyResourceServiceCases)
      .innerJoin(purchaseRequestItems, eq(preventionEmergencyResourceServiceCases.requestItemId, purchaseRequestItems.id))
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .leftJoin(purchaseOrderItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id))
      .leftJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .leftJoin(receiptItems, eq(preventionEmergencyResourceServiceCases.completedReceiptItemId, receiptItems.id))
      .leftJoin(receipts, eq(receiptItems.receiptId, receipts.id))
      .where(eq(preventionEmergencyResourceServiceCases.resourceId, resourceId))
      .orderBy(desc(preventionEmergencyResourceServiceCases.openedAt)),
  ])
  return { ...resource, assignments, events, inspections, serviceCases }
}

export async function assignEmergencyResource(input: unknown, access: InventoryAccess) {
  requireServiceAccess(access)
  const data = z.object({
    pointId: z.string().min(1),
    resourceId: z.string().min(1),
    reason: z.string().trim().min(3).max(300),
  }).parse(input)
  return db.transaction(async (tx) => {
    const [point] = await tx.select().from(preventionEmergencyResourcePoints)
      .where(eq(preventionEmergencyResourcePoints.id, data.pointId)).for("update").limit(1)
    if (!point || !point.isActive) throw new Error(NOT_FOUND)
    assertWorksiteScope(access, point.worksiteId)
    const [resource] = await tx.select().from(preventionEmergencyResources)
      .where(and(
        eq(preventionEmergencyResources.id, data.resourceId),
        eq(preventionEmergencyResources.worksiteId, point.worksiteId),
      )).for("update").limit(1)
    if (!resource) throw new Error(NOT_FOUND)
    if (resource.status !== "operational") throw new Error("Sólo un activo operativo puede cubrir un punto.")
    if (!resource.expiresAt || resource.expiresAt < todayInChile()) throw new Error("Un activo vencido no puede cubrir un punto.")
    if (!resource.typeId || !point.requiredTypeId || resource.typeId !== point.requiredTypeId) {
      throw new Error("El activo no es técnicamente compatible con el punto.")
    }
    const now = new Date().toISOString()
    const activeAssignments = await tx.select().from(preventionEmergencyResourceAssignments).where(and(
      or(
        eq(preventionEmergencyResourceAssignments.pointId, point.id),
        eq(preventionEmergencyResourceAssignments.resourceId, resource.id),
      ),
      isNull(preventionEmergencyResourceAssignments.unassignedAt),
    )).for("update")
    const already = activeAssignments.find((assignment) => assignment.pointId === point.id && assignment.resourceId === resource.id)
    if (already) return { assignmentId: already.id, unchanged: true as const }
    for (const assignment of activeAssignments) {
      await tx.update(preventionEmergencyResourceAssignments).set({
        unassignedAt: now,
        reason: `Reemplazado: ${data.reason}`,
      }).where(eq(preventionEmergencyResourceAssignments.id, assignment.id))
    }
    const assignmentId = `pemgra-${nanoid()}`
    await tx.insert(preventionEmergencyResourceAssignments).values({
      id: assignmentId,
      pointId: point.id,
      resourceId: resource.id,
      actorUserId: access.userId,
      reason: data.reason,
    })
    await tx.insert(preventionEmergencyResourceEvents).values({
      id: `pemgrev-${nanoid()}`,
      worksiteId: resource.worksiteId,
      resourceId: resource.id,
      eventType: "reassigned",
      actorUserId: access.userId,
      sourceType: "coverage_point",
      sourceId: point.id,
      notes: data.reason,
      snapshot: { pointId: point.id, closedAssignmentIds: activeAssignments.map((item) => item.id) },
    })
    return { assignmentId, unchanged: false as const }
  })
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
  assertWorksiteScope(access, resource.worksiteId)

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
