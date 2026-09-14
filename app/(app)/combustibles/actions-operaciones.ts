"use server"

import { createHash } from "node:crypto"
import { revalidatePath } from "next/cache"
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyCases, fuelOperationBatches, fuelOperationRecords, fuelVehicles, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import { createFuelImportPath, resolveFuelImportsDir, resolveStorageFile } from "@/lib/storage/config"
import {
  parseFuelOperationsExcel,
  plateMatchKey,
  matchByNameOrContains,
  type ImportError,
} from "@/lib/combustibles/operations-import"
import type { ActionState } from "@/lib/validation/masters"
import { fuelEquipmentTypeIdForLegacy, fuelMetricDefaultsForLegacy } from "@/lib/combustibles/validation"

const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * Este log operacional abarca varias faenas por archivo (a diferencia del
 * import de consumos, que declara una sola faena por lote) — se restringe a
 * roles con visibilidad global para no importar/revertir datos de faenas que
 * el usuario no puede ver.
 */
async function requireGlobalImportSession(permission: "combustibles:import" | "combustibles:revert") {
  const session = await requirePermission(permission)
  if (!isGlobalRole(session)) {
    throw new Error("Esta importación abarca múltiples faenas; requiere acceso global")
  }
  return session
}

function sanitizeFileName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "importacion.xlsx"
}

async function readImportFile(formData: FormData): Promise<
  | { ok: true; buffer: Buffer; fileName: string }
  | { ok: false; message: string }
> {
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecciona un archivo Excel" }
  }
  if (!file.name.toLocaleLowerCase("es-CL").endsWith(".xlsx")) {
    return { ok: false, message: "El archivo debe estar en formato .xlsx" }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: "El archivo no puede superar 10 MB" }
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const validation = validateFileBuffer(new Uint8Array(buffer), file.size, MimeType.SPREADSHEET)
  if (validation.error) return { ok: false, message: validation.error }
  return { ok: true, buffer, fileName: file.name }
}

interface Totales {
  totalFilas: number
  totalEquipos: number
  totalLitros: number
  totalMonto: number
  periodoDesde: string
  periodoHasta: string
}

function computeTotales(rows: Awaited<ReturnType<typeof parseFuelOperationsExcel>>["rows"]): Totales {
  const fechas = rows.map((r) => r.fecha).sort()
  return {
    totalFilas: rows.length,
    totalEquipos: new Set(rows.map((r) => r.plate)).size,
    totalLitros: Math.round(rows.reduce((s, r) => s + r.liters, 0) * 10000) / 10000,
    totalMonto: Math.round(rows.reduce((s, r) => s + (r.monto ?? 0), 0) * 100) / 100,
    periodoDesde: fechas[0] ?? "",
    periodoHasta: fechas[fechas.length - 1] ?? "",
  }
}

export interface OperationsPreviewData {
  totales: Totales
  errores: ImportError[]
  equiposConVehiculo: number
  equiposSinVehiculo: number
  faenasSinMatch: string[]
  proveedoresSinMatch: string[]
  archivoDuplicado: boolean
  /** Filas del archivo que ya existen como carga de un lote vigente (se omitirán al confirmar). */
  duplicateRows: number
}

export async function previewOperationsImportAction(
  formData: FormData,
): Promise<{ ok: true; data: OperationsPreviewData } | { ok: false; message: string }> {
  try { await requireGlobalImportSession("combustibles:import") }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Sin permisos" } }

  const form = await readImportFile(formData)
  if (!form.ok) return form
  const { buffer } = form

  const parsed = await parseFuelOperationsExcel(buffer)
  if (parsed.rows.length === 0 && parsed.errors.length === 0) {
    return { ok: false, message: "El archivo no contiene filas de datos" }
  }

  const hashArchivo = createHash("sha256").update(buffer).digest("hex")
  const archivoDuplicado = await db.query.fuelOperationBatches.findFirst({
    where: and(eq(fuelOperationBatches.hashArchivo, hashArchivo), ne(fuelOperationBatches.estado, "revertido")),
  })

  const [allWorksites, allSuppliers, matchedVehicleKeys, existingKeys] = await Promise.all([
    db.query.worksites.findMany({ columns: { id: true, name: true } }),
    db.query.fuelSuppliers.findMany({ columns: { id: true, name: true } }),
    lookupMatchedPlateKeys(parsed.rows.map((r) => r.plate)),
    existingOperationKeys(parsed.rows),
  ])
  const duplicateRows = parsed.rows.filter((row) => existingKeys.has(operationRowKey(row))).length

  const faenasSinMatch = new Set<string>()
  const proveedoresSinMatch = new Set<string>()
  let equiposConVehiculo = 0
  const equiposVistos = new Set<string>()

  for (const row of parsed.rows) {
    const key = plateMatchKey(row.plate)
    if (!equiposVistos.has(row.plate)) {
      equiposVistos.add(row.plate)
      if (matchedVehicleKeys.has(key)) equiposConVehiculo++
    }
    if (row.faenaNombre && !matchByNameOrContains(row.faenaNombre, allWorksites)) {
      faenasSinMatch.add(row.faenaNombre)
    }
    if (row.proveedorNombre && !matchByNameOrContains(row.proveedorNombre, allSuppliers)) {
      proveedoresSinMatch.add(row.proveedorNombre)
    }
  }

  return {
    ok: true,
    data: {
      totales: computeTotales(parsed.rows),
      errores: parsed.errors,
      equiposConVehiculo,
      equiposSinVehiculo: equiposVistos.size - equiposConVehiculo,
      faenasSinMatch: [...faenasSinMatch].sort(),
      proveedoresSinMatch: [...proveedoresSinMatch].sort(),
      archivoDuplicado: !!archivoDuplicado,
      duplicateRows,
    },
  }
}

async function lookupMatchedPlateKeys(plates: string[]): Promise<Set<string>> {
  const uniquePlates = [...new Set(plates)]
  if (uniquePlates.length === 0) return new Set()
  const vehicles = await db.query.fuelVehicles.findMany({ columns: { plate: true } })
  const vehicleKeys = new Set(vehicles.map((v) => plateMatchKey(v.plate)))
  return new Set(uniquePlates.map(plateMatchKey).filter((k) => vehicleKeys.has(k)))
}

/** Identidad natural de una carga del log operacional: la combinación que
 *  distingue dos eventos reales. `undefined`/`null` se normalizan a cadena
 *  vacía para que el mismo campo ausente en ambos lados siga comparando igual. */
function operationRowKey(row: { plate: string; fecha: string; horaCarga: string | null; liters: number; horometro: number | null }): string {
  return [plateMatchKey(row.plate), row.fecha, row.horaCarga ?? "", row.liters, row.horometro ?? ""].join("|")
}

/**
 * Filas del archivo que YA existen como carga real (de un lote no revertido).
 * Antes la deduplicación era sólo por hash del ARCHIVO completo: un
 * consolidado reimportado con filas nuevas AÑADIDAS al final tiene un hash
 * distinto, así que pasaba el guard e insertaba de nuevo TODO lo ya cargado.
 * Acotado por rango de fecha del archivo — `fecha` está indexada — para no
 * escanear la tabla completa en cada confirmación.
 */
async function existingOperationKeys(
  rows: Awaited<ReturnType<typeof parseFuelOperationsExcel>>["rows"],
  client: Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db = db,
): Promise<Set<string>> {
  if (rows.length === 0) return new Set()
  const fechas = rows.map((r) => r.fecha)
  const minFecha = fechas.reduce((a, b) => (a < b ? a : b))
  const maxFecha = fechas.reduce((a, b) => (a > b ? a : b))
  const existing = await client.select({
    plate: fuelOperationRecords.plate,
    fecha: fuelOperationRecords.fecha,
    horaCarga: fuelOperationRecords.horaCarga,
    liters: fuelOperationRecords.liters,
    horometro: fuelOperationRecords.horometro,
  })
    .from(fuelOperationRecords)
    .innerJoin(fuelOperationBatches, eq(fuelOperationRecords.batchId, fuelOperationBatches.id))
    .where(and(
      gte(fuelOperationRecords.fecha, minFecha),
      lte(fuelOperationRecords.fecha, maxFecha),
      ne(fuelOperationBatches.estado, "revertido"),
    ))
  return new Set(existing.map(operationRowKey))
}

/** Postgres rechaza más de 65.535 parámetros por sentencia — 25 columnas por
 *  fila dan un techo real de ~2.621 filas, muy por debajo de lo que cabe en
 *  el límite de 10 MB del archivo. Se inserta en lotes. */
const INSERT_CHUNK_SIZE = 2000

async function insertInChunks<T>(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], table: typeof fuelOperationRecords, rows: T[]) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    await tx.insert(table).values(rows.slice(i, i + INSERT_CHUNK_SIZE) as (typeof fuelOperationRecords.$inferInsert)[])
  }
}

export interface OperationsImportResultSummary {
  batchId: string
  imported: number
  /** Filas del archivo que ya existían como carga de un lote vigente y se omitieron. */
  duplicateRows: number
  errors: ImportError[]
}

export async function confirmOperationsImportAction(
  formData: FormData,
): Promise<{ ok: true; data: OperationsImportResultSummary } | { ok: false; message: string }> {
  let session
  try { session = await requireGlobalImportSession("combustibles:import") }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Sin permisos" } }

  const form = await readImportFile(formData)
  if (!form.ok) return form
  const { buffer, fileName } = form

  const parsed = await parseFuelOperationsExcel(buffer)
  if (parsed.rows.length === 0) {
    return { ok: false, message: "No hay filas válidas para importar" }
  }

  const hashArchivo = createHash("sha256").update(buffer).digest("hex")
  const confirmDuplicates = formData.get("confirmDuplicates") === "true"
  const autoCreateVehicles = formData.get("autoCreateVehicles") === "true"

  // Catálogos de referencia: de sólo lectura, no forman parte de la condición
  // de carrera que el lock protege — no hace falta releerlos bajo el lock.
  const [allWorksites, allSuppliers, existingVehicles] = await Promise.all([
    db.query.worksites.findMany({ columns: { id: true, name: true } }),
    db.query.fuelSuppliers.findMany({ columns: { id: true, name: true } }),
    db.query.fuelVehicles.findMany({ columns: { id: true, plate: true, code: true, type: true, brand: true, model: true, year: true } }),
  ])
  const vehicleByKey = new Map(existingVehicles.map((v) => [plateMatchKey(v.plate), v]))

  // No se puede escribir a disco DENTRO de una transacción de Postgres — se
  // escribe antes y, si el lote resulta duplicado bajo el lock o la
  // transacción falla, se compensa borrándolo (mismo patrón que TAE/TCT).
  const safeName = sanitizeFileName(fileName)
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolveFuelImportsDir()
  await mkdirp(storageDir)
  const absolutePath = resolveStorageFile(storageDir, storageName)
  await writeBuffer(absolutePath, buffer)
  const archivoPath = createFuelImportPath(storageName)

  const lockKey = `fuel_ops:${hashArchivo}`

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`)

      // Recheck bajo el lock (CO-026): tanto el duplicado por hash de archivo
      // como el dedupe secundario por fila corrían sin lock, así que dos
      // confirmaciones simultáneas del mismo archivo (o de un consolidado que
      // se solapa con uno ya importado) podían insertar el mismo lote dos veces.
      if (!confirmDuplicates) {
        const archivoDuplicado = await tx.query.fuelOperationBatches.findFirst({
          where: and(eq(fuelOperationBatches.hashArchivo, hashArchivo), ne(fuelOperationBatches.estado, "revertido")),
        })
        if (archivoDuplicado) return { ok: false as const, message: `Este archivo ya fue importado como lote ${archivoDuplicado.id}` }
      }

      const existingKeys = await existingOperationKeys(parsed.rows, tx)
      // Filas que ya existen como carga real de un lote vigente: se excluyen del
      // lote nuevo en vez de duplicarlas. `duplicateRows` no cuenta como error —
      // es información, no un archivo inválido — y se reporta aparte en el resumen.
      const newRows = parsed.rows.filter((row) => !existingKeys.has(operationRowKey(row)))
      const duplicateRows = parsed.rows.length - newRows.length
      if (newRows.length === 0) {
        return { ok: false as const, message: `Las ${duplicateRows} filas del archivo ya estaban importadas en un lote vigente. No hay filas nuevas que importar.` }
      }

      const batchId = nanoid()
      const totales = computeTotales(newRows)

      await tx.insert(fuelOperationBatches).values({
        id: batchId,
        archivoNombre: safeName,
        archivoPath,
        hashArchivo,
        estado: "importado",
        periodoDesde: totales.periodoDesde,
        periodoHasta: totales.periodoHasta,
        totalFilas: totales.totalFilas + parsed.errors.length,
        filasValidas: totales.totalFilas,
        filasInvalidas: parsed.errors.length,
        totalEquipos: totales.totalEquipos,
        totalLitros: totales.totalLitros,
        totalMonto: totales.totalMonto,
        importadoPor: session.user.id,
        notas: String(formData.get("notas") ?? "").trim() || null,
      })

      // Autocompletar/crear catálogo de vehículos a partir del log — opt-in
      // explícito para creación (ver decisión en el plan: no crear ~100
      // vehículos sin revisión humana por defecto).
      const seenPlates = new Set<string>()
      for (const row of parsed.rows) {
        if (seenPlates.has(row.plate)) continue
        seenPlates.add(row.plate)
        const key = plateMatchKey(row.plate)
        const existing = vehicleByKey.get(key)

        if (existing) {
          const patch: Partial<typeof fuelVehicles.$inferInsert> = {}
          if (!existing.code && row.code) patch.code = row.code
          if (!existing.brand && row.marca) patch.brand = row.marca
          if (!existing.model && row.modelo) patch.model = row.modelo
          if (!existing.year && row.anio) patch.year = row.anio
          if (Object.keys(patch).length > 0) {
            await tx.update(fuelVehicles).set(patch).where(eq(fuelVehicles.id, existing.id))
          }
          continue
        }

        if (autoCreateVehicles && row.tipo) {
          const worksite = row.faenaNombre ? matchByNameOrContains(row.faenaNombre, allWorksites) : null
          if (!worksite) continue // sin faena matcheada no se puede crear (worksiteId es NOT NULL)
          const id = nanoid()
          const metricDefaults = fuelMetricDefaultsForLegacy(row.tipo)
          await tx.insert(fuelVehicles).values({
            id,
            plate: row.plate,
            code: row.code,
            type: row.tipo,
            equipmentTypeId: fuelEquipmentTypeIdForLegacy(row.tipo),
            ...metricDefaults,
            brand: row.marca,
            model: row.modelo,
            year: row.anio,
            worksiteId: worksite.id,
          })
          vehicleByKey.set(key, { id, plate: row.plate, code: row.code, type: row.tipo, brand: row.marca, model: row.modelo, year: row.anio })
        }
      }

      // `newRows`, no `parsed.rows`: excluye las cargas ya existentes. En lotes
      // (INSERT_CHUNK_SIZE) para no superar el límite de parámetros de Postgres.
      await insertInChunks(tx, fuelOperationRecords, newRows.map((row) => {
        const vehicle = vehicleByKey.get(plateMatchKey(row.plate))
        const worksite = row.faenaNombre ? matchByNameOrContains(row.faenaNombre, allWorksites) : null
        const supplier = row.proveedorNombre ? matchByNameOrContains(row.proveedorNombre, allSuppliers) : null
        return {
          id: nanoid(),
          batchId,
          worksiteId: worksite?.id ?? null,
          vehicleId: vehicle?.id ?? null,
          plate: row.plate,
          code: row.code,
          faenaNombre: row.faenaNombre,
          tipo: row.tipo,
          marca: row.marca,
          modelo: row.modelo,
          anio: row.anio,
          fecha: row.fecha,
          horaCarga: row.horaCarga,
          horometro: row.horometro,
          medidoPor: row.medidoPor,
          liters: row.liters,
          operador: row.operador,
          supervisor: row.supervisor,
          proveedorNombre: row.proveedorNombre,
          fuelSupplierId: supplier?.id ?? null,
          precioLitro: row.precioLitro,
          monto: row.monto,
          rendimiento: row.rendimiento,
          tipoRendimiento: row.tipoRendimiento,
          rawRow: row.rawRow,
        }
      }))

      // Auditoría dentro de la misma transacción que el lote (CO-025).
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "create",
        entityType: "fuel_operation_batch",
        entityId: batchId,
        newState: { periodo: `${totales.periodoDesde}..${totales.periodoHasta}`, ...totales },
      }, tx)

      return { ok: true as const, batchId, imported: newRows.length, duplicateRows }
    })

    if (!result.ok) {
      await removeFile(absolutePath)
      return { ok: false, message: result.message }
    }

    // Sin revalidatePath aquí a propósito: en Next.js 16, CUALQUIER llamada a
    // revalidatePath/refresh dentro de una server action fuerza a Next a
    // re-renderizar y re-transmitir la ruta ACTUAL (donde vive este wizard) en
    // la misma respuesta — sin importar qué ruta se pase — lo que remonta el
    // árbol de cliente y pierde el estado local del wizard (paso "done").
    // Ver node_modules/next/dist/docs/01-app/02-guides/server-actions.md.
    // Las páginas afectadas (dashboard, vehículos, flota, mantenciones) son
    // dinámicas (usan sesión/cookies) y se renderizan frescas en cada visita
    // real, así que no necesitan revalidación explícita aquí.

    return { ok: true, data: { batchId: result.batchId, imported: result.imported, duplicateRows: result.duplicateRows, errors: parsed.errors } }
  } catch (error) {
    await removeFile(absolutePath)
    throw error
  }
}

export async function revertBatchOperationsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireGlobalImportSession("combustibles:revert") }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Sin permisos" } }

  const batchId = String(formData.get("batchId") ?? "")
  if (!batchId) return { ok: false, message: "Lote requerido" }

  const batch = await db.query.fuelOperationBatches.findFirst({ where: eq(fuelOperationBatches.id, batchId) })
  if (!batch) return { ok: false, message: "Lote no encontrado" }
  if (batch.estado === "revertido") return { ok: false, message: "Este lote ya fue revertido" }

  await db.transaction(async (tx) => {
    // Capturar los ids ANTES de borrar: `fuel_anomaly_cases.reference_entity_id`
    // es una referencia polimórfica sin FK (apunta a cualquiera de varias
    // tablas), así que borrar estas filas no falla — deja los casos abiertos
    // apuntando a un `fuel_operation_record` que ya no existe, invisibles pero
    // eternamente "activos" en /combustibles/anomalias.
    const deletedRows = await tx.delete(fuelOperationRecords)
      .where(eq(fuelOperationRecords.batchId, batchId))
      .returning({ id: fuelOperationRecords.id })
    if (deletedRows.length > 0) {
      const deletedIds = deletedRows.map((r) => r.id)
      const now = new Date().toISOString()
      await tx.update(fuelAnomalyCases).set({
        status: "dismissed",
        resolution: `Descartado automáticamente: el lote de origen (${batchId}) fue revertido.`,
        resolvedById: session.user.id,
        resolvedAt: now,
        updatedAt: now,
      }).where(and(
        eq(fuelAnomalyCases.referenceEntityType, "fuel_operation_record"),
        inArray(fuelAnomalyCases.referenceEntityId, deletedIds),
        // No pisar un caso que un humano ya cerró — sólo los que seguían abiertos.
        inArray(fuelAnomalyCases.status, ["open", "in_review", "reopened"]),
      ))
    }
    await tx.update(fuelOperationBatches).set({ estado: "revertido", updatedAt: new Date().toISOString() }).where(eq(fuelOperationBatches.id, batchId))
  })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "delete",
    entityType: "fuel_operation_batch",
    entityId: batchId,
    oldState: { estado: batch.estado },
    newState: { estado: "revertido" },
  })

  revalidatePath("/combustibles")
  revalidatePath("/combustibles/importar")
  revalidatePath(`/combustibles/importar/operaciones/${batchId}`)
  return { ok: true, message: "Lote revertido: sus registros fueron eliminados del dashboard" }
}

export async function linkOperationVehicleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles", "/combustibles/importar") }
  catch { return { ok: false, message: "Sin permisos" } }
  // Los lotes de operaciones son multi-faena: se restringe a roles globales,
  // igual que el resto del flujo (import/preview/confirm/revert/detalle). Sin
  // esto, un rol scoped con manage_vehicles podría vincular registros de
  // faenas que no puede ver invocando la action directamente.
  if (!isGlobalRole(session)) return { ok: false, message: "Requiere acceso global a todas las faenas" }

  const batchId = String(formData.get("batchId") ?? "")
  const plate = String(formData.get("plate") ?? "").trim().toUpperCase()
  const vehicleId = String(formData.get("vehicleId") ?? "")
  if (!batchId || !plate || !vehicleId) return { ok: false, message: "Datos incompletos" }

  const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, vehicleId) })
  if (!vehicle) return { ok: false, message: "Vehículo no encontrado" }

  const updated = await db.update(fuelOperationRecords)
    .set({ vehicleId })
    .where(and(eq(fuelOperationRecords.batchId, batchId), eq(fuelOperationRecords.plate, plate)))
    .returning({ id: fuelOperationRecords.id })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "update",
    entityType: "fuel_operation_record",
    entityId: batchId,
    newState: { plate, vehicleId, count: updated.length },
  })

  revalidatePath(`/combustibles/importar/operaciones/${batchId}`)
  revalidatePath("/combustibles")
  return { ok: true, message: `${updated.length} registro(s) vinculados a la patente ${vehicle.plate}` }
}

export async function linkOperationWorksiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles", "/combustibles/importar") }
  catch { return { ok: false, message: "Sin permisos" } }
  // Lote multi-faena: restringido a roles globales (ver linkOperationVehicleAction).
  if (!isGlobalRole(session)) return { ok: false, message: "Requiere acceso global a todas las faenas" }

  const batchId = String(formData.get("batchId") ?? "")
  const faenaNombre = String(formData.get("faenaNombre") ?? "")
  const worksiteId = String(formData.get("worksiteId") ?? "")
  if (!batchId || !faenaNombre || !worksiteId) return { ok: false, message: "Datos incompletos" }

  const worksite = await db.query.worksites.findFirst({ where: eq(worksites.id, worksiteId) })
  if (!worksite) return { ok: false, message: "Faena no encontrada" }

  const updated = await db.update(fuelOperationRecords)
    .set({ worksiteId })
    .where(and(eq(fuelOperationRecords.batchId, batchId), eq(fuelOperationRecords.faenaNombre, faenaNombre)))
    .returning({ id: fuelOperationRecords.id })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "update",
    entityType: "fuel_operation_record",
    entityId: batchId,
    newState: { faenaNombre, worksiteId, count: updated.length },
  })

  revalidatePath(`/combustibles/importar/operaciones/${batchId}`)
  revalidatePath("/combustibles")
  return { ok: true, message: `${updated.length} registro(s) vinculados a la faena ${worksite.name}` }
}
