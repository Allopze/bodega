"use server"

import { createHash } from "node:crypto"
import { revalidatePath } from "next/cache"
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, fuelImportBatches, fuelProviderMappings, fuelProviderTransactions, fuelVehicles } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite, isGlobalRole } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import { createFuelImportPath, resolveFuelImportsDir, resolveStorageFile } from "@/lib/storage/config"
import { parseConsumptionExcel, type ImportError } from "@/lib/combustibles/consumption-import"
import { computeBatchTotals, type BatchTotals } from "@/lib/combustibles/consumption-calculations"
import type { ActionState } from "@/lib/validation/masters"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"

const MAX_FILE_BYTES = 5 * 1024 * 1024

interface BatchMeta {
  worksiteId: string
  periodoDesde: string
  periodoHasta: string
  fuente: string
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
    return { ok: false, message: "Selecciona un archivo Excel" }
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

/** Resuelve patente→vehículo respetando el invariante «vehículo y registro comparten
 *  faena», el mismo que exigen linkConsumptionPlateAction y el alta manual de cargas
 *  (actions-module/loads.ts). En "all" la faena se deriva del vehículo, así que ahí no
 *  hay nada que filtrar. Compartido por preview y confirm para que ambos cuenten igual.
 *
 *  El matching va por `plateMatchKey` y no por igualdad exacta: el catálogo guarda
 *  la patente con el formato del alta manual (con o sin guion) y la planilla trae
 *  el suyo — "AB-CD12" contra "ABCD12" no calzaba y la fila quedaba sin vehículo,
 *  o se descartaba del import entero en modo "all", pese a que el vehículo existe.
 *  Es el mismo criterio que las sincronizaciones adoptaron por este mismo bug.
 *
 *  A propósito NO consulta `fuel_provider_mappings`: un mapping puede apuntar a un
 *  vehículo de otra faena y honrarlo acá rompería el invariante de arriba.
 *
 *  `fuel_vehicles.plate` es único sobre el texto crudo, así que dos filas pueden
 *  colapsar a la misma clave. Esa clave queda en `null` en vez de elegir una en
 *  silencio: cuál de las dos fichas es la buena es una decisión de catálogo. */
async function findVehiclesByPlate(plates: string[], worksiteId: string) {
  const byPlateKey = new Map<string, typeof fuelVehicles.$inferSelect | null>()
  if (plates.length === 0) return byPlateKey
  const wanted = new Set(plates.map(plateMatchKey))
  const vehicles = await db.query.fuelVehicles.findMany({
    where: worksiteId === "all" ? undefined : eq(fuelVehicles.worksiteId, worksiteId),
  })
  for (const vehicle of vehicles) {
    // El invariante de faena se vuelve a comprobar acá y no sólo en el WHERE: es
    // la regla de negocio del importador, no un detalle de la consulta.
    if (worksiteId !== "all" && vehicle.worksiteId !== worksiteId) continue
    const key = plateMatchKey(vehicle.plate)
    if (!wanted.has(key)) continue
    byPlateKey.set(key, byPlateKey.has(key) ? null : vehicle)
  }
  return byPlateKey
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
  try { session = await requirePermission("combustibles:import", "/combustibles/importar") }
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
            eq(fuelImportBatches.fuente, meta.fuente),
            ne(fuelImportBatches.estado, "revertido"),
          ),
        }),
  ])

  const plates = [...new Set(parsed.rows.map((r) => r.patente))]
  const vehiclesByPlateKey = await findVehiclesByPlate(plates, meta.worksiteId)
  const matched = (plate: string) => vehiclesByPlateKey.get(plateMatchKey(plate)) ?? null

  return {
    ok: true,
    data: {
      totales: computeBatchTotals(parsed.rows),
      errores: parsed.errors,
      duplicadosEnArchivo: parsed.duplicates.length,
      patentesConVehiculo: plates.filter((p) => matched(p)).length,
      patentesSinVehiculo: plates.filter((p) => !matched(p)).length,
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
  try { session = await requirePermission("combustibles:import", "/combustibles/importar") }
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

  const plates = [...new Set(parsed.rows.map((r) => r.patente))]
  const vehiclesByPlateKey = await findVehiclesByPlate(plates, meta.worksiteId)
  const vehicleFor = (plate: string) => vehiclesByPlateKey.get(plateMatchKey(plate)) ?? null
  const rowsByWorksite = new Map<string, typeof parsed.rows>()
  // Antes las filas sin vehículo en "all" desaparecían con `continue`, sin
  // dejar rastro ni en el resumen ni en ningún lado (CO-027): ahora se
  // devuelven como error, igual que las filas que el parser ya rechaza.
  const unmatchedErrors: ImportError[] = []
  if (meta.worksiteId === "all") {
    for (const row of parsed.rows) {
      const vehicle = vehicleFor(row.patente)
      if (!vehicle) {
        // La clave presente con valor nulo es una colisión del catálogo, no una
        // patente desconocida: el mensaje tiene que decir qué hay que arreglar.
        const ambigua = vehiclesByPlateKey.has(plateMatchKey(row.patente))
        unmatchedErrors.push({
          rowIndex: row.rowIndex,
          field: "PATENTE",
          message: ambigua
            ? `Patente "${row.patente}" coincide con más de un vehículo del catálogo; unifica las fichas antes de importar`
            : `Patente "${row.patente}" sin vehículo asociado a ninguna faena`,
        })
        continue
      }
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
  // No se puede escribir a disco DENTRO de una transacción de Postgres — se
  // escribe antes y, si la transacción de abajo falla o detecta un duplicado
  // bajo el lock, se compensa borrándolo (mismo patrón que createTaeSubmission).
  const safeName = sanitizeFileName(fileName)
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolveFuelImportsDir()
  await mkdirp(storageDir)
  const absolutePath = resolveStorageFile(storageDir, storageName)
  await writeBuffer(absolutePath, buffer)
  const archivoPath = createFuelImportPath(storageName)

  // "all" es una sola operación atómica (reparte en N lotes, uno por faena);
  // de faena única, el lock incluye la faena para no serializar contra otra
  // faena distinta que comparta hash por coincidencia. Prefijo de dominio para
  // no colisionar con el lock de otro importador sobre el mismo hashtext.
  const lockKey = meta.worksiteId === "all" ? `fuel_tct_all:${hashArchivo}` : `fuel_tct:${hashArchivo}:${meta.worksiteId}`

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`)

      // Recheck bajo el lock: el chequeo previo (para el mensaje de "¿confirmas
      // duplicado?" en el preview) corre sin lock y puede quedar obsoleto entre
      // que el usuario ve el preview y confirma (CO-026).
      if (!confirmDuplicates) {
        const [archivoDuplicado, loteDuplicado] = await Promise.all([
          tx.query.fuelImportBatches.findFirst({
            where: and(eq(fuelImportBatches.hashArchivo, hashArchivo), ne(fuelImportBatches.estado, "revertido")),
          }),
          meta.worksiteId === "all"
            ? Promise.resolve(undefined)
            : tx.query.fuelImportBatches.findFirst({
                where: and(
                  eq(fuelImportBatches.worksiteId, meta.worksiteId),
                  eq(fuelImportBatches.periodoDesde, meta.periodoDesde),
                  eq(fuelImportBatches.periodoHasta, meta.periodoHasta),
                  eq(fuelImportBatches.fuente, meta.fuente),
                  ne(fuelImportBatches.estado, "revertido"),
                ),
              }),
        ])
        if (archivoDuplicado) return { ok: false as const, message: `Este archivo ya fue importado como lote ${archivoDuplicado.id}` }
        if (loteDuplicado) return { ok: false as const, message: `Ya existe un lote importado para esta faena, período y fuente (${loteDuplicado.id})` }
      }

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
            vehicleId: vehicleFor(row.patente)?.id ?? null,
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
        // Auditoría dentro de la misma transacción que el lote (CO-025): antes
        // se llamaba después del commit, con los totales del archivo completo
        // en vez de lo realmente insertado en ESTE lote.
        await recordAudit({
          userId: session.user.id,
          userEmail: session.user.email ?? undefined,
          action: "create",
          entityType: "fuel_import_batch",
          entityId: batchId,
          newState: { worksiteId, periodo: `${meta.periodoDesde}..${meta.periodoHasta}`, fuente: meta.fuente, ...batchTotals },
        }, tx)
      }
      return { ok: true as const }
    })

    if (!result.ok) {
      await removeFile(absolutePath)
      return { ok: false, message: result.message }
    }
  } catch (error) {
    await removeFile(absolutePath)
    throw error
  }

  // Sin revalidar "/combustibles/importar": es la ruta donde vive ESTE wizard
  // (import-wizard.tsx, renderizado desde importar/page.tsx). Se excluyó porque
  // revalidar borraba el paso "done" antes de que el usuario viera el resumen;
  // la causa real era que hasta 2026-09-24 cualquier revalidación volvía a
  // montar la plataforma entera (AppShell exportado como objeto memo), y ya no
  // ocurre — ver `confirmOperationsImportAction` en actions-operaciones.ts.
  // Basta con la ruta hermana: el historial de lotes se sirve fresco en la
  // próxima visita real (dinámica, depende de sesión).
  revalidatePath("/combustibles")

  return { ok: true, data: { batchId: batchIds[0]!, imported: [...rowsByWorksite.values()].flat().length, errors: [...parsed.errors, ...unmatchedErrors] } }
}

export async function revertBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:revert", "/combustibles/importar") }
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
  try { session = await requirePermission("combustibles:manage_vehicles", "/combustibles/importar") }
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
  if (vehicle.worksiteId !== batch.worksiteId) {
    return { ok: false, message: "El vehículo no pertenece a la faena del lote" }
  }

  const providerMapping = batch.fuente?.startsWith("Copec TCT Diesel")
    ? { provider: "copec" as const, sourceAccount: "tct:diesel" }
    : batch.fuente?.startsWith("Copec TCT BlueMax")
    ? { provider: "copec" as const, sourceAccount: "tct:bluemax" }
    : batch.fuente?.startsWith("Aramco Fleet")
    ? { provider: "aramco" as const, sourceAccount: "fleet" }
    : null
  const normalizedValue = plateMatchKey(patente)
  const updated = await db.transaction(async (tx) => {
    const linked = await tx.update(fuelConsumptionRecords)
      .set({ vehicleId, updatedAt: new Date().toISOString() })
      .where(and(eq(fuelConsumptionRecords.batchId, batchId), eq(fuelConsumptionRecords.patente, patente)))
      .returning({ id: fuelConsumptionRecords.id })
    if (providerMapping) {
      const previous = await tx.query.fuelProviderMappings.findFirst({
        where: and(
          eq(fuelProviderMappings.provider, providerMapping.provider),
          eq(fuelProviderMappings.sourceAccount, providerMapping.sourceAccount),
          eq(fuelProviderMappings.externalKey, normalizedValue),
          eq(fuelProviderMappings.isActive, true),
        ),
        orderBy: [desc(fuelProviderMappings.version)],
        columns: { id: true, version: true },
      })
      if (previous) {
        await tx.update(fuelProviderMappings).set({ isActive: false, effectiveTo: batch.periodoHasta }).where(eq(fuelProviderMappings.id, previous.id))
      }
      await tx.insert(fuelProviderMappings).values({
        id: nanoid(),
        provider: providerMapping.provider,
        sourceAccount: providerMapping.sourceAccount,
        externalKey: normalizedValue,
        normalizedValue,
        worksiteId: batch.worksiteId,
        vehicleId,
        version: (previous?.version ?? 0) + 1,
        isActive: true,
        decidedBy: session.user.id,
        reason: "Vínculo manual desde el detalle de una importación de combustible",
        effectiveFrom: batch.periodoDesde,
      })

      // Resolver una patente no debe dejar el ledger en estado pendiente hasta
      // el siguiente barrido del portal. Las filas ya validadas se promueven en
      // la misma transacción; si el producto aún es desconocido, se conserva
      // pendiente para que la decisión de producto siga siendo explícita.
      //
      // La promoción NO se acota por período a propósito: no hay otro camino que
      // resuelva una pendiente vieja. El barrido automático sólo vuelve a pedir
      // lo que su cursor alcanza (Copec, de su cursor hacia adelante; Aramco, los
      // últimos meses), así que acotarla dejaría pendientes huérfanas para
      // siempre.
      const pendingByPlate = and(
        eq(fuelProviderTransactions.provider, providerMapping.provider),
        eq(fuelProviderTransactions.sourceAccount, providerMapping.sourceAccount),
        eq(fuelProviderTransactions.status, "pending"),
        sql`regexp_replace(upper(coalesce(${fuelProviderTransactions.sourcePlate}, '')), '[^A-Z0-9]', '', 'g') = ${normalizedValue}`,
      )
      const promotable = and(pendingByPlate, sql`${fuelProviderTransactions.productId} IS NOT NULL`)
      const stillPending = and(pendingByPlate, isNull(fuelProviderTransactions.productId))
      await tx.update(fuelProviderTransactions).set({
        vehicleId,
        status: "accepted",
        resolutionCode: null,
        resolutionMessage: null,
        updatedAt: new Date().toISOString(),
      }).where(promotable)
      await tx.update(fuelProviderTransactions).set({
        vehicleId,
        updatedAt: new Date().toISOString(),
      }).where(stillPending)

      // La FAENA sí se acota a la vigencia del mapping recién escrito, y por eso
      // va en un UPDATE aparte. Sin cota, vincular una patente desde el lote de
      // marzo reescribía la faena de TODO su historial: un vehículo que cambió de
      // faena quedaba con sus cargas viejas atribuidas a la nueva.
      //
      // `occurred_at` es texto y Aramco guarda hora de pared completa
      // ("2026-07-31T08:00:00"), así que se compara el prefijo de 10 caracteres:
      // como string, '2026-07-31T08:00:00' <= '2026-07-31' es falso y se perdía
      // el último día de cada mes.
      await tx.update(fuelProviderTransactions).set({
        worksiteId: batch.worksiteId,
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(fuelProviderTransactions.provider, providerMapping.provider),
        eq(fuelProviderTransactions.sourceAccount, providerMapping.sourceAccount),
        eq(fuelProviderTransactions.vehicleId, vehicleId),
        sql`regexp_replace(upper(coalesce(${fuelProviderTransactions.sourcePlate}, '')), '[^A-Z0-9]', '', 'g') = ${normalizedValue}`,
        sql`left(coalesce(${fuelProviderTransactions.occurredAt}, ''), 10) >= ${batch.periodoDesde}`,
      ))
    }
    return linked
  })

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
