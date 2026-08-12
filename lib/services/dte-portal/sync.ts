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
import { logger } from "@/lib/logger"
import { DtePortalClient } from "./client"
import { fetchBandejaEntrada } from "./bandeja-entrada"
import { matchToPurchaseOrderInvoices, matchToFuelLoads } from "./reconciliation"
import type { DteBandejaRow } from "./types"
import { classifyDteFailure } from "./failure"
import { chilePeriod, previousChilePeriod } from "./chile-time"
import { claimDteSyncStart } from "./sync-start-gate"

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
  /** Email técnico ya resuelto desde la configuración segura, solo para cron. */
  importerEmail?: string | null
  /** Batch compartido por los períodos actual/anterior de una invocación automática. */
  correlationId?: string
}

export interface DteSyncResult {
  runId: string
  periodo: string
  codEmp: string
  status: "success" | "partial" | "failed" | "skipped"
  rowsSeen: number
  rowsInserted: number
  rowsUpdated: number
  correlationId: string
  error?: string
  /** Why a non-started run was skipped; never contains provider details. */
  skipReason?: "disabled" | "invalid_barrier" | "active_run"
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
  const correlationId = options.correlationId ?? nanoid(12)

  assertSyncablePeriodo(periodo)

  await markStaleRunsAsFailed(codEmp)

  // El mes en curso sigue recibiendo documentos de los proveedores hasta que
  // termina: saltar por "ya sincronizado" ahí dejaba el libro de compras
  // congelado en la foto del primer día del mes (H-03, AUDITORIA_BUGS_2026-08-05.md).
  //
  // El mes ANTERIOR tampoco puede darse por cerrado. Verificado el 2026-08-11:
  // el portal declaraba 578 documentos de julio y la plataforma tenía 575,
  // porque 3 llegaron después de la corrida de julio. Con el corte anterior
  // —cualquier período pasado con una corrida exitosa se saltaba— esos 3 eran
  // inalcanzables para siempre. Un período sólo se da por cerrado cuando sale
  // de la ventana móvil; más atrás sigue exigiendo `force`.
  const periodoCerrado = periodo < currentPeriodo() && !rollingSyncPeriods().includes(periodo)
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
        correlationId,
        error: "Ya existe una corrida exitosa para este período cerrado. Use force=true para re-sincronizar.",
      }
    }
  }

  const importerId = options.importerId ?? await resolveImporterId(options.importerEmail)

  // 1. Reclamar la corrida bajo el mismo lock que usa la conversión cifrada.
  // Si ésta ya pausó inicios, no se alcanza el portal con una configuración
  // leída antes del corte. Si la corrida ganó la carrera, su fila `running`
  // queda visible para que conversión espere a que termine.
  const start = await claimDteSyncStart({
    runId,
    periodo,
    codEmp,
    trigger,
    importerId,
    correlationId,
  })
  if (!start.allowed) {
    return {
      runId: "",
      periodo,
      codEmp,
      status: "skipped",
      rowsSeen: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      correlationId,
      skipReason: start.reason,
      error: start.reason === "disabled"
        ? "DTE_SYNC_DISABLED: La sincronización está pausada por configuración."
        : start.reason === "invalid_barrier"
          ? "DTE_SETTINGS_BARRIER_INVALID: El cerco de sincronización requiere revisión."
          : "DTE_SYNC_ACTIVE_RUN: Ya hay una sincronización en curso para este período.",
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
    const { rows: docs, totalRegistros } = await fetchBandejaEntrada(client, {
      mes,
      anio,
      codEmp,
      estadoPlataforma: "",
      rutProveedor: "",
    })

    rowsSeen = docs.length

    // El portal declara cuántos documentos tiene el período. Si parseamos menos,
    // se perdieron filas —fecha o folio irreconocibles descartan la fila con un
    // console.warn— y la corrida NO puede reportarse como exitosa: es un libro
    // de compras al que le faltan documentos. Antes esto sólo advertía por
    // consola y la corrida quedaba en `success`.
    if (totalRegistros > docs.length) {
      finalStatus = "partial"
      errorMsg = `El portal declara ${totalRegistros} documentos y se pudieron leer ${docs.length}: faltan ${totalRegistros - docs.length}.`
    }

    // 3. Upsert cada documento, cada uno en su propia transacción
    let failures = 0
    for (const row of docs) {
      try {
        const result = await db.transaction((tx) => upsertDteDocument(tx, row, periodo, codEmp, runId))
        if (result === "inserted") rowsInserted++
        else if (result === "updated") rowsUpdated++
      } catch (err) {
        failures++
        const failure = classifyDteFailure(err, Object.values(client.credentials))
        logger.error({ correlationId }, "[dte-sync] documento no persistido", { code: failure.code, periodo })
      }
    }

    // Se ACUMULA con el descuadre de total declarado en vez de reemplazarlo:
    // que fallen documentos y además falten filas son dos problemas distintos y
    // perder uno de los dos mensajes deja el diagnóstico a medias.
    if (failures > 0 && failures < docs.length) {
      finalStatus = "partial"
      errorMsg = [errorMsg, `${failures} de ${docs.length} documentos fallaron`].filter(Boolean).join(" ")
    } else if (failures > 0 && failures === docs.length) {
      finalStatus = "failed"
      errorMsg = [errorMsg, `Todos los ${docs.length} documentos fallaron`].filter(Boolean).join(" ")
    }
  } catch (err) {
    finalStatus = "failed"
    const failure = classifyDteFailure(err, Object.values(client.credentials))
    errorMsg = `${failure.code}: ${failure.summary}`
    logger.error({ correlationId }, "[dte-sync] consulta falló", { code: failure.code, periodo })
  }

  // 4. Conciliar contra OC y combustible ANTES de cerrar la corrida.
  //
  // Un fallo acá no cambia el estado del sync —los documentos sí se
  // sincronizaron— pero tiene que quedar registrado. Antes corría después del
  // cierre y su error sólo iba a `console.error`, así que una conciliación roña
  // de forma sistemática dejaba la corrida en `success` sin un solo vínculo y
  // sin rastro de por qué.
  let reconciliationNote: string | undefined
  try {
    const ocMatches = await matchToPurchaseOrderInvoices(periodo, codEmp)
    const fuelMatches = await matchToFuelLoads(periodo, codEmp)

    // Las discrepancias de monto se calculaban y se tiraban. Acá al menos se
    // cuentan y quedan en la corrida; el detalle por documento sigue
    // pendiente (necesita una columna).
    const withDiscrepancy = [...ocMatches, ...fuelMatches].filter((m) => m.discrepancy > 0)
    if (withDiscrepancy.length > 0) {
      reconciliationNote = `${withDiscrepancy.length} de ${ocMatches.length + fuelMatches.length} vínculos con diferencia de monto.`
    }
  } catch (_err) {
    reconciliationNote = "DTE_RECONCILIATION_FAILED: La conciliación posterior no se pudo completar."
    logger.error({ correlationId }, "[dte-sync] conciliación falló", { code: "DTE_RECONCILIATION_FAILED", periodo })
  }

  const finalError = [errorMsg, reconciliationNote].filter(Boolean).join(" ") || null

  // 5. Cerrar la corrida
  await db.update(dteSyncRuns).set({
    status: finalStatus,
    rowsSeen,
    rowsInserted,
    rowsUpdated,
    correlationId,
    error: finalError,
    finishedAt: new Date().toISOString(),
  }).where(eq(dteSyncRuns.id, runId))

  errorMsg = finalError ?? undefined

  return {
    runId,
    periodo,
    codEmp,
    status: finalStatus,
    rowsSeen,
    rowsInserted,
    rowsUpdated,
    correlationId,
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

/**
 * Resuelve el usuario técnico para corridas sin sesión (cron), vía
 * DTE_SYNC_IMPORTER_EMAIL. Patrón: lib/combustibles/copec-sync.ts.
 */
async function resolveImporterId(configuredEmail?: string | null): Promise<string | undefined> {
  const email = configuredEmail?.trim()
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
    columns: { id: true, rawHash: true, portalRecordId: true },
  })

  if (existing) {
    const needsPortalRecordBackfill = Boolean(
      row.nreguist && existing.portalRecordId !== row.nreguist,
    )
    if (existing.rawHash === rawHash && !needsPortalRecordBackfill) return "unchanged"

    // Actualizar el registro existente (estado en plataforma puede haber cambiado)
    // y completar Nreguist incluso si el contenido tributario no cambió. Sin
    // este segundo caso los DTE históricos quedaban sin ruta PDF para siempre.
    await tx.update(dteDocuments).set({
      montoTotal: row.montoTotal,
      estadoPlataforma: row.estadoPlataforma,
      rawHash,
      portalRecordId: row.nreguist ?? existing.portalRecordId,
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
    portalRecordId: row.nreguist,
    rawHash,
    syncRunId,
    syncedAt: new Date().toISOString(),
  })

  return "inserted"
}

function currentPeriodo(): string {
  return chilePeriod()
}

/**
 * Piso histórico: el período más antiguo que una corrida puede alcanzar.
 *
 * Existe por el mismo motivo que `BILLING_HISTORY_FLOOR` en facturación: que un
 * error de tipeo no dispare un raspado de años contra el portal de un tercero.
 * La validación anterior vivía sólo en la ruta API y aceptaba `2026-13` y
 * `2026-00` porque comprobaba `\d{4}-\d{2}` sin mirar el rango del mes.
 */
const DTE_HISTORY_FLOOR = "2024-01"

/** @throws Error si el período no es sincronizable. */
export function assertSyncablePeriodo(periodo: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) {
    throw new Error(`Período inválido: "${periodo}". Use YYYY-MM con un mes entre 01 y 12.`)
  }
  if (periodo < DTE_HISTORY_FLOOR) {
    throw new Error(`Período ${periodo} anterior al mínimo permitido (${DTE_HISTORY_FLOOR}).`)
  }
  if (periodo > currentPeriodo()) {
    throw new Error(`Período ${periodo} es futuro: el portal no tiene documentos todavía.`)
  }
}

/** Período anterior a `periodo` ("YYYY-MM"), cruzando el año. */
export function previousPeriodo(periodo: string): string {
  return previousChilePeriod(periodo)
}

/**
 * Períodos que una corrida automática debe cubrir: el mes en curso y el
 * anterior.
 *
 * ## Por qué dos y no uno
 *
 * Los proveedores entregan documentos con retraso. Verificado en producción el
 * 2026-08-11: el portal declaraba 578 documentos de julio y la plataforma tenía
 * 575 — los 3 restantes llegaron después de la corrida de julio. Como
 * `syncDteDocuments` da por cerrado un período que ya tuvo una corrida exitosa,
 * y el cron sólo pedía el mes en curso, esos 3 documentos eran inalcanzables
 * para siempre: quedaban fuera del libro de compras sin que nada lo dijera.
 *
 * Con la ventana, el mes anterior se re-sincroniza hasta que deja de estar en
 * ella. Sigue habiendo un límite —un documento que llega dos meses tarde exige
 * `force`— pero cubre el retraso normal en vez de no cubrir ninguno.
 */
export function rollingSyncPeriods(today = new Date()): string[] {
  const current = chilePeriod(today)
  return [current, previousPeriodo(current)]
}
