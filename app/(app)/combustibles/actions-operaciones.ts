"use server"

import { createHash } from "node:crypto"
import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelOperationBatches, fuelOperationRecords, fuelVehicles } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import { createFuelImportPath, resolveFuelImportsDir, resolveStorageFile } from "@/lib/storage/config"
import {
  parseFuelOperationsExcel,
  plateMatchKey,
  matchByNameOrContains,
  type ImportError,
} from "@/lib/combustibles/operations-import"
import {
  computeTotales,
  existingOperationKeys,
  insertInChunks,
  lookupMatchedPlateKeys,
  operationRowKey,
  readImportFile,
  requireGlobalImportSession,
  sanitizeFileName,
  type Totales,
} from "@/lib/combustibles/operations-import-shared"
import { buildOperationRejectionsXlsx, persistOperationRejections, type OperationRejection } from "@/lib/combustibles/operations-import-rejections"
import { buildOperationsTemplateBase64 } from "@/lib/combustibles/operations-import-template"
import { auditResetDecisions } from "@/lib/combustibles/projection-audit"
import { projectOperationRecords } from "@/lib/combustibles/control/projection"
import { fuelEquipmentTypeIdForLegacy, fuelMetricDefaultsForLegacy } from "@/lib/combustibles/validation"
import { todayInChile } from "@/lib/utils"

/** Lo que viaja al cliente de cada rechazo: sin la fila original, que puede pesar mucho en un archivo de miles de filas. */
function publicErrors(errors: ImportError[]): ImportError[] {
  return errors.map(({ rowIndex, field, message }) => ({ rowIndex, field, message }))
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
      errores: publicErrors(parsed.errors),
      equiposConVehiculo,
      equiposSinVehiculo: equiposVistos.size - equiposConVehiculo,
      faenasSinMatch: [...faenasSinMatch].sort(),
      proveedoresSinMatch: [...proveedoresSinMatch].sort(),
      archivoDuplicado: !!archivoDuplicado,
      duplicateRows,
    },
  }
}

export interface OperationsImportResultSummary {
  batchId: string
  imported: number
  /** Filas del archivo que ya existían como carga de un lote vigente y se omitieron. */
  duplicateRows: number
  errors: ImportError[]
  /** Filas que no se convirtieron en carga: errores del archivo más las que la proyección no pudo ubicar. Detalle en el lote. */
  rejected: number
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
      const recordRows = newRows.map((row) => {
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
      })
      await insertInChunks(tx, fuelOperationRecords, recordRows)

      // Cada carga entra a la serie canónica con el rendimiento calculado por el
      // servidor (el «Rendimiento» digitado solo queda como declarado). Lo que la
      // proyección no puede convertir en carga —sin faena, sin litros— se
      // devuelve en `skipped` y se guarda junto a los errores del archivo.
      const projection = await projectOperationRecords(tx, recordRows.map((record) => record.id))
      await auditResetDecisions(tx, projection.resetLoadIds, { userId: session.user.id, userEmail: session.user.email ?? undefined }, null)
      const metaByRecordId = new Map(recordRows.map((record, index) => [record.id, { rowIndex: newRows[index]!.rowIndex, rawRow: newRows[index]!.rawRow }]))
      const rejections: OperationRejection[] = [
        ...parsed.errors.map((error) => ({ rowIndex: error.rowIndex, field: error.field, message: error.message, rawRow: error.rawRow ?? null })),
        ...projection.skipped.map((item) => ({
          rowIndex: metaByRecordId.get(item.recordId)?.rowIndex ?? 0,
          field: null,
          message: item.reason,
          rawRow: metaByRecordId.get(item.recordId)?.rawRow ?? null,
        })),
      ]
      await persistOperationRejections(tx, batchId, rejections)

      // Auditoría dentro de la misma transacción que el lote (CO-025).
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "create",
        entityType: "fuel_operation_batch",
        entityId: batchId,
        newState: {
          periodo: `${totales.periodoDesde}..${totales.periodoHasta}`,
          ...totales,
          filasRechazadas: rejections.length,
          rechazadasEnArchivo: parsed.errors.length,
          rechazadasEnProyeccion: projection.skipped.length,
          cargasProyectadas: projection.projected,
        },
      }, tx)

      return { ok: true as const, batchId, imported: newRows.length, duplicateRows, rejected: rejections.length }
    })

    if (!result.ok) {
      await removeFile(absolutePath)
      return { ok: false, message: result.message }
    }

    // Sin revalidatePath aquí. En Next.js 16, CUALQUIER llamada a
    // revalidatePath/refresh dentro de una server action re-renderiza la ruta
    // ACTUAL (donde vive este wizard) en la misma respuesta, sin importar qué
    // ruta se pase. Hasta 2026-09-24 ese re-render volvía a montar la
    // plataforma entera (AppShell exportado como objeto memo) y perdía el
    // estado local del wizard (paso "done"); ya no ocurre.
    // Ver node_modules/next/dist/docs/01-app/02-guides/server-actions.md.
    // Las páginas afectadas (dashboard, vehículos, flota, mantenciones) son
    // dinámicas (usan sesión/cookies) y se renderizan frescas en cada visita
    // real, así que no necesitan revalidación explícita aquí.

    return { ok: true, data: { batchId: result.batchId, imported: result.imported, duplicateRows: result.duplicateRows, errors: publicErrors(parsed.errors), rejected: result.rejected } }
  } catch (error) {
    await removeFile(absolutePath)
    throw error
  }
}


/** Plantilla del consolidado de cargas: los mismos encabezados que lee el importador, más una hoja de instrucciones. */
export async function downloadOperationsTemplateAction() {
  try { await requirePermission("combustibles:import") }
  catch { return { ok: false as const, message: "Sin permisos" } }
  return { ok: true as const, data: { base64: await buildOperationsTemplateBase64(), filename: "plantilla_cargas_combustible.xlsx" } }
}

/** Excel con las filas rechazadas de un lote (motivo + columnas originales), para corregirlas y volver a subirlas. */
export async function exportOperationRejectionsAction(batchId: string) {
  let session
  try { session = await requireGlobalImportSession("combustibles:import") }
  catch (e) { return { ok: false as const, message: e instanceof Error ? e.message : "Sin permisos" } }
  const batch = await db.query.fuelOperationBatches.findFirst({ where: eq(fuelOperationBatches.id, batchId), columns: { id: true, archivoNombre: true } })
  if (!batch) return { ok: false as const, message: "Lote no encontrado" }
  const { base64, rowCount } = await buildOperationRejectionsXlsx(batch.id, batch.archivoNombre, session)
  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "fuel_operation_rejections_export",
    entityId: batch.id,
    newState: { rowCount },
  })
  return { ok: true as const, data: { base64, filename: `filas_rechazadas_${todayInChile()}.xlsx` } }
}
