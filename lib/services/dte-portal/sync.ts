/**
 * lib/services/dte-portal/sync.ts
 *
 * Servicio de sincronización del libro de compras del portal DTE FacturaEnLinea.
 *
 * Patrón: copec-sync.ts → registra corrida en dteSyncRuns, consulta el portal,
 * parsea las filas del HTML, upserta dteDocuments con dedupe por rawHash,
 * y cierra la corrida con estadísticas.
 *
 * La sincronización es idempotente: dos corridas con los mismos datos
 * producen el mismo resultado sin duplicados.
 *
 * @see explicacion_integral_dte_facturaenlinea.md § Plan de Implementación, Fase 3
 */

import { createHash } from "node:crypto"
import { eq, and } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments, dteSyncRuns } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { DtePortalClient } from "./client"
import { queryAllPages } from "./query"
import type { DteDocumentRow, DteLibro } from "./types"

export interface DteSyncOptions {
  /** Período a sincronizar, formato "YYYY-MM". Default: mes actual. */
  periodo?: string
  /** Código de empresa en el portal. Default: desde config del cliente. */
  codEmp?: string
  /** Tipo de trigger: manual (botón admin) o cron (scheduler). */
  trigger?: "manual" | "cron"
  /** Forzar re-sync incluso si ya hay una corrida exitosa del período. */
  force?: boolean
  /** Libro a consultar. Default: "com" (compras). */
  rlib?: DteLibro
}

export interface DteSyncResult {
  runId: string
  periodo: string
  codEmp: string
  status: "success" | "partial" | "failed"
  rowsSeen: number
  rowsInserted: number
  rowsUpdated: number
  error?: string
}

/**
 * Sincroniza documentos del libro de compras de un período.
 *
 * 1. Registra la corrida en dteSyncRuns (status=running)
 * 2. Consulta paneldte.php (todas las páginas)
 * 3. Para cada fila: calcula hash → upsert en dteDocuments
 * 4. Cierra la corrida con estadísticas
 */
export async function syncDteDocuments(
  client: DtePortalClient,
  options: DteSyncOptions = {},
): Promise<DteSyncResult> {
  const periodo = options.periodo ?? currentPeriodo()
  const codEmp = options.codEmp ?? client.credentials.codEmp
  const trigger = options.trigger ?? "manual"
  const rlib = options.rlib ?? "com"
  const runId = nanoid()

  // 1. Registrar la corrida
  await db.insert(dteSyncRuns).values({
    id: runId,
    periodo,
    codEmp,
    trigger,
    status: "running",
    startedAt: new Date().toISOString(),
  })

  let rowsSeen = 0
  let rowsInserted = 0
  let rowsUpdated = 0
  let finalStatus: "success" | "partial" | "failed" = "success"
  let errorMsg: string | undefined

  try {
    // 2. Consultar el portal (todas las páginas del período)
    const docs = await queryAllPages(client, {
      tipo: "periodo",
      rlib,
      periodo: periodo as `${number}-${string}`,
      dia: "00", // todos los días
    })

    rowsSeen = docs.length

    // 3. Upsert cada documento
    let failures = 0
    for (const row of docs) {
      try {
        const result = await upsertDteDocument(row, periodo, codEmp, runId)
        if (result === "inserted") rowsInserted++
        else if (result === "updated") rowsUpdated++
      } catch (err) {
        failures++
        // No abortar por un documento individual
        console.error(`[dte-sync] Error al procesar folio ${row.folio} tipo ${row.tipoDoc}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (failures > 0 && failures < docs.length) {
      finalStatus = "partial"
      errorMsg = `${failures} de ${docs.length} documentos fallaron`
    } else if (failures > 0 && failures === docs.length) {
      finalStatus = "failed"
      errorMsg = `Todos los ${docs.length} documentos fallaron`
    }
  } catch (err) {
    finalStatus = "failed"
    errorMsg = err instanceof Error ? err.message : String(err)
    // No exponer credenciales en el error
    if (errorMsg.includes("clave") || errorMsg.includes("rut_usr")) {
      errorMsg = "Error de conexión con el portal DTE [credenciales omitidas]"
    }
  }

  // 4. Cerrar la corrida
  await db.update(dteSyncRuns).set({
    status: finalStatus,
    rowsSeen,
    rowsInserted,
    rowsUpdated,
    error: errorMsg ?? null,
    finishedAt: new Date().toISOString(),
  }).where(eq(dteSyncRuns.id, runId))

  return {
    runId,
    periodo,
    codEmp,
    status: finalStatus,
    rowsSeen,
    rowsInserted,
    rowsUpdated,
    error: errorMsg,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calcula un hash determinista del contenido clave de un documento.
 * Usado para deduplicación (rawHash en dteDocuments).
 */
export function computeDocumentHash(row: DteDocumentRow): string {
  const content = [
    row.tipoDoc,
    String(row.folio),
    row.razonSocial,
    String(row.montoTotal),
    row.fecha,
    row.estado,
    row.estadoSii ?? "",
  ].join("|")

  return createHash("sha256").update(content).digest("hex")
}

/**
 * Upsert un documento DTE en la base de datos.
 *
 * Si el documento ya existe (por clave única tipoDte+folio+rutEmisor+codEmp),
 * actualiza si el hash cambió (lo que indica cambio de estado o montos).
 *
 * Retorna: "inserted" | "updated" | "unchanged"
 */
async function upsertDteDocument(
  row: DteDocumentRow,
  periodo: string,
  codEmp: string,
  syncRunId: string,
): Promise<"inserted" | "updated" | "unchanged"> {
  const rawHash = computeDocumentHash(row)

  // El rutEmisor puede venir de la fila o del contexto.
  // En libro de compras, la razón social corresponde al emisor (proveedor).
  // El RUT emisor no siempre está disponible desde la tabla HTML; usamos lo
  // que tengamos o un placeholder que la reconciliación resolverá.
  const rutEmisor = row.rutEmisor ?? `pending-${row.razonSocial.slice(0, 30)}`

  // Verificar si ya existe
  const existing = await db.query.dteDocuments.findFirst({
    where: and(
      eq(dteDocuments.tipoDte, row.tipoDoc),
      eq(dteDocuments.folio, row.folio),
      eq(dteDocuments.rutEmisor, rutEmisor),
      eq(dteDocuments.codEmp, codEmp),
    ),
    columns: { id: true, rawHash: true },
  })

  if (existing) {
    if (existing.rawHash === rawHash) return "unchanged"

    // Actualizar el registro existente (estado SII puede haber cambiado)
    await db.update(dteDocuments).set({
      montoNeto: row.montoNeto,
      montoTotal: row.montoTotal,
      estadoSii: row.estadoSii,
      estadoPlataforma: row.estado,
      rawHash,
      syncRunId,
      syncedAt: new Date().toISOString(),
    }).where(eq(dteDocuments.id, existing.id))

    return "updated"
  }

  // Insertar nuevo documento
  await db.insert(dteDocuments).values({
    id: nanoid(),
    tipoDte: row.tipoDoc,
    folio: row.folio,
    rutEmisor,
    razonSocialEmisor: row.razonSocial,
    fechaEmision: row.fecha,
    montoNeto: row.montoNeto,
    iva: null,  // El HTML del portal no tiene IVA separado; se llena al descargar el XML
    montoTotal: row.montoTotal,
    estadoSii: row.estadoSii,
    estadoIntercambio: null,
    estadoPlataforma: row.estado,
    codEmp,
    periodo,
    rawHash,
    syncRunId,
    syncedAt: new Date().toISOString(),
  })

  return "inserted"
}

function currentPeriodo(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}
