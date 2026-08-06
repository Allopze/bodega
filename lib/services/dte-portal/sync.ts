/**
 * lib/services/dte-portal/sync.ts
 *
 * Servicio de sincronización de compras del portal DTE FacturaEnLinea.
 *
 * Fuente: Bandeja de Entrada del Panel Correo (PNC_PanelCorreo.php) — verificado
 * el 2026-08-04 que es ahí donde llegan los DTE de los proveedores, con RUT
 * emisor incluido. El libro `paneldte.php?rlib=com` está vacío porque los
 * documentos recibidos nunca se procesan hacia él; el código de paneldte.php
 * (query.ts/parser.ts) sigue existiendo para consultar las ventas propias,
 * pero ya no es la fuente de este sync.
 *
 * Patrón: copec-sync.ts → registra corrida en dteSyncRuns, consulta el portal,
 * parsea las filas del HTML, upserta dteDocuments con dedupe por rawHash,
 * y cierra la corrida con estadísticas.
 *
 * La sincronización es idempotente: dos corridas con los mismos datos
 * producen el mismo resultado sin duplicados.
 *
 * @see EXPLORACION_PORTAL_DTE_FACTURAENLINEA_2026-08-04.md § 7
 */

import { createHash } from "node:crypto"
import { eq, and, lt } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments, dteSyncRuns, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { DtePortalClient } from "./client"
import { fetchBandejaEntrada } from "./bandeja-entrada"
import { matchToPurchaseOrderInvoices, matchToFuelLoads } from "./reconciliation"
import type { DteBandejaRow } from "./types"

/** Corridas "running" más viejas que esto se consideran colgadas (proceso muerto a medio camino). */
const STALE_RUN_THRESHOLD_MS = 60 * 60 * 1000

export interface DteSyncOptions {
  /** Período a sincronizar, formato "YYYY-MM". Default: mes actual. */
  periodo?: string
  /** Código de empresa en el portal. Default: desde config del cliente. */
  codEmp?: string
  /** Tipo de trigger: manual (botón admin) o cron (scheduler). */
  trigger?: "manual" | "cron"
  /** Forzar re-sync incluso si ya hay una corrida exitosa del período. */
  force?: boolean
  /** Usuario que dispara la corrida manual (de la sesión autenticada). */
  importerId?: string
}

export interface DteSyncResult {
  runId: string
  periodo: string
  codEmp: string
  status: "success" | "partial" | "failed" | "skipped"
  rowsSeen: number
  rowsInserted: number
  rowsUpdated: number
  error?: string
}

/**
 * Sincroniza los documentos de compra (Bandeja de Entrada) de un período.
 *
 * 1. Marca como "failed" corridas "running" colgadas del mismo período/empresa
 * 2. Si ya hay una corrida "success" del período y no se pide `force`, no hace nada
 * 3. Registra la corrida en dteSyncRuns (status=running)
 * 4. Consulta la Bandeja de Entrada (sin paginación, una sola respuesta trae todo)
 * 5. Para cada fila: calcula hash → upsert en dteDocuments, todo en una transacción
 * 6. Cierra la corrida con estadísticas
 */
export async function syncDteDocuments(
  client: DtePortalClient,
  options: DteSyncOptions = {},
): Promise<DteSyncResult> {
  const periodo = options.periodo ?? currentPeriodo()
  const codEmp = options.codEmp ?? client.credentials.codEmp
  const trigger = options.trigger ?? "manual"
  const runId = nanoid()

  await markStaleRunsAsFailed(codEmp)

  // El mes en curso sigue recibiendo documentos de los proveedores hasta que
  // termina: saltar por "ya sincronizado" ahí dejaba el libro de compras
  // congelado en la foto del primer día del mes (H-03, AUDITORIA_BUGS_2026-08-05.md).
  // Sólo un período ya cerrado puede darse por sincronizado.
  const periodoCerrado = periodo < currentPeriodo()
  if (!options.force && periodoCerrado) {
    const priorSuccess = await db.query.dteSyncRuns.findFirst({
      where: and(
        eq(dteSyncRuns.periodo, periodo),
        eq(dteSyncRuns.codEmp, codEmp),
        eq(dteSyncRuns.status, "success"),
      ),
      columns: { id: true },
    })
    if (priorSuccess) {
      return {
        runId: priorSuccess.id,
        periodo,
        codEmp,
        status: "skipped",
        rowsSeen: 0,
        rowsInserted: 0,
        rowsUpdated: 0,
        error: "Ya existe una corrida exitosa para este período cerrado. Use force=true para re-sincronizar.",
      }
    }
  }

  const importerId = options.importerId ?? await resolveImporterId()

  // 1. Registrar la corrida. El índice único parcial
  // `dte_sync_runs_single_active_unique` deja una sola `running` por
  // (empresa, período): si el cron y el botón se disparan a la vez, la
  // segunda choca en la base en vez de raspar el portal por duplicado
  // (H-10, AUDITORIA_BUGS_2026-08-05.md).
  try {
    await db.insert(dteSyncRuns).values({
      id: runId,
      periodo,
      codEmp,
      trigger,
      importerId,
      status: "running",
      startedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (!isSingleActiveRunConflict(error)) throw error
    return {
      runId: "",
      periodo,
      codEmp,
      status: "skipped",
      rowsSeen: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      error: "Ya hay una sincronización en curso para este período.",
    }
  }

  let rowsSeen = 0
  let rowsInserted = 0
  let rowsUpdated = 0
  let finalStatus: "success" | "partial" | "failed" = "success"
  let errorMsg: string | undefined

  try {
    // 2. Consultar la Bandeja de Entrada (sin paginación, ver bandeja-entrada.ts)
    const [anio, mes] = periodo.split("-") as [string, string]
    const { rows: docs } = await fetchBandejaEntrada(client, {
      mes,
      anio,
      codEmp,
      estadoPlataforma: "",
      rutProveedor: "",
    })

    rowsSeen = docs.length

    // 3. Upsert cada documento, cada uno en su propia transacción
    let failures = 0
    for (const row of docs) {
      try {
        const result = await db.transaction((tx) => upsertDteDocument(tx, row, periodo, codEmp, runId))
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

  // 5. Conciliar contra OC y combustible. Un fallo acá no debe cambiar el
  // resultado del sync (ya cerrado arriba) — solo se loguea.
  try {
    await matchToPurchaseOrderInvoices(periodo, codEmp)
    await matchToFuelLoads(periodo, codEmp)
  } catch (err) {
    console.error(`[dte-sync] Error al conciliar el período ${periodo}: ${err instanceof Error ? err.message : String(err)}`)
  }

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

/**
 * Marca como "failed" las corridas "running" que llevan más de
 * STALE_RUN_THRESHOLD_MS sin cerrar — señal de que el proceso murió a medio
 * camino y dejó la corrida colgada indefinidamente.
 */
async function markStaleRunsAsFailed(codEmp: string): Promise<void> {
  const threshold = new Date(Date.now() - STALE_RUN_THRESHOLD_MS).toISOString()
  await db.update(dteSyncRuns).set({
    status: "failed",
    error: "Corrida colgada: no cerró dentro del umbral esperado (proceso interrumpido).",
    finishedAt: new Date().toISOString(),
  }).where(and(
    eq(dteSyncRuns.codEmp, codEmp),
    eq(dteSyncRuns.status, "running"),
    lt(dteSyncRuns.startedAt, threshold),
  ))
}

/** Índice parcial: una sola corrida `running` por (empresa, período). */
const SINGLE_ACTIVE_RUN_INDEX = "dte_sync_runs_single_active_unique"

/**
 * ¿El error viene del índice único parcial de corridas activas?
 *
 * Drizzle envuelve el error del driver, así que el SQLSTATE y el nombre de la
 * restricción viven en la cadena de `cause`. Se exige el nombre del índice: no
 * cualquier violación de unicidad de esta tabla significa "ya hay una corrida".
 */
function isSingleActiveRunConflict(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    const candidate = current as { code?: string; constraint?: string; detail?: string; cause?: unknown }
    if (candidate.code === "23505" && candidate.constraint === SINGLE_ACTIVE_RUN_INDEX) return true
    if (typeof candidate.detail === "string" && candidate.detail.includes(SINGLE_ACTIVE_RUN_INDEX)) return true
    current = candidate.cause
  }
  return String((error as { message?: string })?.message ?? "").includes(SINGLE_ACTIVE_RUN_INDEX)
}

/**
 * Resuelve el usuario técnico para corridas sin sesión (cron), vía
 * DTE_SYNC_IMPORTER_EMAIL. Patrón: lib/combustibles/copec-sync.ts.
 */
async function resolveImporterId(): Promise<string | undefined> {
  const email = process.env.DTE_SYNC_IMPORTER_EMAIL?.trim()
  if (!email) return undefined
  const user = await db.query.users.findFirst({
    where: and(eq(users.email, email), eq(users.isActive, true)),
    columns: { id: true },
  })
  return user?.id
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calcula un hash determinista del contenido clave de un documento.
 * Usado para deduplicación (rawHash en dteDocuments).
 */
export function computeDocumentHash(row: DteBandejaRow): string {
  const content = [
    row.tipoDoc,
    String(row.folio),
    row.rutEmisor,
    row.razonSocial,
    String(row.montoTotal),
    row.fecha,
    row.estadoPlataforma ?? "",
  ].join("|")

  return createHash("sha256").update(content).digest("hex")
}

/**
 * Upsert un documento DTE en la base de datos.
 *
 * Si el documento ya existe (por clave única tipoDte+folio+rutEmisor+codEmp),
 * actualiza si el hash cambió (lo que indica cambio de estado o montos).
 *
 * Corre dentro de la transacción de la corrida: si falla a medio camino, no
 * queda un registro a medio escribir.
 *
 * Retorna: "inserted" | "updated" | "unchanged"
 */
async function upsertDteDocument(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  row: DteBandejaRow,
  periodo: string,
  codEmp: string,
  syncRunId: string,
): Promise<"inserted" | "updated" | "unchanged"> {
  const rawHash = computeDocumentHash(row)

  // Verificar si ya existe
  const existing = await tx.query.dteDocuments.findFirst({
    where: and(
      eq(dteDocuments.tipoDte, row.tipoDoc),
      eq(dteDocuments.folio, row.folio),
      eq(dteDocuments.rutEmisor, row.rutEmisor),
      eq(dteDocuments.codEmp, codEmp),
    ),
    columns: { id: true, rawHash: true },
  })

  if (existing) {
    if (existing.rawHash === rawHash) return "unchanged"

    // Actualizar el registro existente (estado en plataforma puede haber cambiado)
    await tx.update(dteDocuments).set({
      montoTotal: row.montoTotal,
      estadoPlataforma: row.estadoPlataforma,
      rawHash,
      syncRunId,
      syncedAt: new Date().toISOString(),
    }).where(eq(dteDocuments.id, existing.id))

    return "updated"
  }

  // Insertar nuevo documento. La Bandeja de Entrada no trae ni SII ni
  // intercambio (esos íconos son del panel de ventas, no del correo de
  // compras) — quedan null hasta que exista una fuente real para ellos.
  await tx.insert(dteDocuments).values({
    id: nanoid(),
    tipoDte: row.tipoDoc,
    folio: row.folio,
    rutEmisor: row.rutEmisor,
    razonSocialEmisor: row.razonSocial,
    fechaEmision: row.fecha,
    montoNeto: null, // La bandeja no trae neto separado; se llena al descargar el XML (bajo demanda)
    iva: null,       // idem
    montoTotal: row.montoTotal,
    estadoSii: null,
    estadoIntercambio: null,
    estadoPlataforma: row.estadoPlataforma,
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
