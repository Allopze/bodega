"use server"

import { createHash } from "node:crypto"
import path from "node:path"
import { revalidatePath } from "next/cache"
import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { fuelImportBatches, fuelConsumptionRecords, fuelVehicles } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite, isGlobalRole } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { mkdirp, writeBuffer } from "@/lib/storage/helpers"
import { resolveFuelImportsDir, createFuelImportPath } from "@/lib/storage/config"
import { parseConsumptionExcel, type ImportError } from "@/lib/combustibles/consumption-import"
import { computeBatchTotals, type BatchTotals } from "@/lib/combustibles/consumption-calculations"
import type { ActionState } from "@/lib/validation/masters"

const MAX_FILE_BYTES = 5 * 1024 * 1024

interface BatchMeta {
  worksiteId: string
  periodoDesde: string
  periodoHasta: string
  fuente: string | null
  notas: string | null
}

function sanitizeFileName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "importacion.xlsx"
}

/** Lee y valida el archivo + metadatos del lote desde el FormData. Compartido
 *  por preview y confirm para que ambos apliquen exactamente las mismas reglas. */
async function readImportForm(formData: FormData): Promise<
  | { ok: true; buffer: Buffer; fileName: string; meta: BatchMeta }
  | { ok: false; message: string }
> {
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecciona un archivo XLSX" }
  }
  if (!file.name.toLocaleLowerCase("es-CL").endsWith(".xlsx")) {
    return { ok: false, message: "El archivo debe estar en formato .xlsx" }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: "El archivo no puede superar 5 MB" }
  }

  const worksiteId = String(formData.get("worksiteId") ?? "").trim()
  const periodoDesde = String(formData.get("periodoDesde") ?? "").trim()
  const periodoHasta = String(formData.get("periodoHasta") ?? "").trim()
  const fuente = "Copec"
  const notas = String(formData.get("notas") ?? "").trim() || null

  if (!worksiteId) return { ok: false, message: "Selecciona la faena" }
  if (!periodoDesde || !periodoHasta) return { ok: false, message: "Indica el período (desde y hasta)" }
  if (periodoDesde > periodoHasta) return { ok: false, message: "El período 'desde' no puede ser posterior a 'hasta'" }

  const buffer = Buffer.from(await file.arrayBuffer())
  const validation = validateFileBuffer(new Uint8Array(buffer), file.size, MimeType.SPREADSHEET)
  if (validation.error) return { ok: false, message: validation.error }

  return { ok: true, buffer, fileName: file.name, meta: { worksiteId, periodoDesde, periodoHasta, fuente, notas } }
}

export interface ConsumptionPreviewData {
  totales: BatchTotals
  errores: ImportError[]
  duplicadosEnArchivo: number
  patentesConVehiculo: number
  patentesSinVehiculo: number
  archivoDuplicado: boolean   // ya existe un lote (no revertido) con el mismo hash
  loteDuplicado: boolean      // ya existe un lote (no revertido) para esta faena/período/fuente
}

export async function previewConsumptionImportAction(
  formData: FormData,
): Promise<{ ok: true; data: ConsumptionPreviewData } | { ok: false; message: string }> {
  let session
  try { session = await requirePermission("combustibles:import") }
  catch { return { ok: false, message: "Sin permisos" } }

  const form = await readImportForm(formData)
  if (!form.ok) return form
  const { buffer, meta } = form

  if (meta.worksiteId === "all" && !isGlobalRole(session)) {
    return { ok: false, message: "Solo un administrador global puede importar todas las faenas" }
  }
  if (meta.worksiteId !== "all" && !canAccessWorksite(session, meta.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta faena" }
  }

  const parsed = await parseConsumptionExcel(buffer)
  if (parsed.rows.length === 0 && parsed.errors.length === 0) {
    return { ok: false, message: "El archivo no contiene filas de datos" }
  }

  const hashArchivo = createHash("sha256").update(buffer).digest("hex")
  const [archivoDuplicado, loteDuplicado] = await Promise.all([
    db.query.fuelImportBatches.findFirst({
      where: and(eq(fuelImportBatches.hashArchivo, hashArchivo), ne(fuelImportBatches.estado, "revertido")),
    }),
    meta.worksiteId === "all"
      ? Promise.resolve(undefined)
      : db.query.fuelImportBatches.findFirst({
          where: and(
            eq(fuelImportBatches.worksiteId, meta.worksiteId),
            eq(fuelImportBatches.periodoDesde, meta.periodoDesde),
            eq(fuelImportBatches.periodoHasta, meta.periodoHasta),
            meta.fuente ? eq(fuelImportBatches.fuente, meta.fuente) : undefined,
            ne(fuelImportBatches.estado, "revertido"),
          ),
        }),
  ])

  const plates = [...new Set(parsed.rows.map((r) => r.patente))]
  const vehicles = plates.length > 0
    ? await db.query.fuelVehicles.findMany({ where: inArray(fuelVehicles.plate, plates) })
    : []
  const matchedPlates = new Set(vehicles.map((v) => v.plate))

  return {
    ok: true,
    data: {
      totales: computeBatchTotals(parsed.rows),
      errores: parsed.errors,
      duplicadosEnArchivo: parsed.duplicates.length,
      patentesConVehiculo: plates.filter((p) => matchedPlates.has(p)).length,
      patentesSinVehiculo: plates.filter((p) => !matchedPlates.has(p)).length,
      archivoDuplicado: !!archivoDuplicado,
      loteDuplicado: !!loteDuplicado,
    },
  }
}

export interface ConsumptionImportResult {
  batchId: string
  imported: number
  errors: ImportError[]
}

export async function confirmConsumptionImportAction(
  formData: FormData,
): Promise<{ ok: true; data: ConsumptionImportResult } | { ok: false; message: string }> {
  let session
  try { session = await requirePermission("combustibles:import") }
  catch { return { ok: false, message: "Sin permisos" } }

  const form = await readImportForm(formData)
  if (!form.ok) return form
  const { buffer, fileName, meta } = form

  if (meta.worksiteId === "all" && !isGlobalRole(session)) {
    return { ok: false, message: "Solo un administrador global puede importar todas las faenas" }
  }
  if (meta.worksiteId !== "all" && !canAccessWorksite(session, meta.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta faena" }
  }

  const parsed = await parseConsumptionExcel(buffer)
  if (parsed.rows.length === 0) {
    return { ok: false, message: "No hay filas válidas para importar" }
  }

  const hashArchivo = createHash("sha256").update(buffer).digest("hex")
  const confirmDuplicates = formData.get("confirmDuplicates") === "true"
  if (!confirmDuplicates) {
    const [archivoDuplicado, loteDuplicado] = await Promise.all([
      db.query.fuelImportBatches.findFirst({
        where: and(eq(fuelImportBatches.hashArchivo, hashArchivo), ne(fuelImportBatches.estado, "revertido")),
      }),
      meta.worksiteId === "all"
        ? Promise.resolve(undefined)
        : db.query.fuelImportBatches.findFirst({
            where: and(
              eq(fuelImportBatches.worksiteId, meta.worksiteId),
              eq(fuelImportBatches.periodoDesde, meta.periodoDesde),
              eq(fuelImportBatches.periodoHasta, meta.periodoHasta),
              meta.fuente ? eq(fuelImportBatches.fuente, meta.fuente) : undefined,
              ne(fuelImportBatches.estado, "revertido"),
            ),
          }),
    ])
    if (archivoDuplicado) return { ok: false, message: `Este archivo ya fue importado como lote ${archivoDuplicado.id}` }
    if (loteDuplicado) return { ok: false, message: `Ya existe un lote importado para esta faena, período y fuente (${loteDuplicado.id})` }
  }

  const plates = [...new Set(parsed.rows.map((r) => r.patente))]

  const totales = computeBatchTotals(parsed.rows)
  const vehicles = plates.length > 0
    ? await db.query.fuelVehicles.findMany({ where: inArray(fuelVehicles.plate, plates) })
    : []
  const vehicleByPlate = new Map(vehicles.map((v) => [v.plate, v]))
  const rowsByWorksite = new Map<string, typeof parsed.rows>()
  if (meta.worksiteId === "all") {
    for (const row of parsed.rows) {
      const vehicle = vehicleByPlate.get(row.patente)
      if (!vehicle) continue
      const rows = rowsByWorksite.get(vehicle.worksiteId) ?? []
      rows.push(row)
      rowsByWorksite.set(vehicle.worksiteId, rows)
    }
    if (rowsByWorksite.size === 0) {
      return { ok: false, message: "No hay patentes vinculadas a una faena; registra los vehículos antes de importar todas las faenas" }
    }
  } else {
    rowsByWorksite.set(meta.worksiteId, parsed.rows)
  }
  const batchIds = [...rowsByWorksite.values()].map(() => nanoid())

  // Persistir el archivo original para trazabilidad sólo cuando hay al menos
  // un lote que crear; así una importación global sin vehículos no deja huérfanos.
  const safeName = sanitizeFileName(fileName)
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolveFuelImportsDir()
  await mkdirp(storageDir)
  await writeBuffer(path.join(storageDir, storageName), buffer)
  const archivoPath = createFuelImportPath(storageName)

  await db.transaction(async (tx) => {
    for (const [[worksiteId, rows], batchId] of [...rowsByWorksite.entries()].map((entry, index) => [entry, batchIds[index]!] as const)) {
      const batchTotals = computeBatchTotals(rows)
      await tx.insert(fuelImportBatches).values({
        id: batchId,
        worksiteId,
        fuente: meta.fuente,
        periodoDesde: meta.periodoDesde,
        periodoHasta: meta.periodoHasta,
        archivoNombre: safeName,
        archivoPath,
        hashArchivo,
        estado: "importado",
        totalFilas: batchTotals.totalFilas + (meta.worksiteId === "all" ? 0 : parsed.errors.length),
        filasValidas: batchTotals.totalFilas,
        filasInvalidas: meta.worksiteId === "all" ? 0 : parsed.errors.length,
        totalPatentes: batchTotals.totalPatentes,
        totalTarjetas: batchTotals.totalTarjetas,
        totalTransacciones: batchTotals.totalTransacciones,
        totalCantidad: batchTotals.totalCantidad,
        totalMonto: batchTotals.totalMonto,
        importadoPor: session.user.id,
        notas: meta.notas,
      })
      await tx.insert(fuelConsumptionRecords).values(
        rows.map((row) => ({
          id: nanoid(),
          batchId,
          worksiteId,
          vehicleId: vehicleByPlate.get(row.patente)?.id ?? null,
          patente: row.patente,
          numeroTarjetas: row.numeroTarjetas,
          numeroTransacciones: row.numeroTransacciones,
          cantidadUnidad: row.cantidadUnidad,
          monto: row.monto,
          rendimientoPromedio: row.rendimientoPromedio,
          precioPromedioUnidad: row.cantidadUnidad > 0 ? Math.round((row.monto / row.cantidadUnidad) * 100) / 100 : null,
          periodoDesde: meta.periodoDesde,
          periodoHasta: meta.periodoHasta,
          fuente: meta.fuente,
          rawRow: row.rawRow,
        })),
      )
    }
  })

  await Promise.all([...rowsByWorksite.keys()].map((worksiteId, index) => recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "create",
    entityType: "fuel_import_batch",
    entityId: batchIds[index]!,
    newState: { worksiteId, periodo: `${meta.periodoDesde}..${meta.periodoHasta}`, fuente: meta.fuente, ...totales },
  })))

  revalidatePath("/combustibles")
  revalidatePath("/combustibles/importar")

  return { ok: true, data: { batchId: batchIds[0]!, imported: [...rowsByWorksite.values()].flat().length, errors: parsed.errors } }
}

export async function revertBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:revert") }
  catch { return { ok: false, message: "Sin permisos" } }

  const batchId = String(formData.get("batchId") ?? "")
  if (!batchId) return { ok: false, message: "Lote requerido" }

  const batch = await db.query.fuelImportBatches.findFirst({ where: eq(fuelImportBatches.id, batchId) })
  if (!batch) return { ok: false, message: "Lote no encontrado" }
  if (!canAccessWorksite(session, batch.worksiteId)) return { ok: false, message: "No tienes acceso a esta faena" }
  if (batch.estado === "revertido") return { ok: false, message: "Este lote ya fue revertido" }

  await db.transaction(async (tx) => {
    await tx.delete(fuelConsumptionRecords).where(eq(fuelConsumptionRecords.batchId, batchId))
    await tx.update(fuelImportBatches).set({ estado: "revertido", updatedAt: new Date().toISOString() }).where(eq(fuelImportBatches.id, batchId))
  })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "delete",
    entityType: "fuel_import_batch",
    entityId: batchId,
    oldState: { estado: batch.estado },
    newState: { estado: "revertido" },
  })

  revalidatePath("/combustibles")
  revalidatePath("/combustibles/importar")
  revalidatePath(`/combustibles/importar/${batchId}`)
  return { ok: true, message: "Lote revertido: sus registros fueron eliminados del dashboard" }
}

export async function linkConsumptionPlateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const batchId = String(formData.get("batchId") ?? "")
  const patente = String(formData.get("patente") ?? "").trim().toUpperCase()
  const vehicleId = String(formData.get("vehicleId") ?? "")
  if (!batchId || !patente || !vehicleId) return { ok: false, message: "Datos incompletos" }

  const batch = await db.query.fuelImportBatches.findFirst({ where: eq(fuelImportBatches.id, batchId) })
  if (!batch) return { ok: false, message: "Lote no encontrado" }
  if (!canAccessWorksite(session, batch.worksiteId)) return { ok: false, message: "No tienes acceso a esta faena" }

  const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, vehicleId) })
  if (!vehicle) return { ok: false, message: "Vehículo no encontrado" }

  const updated = await db.update(fuelConsumptionRecords)
    .set({ vehicleId, updatedAt: new Date().toISOString() })
    .where(and(eq(fuelConsumptionRecords.batchId, batchId), eq(fuelConsumptionRecords.patente, patente)))
    .returning({ id: fuelConsumptionRecords.id })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "update",
    entityType: "fuel_consumption_record",
    entityId: batchId,
    newState: { patente, vehicleId, count: updated.length },
  })

  revalidatePath(`/combustibles/importar/${batchId}`)
  revalidatePath("/combustibles")
  return { ok: true, message: `${updated.length} registro(s) vinculados a la patente ${vehicle.plate}` }
}
