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
import { cleanRut } from "@/lib/rut"
import { DtePortalClient } from "./client"
import { fetchBandejaEntrada } from "./bandeja-entrada"
import { matchToPurchaseOrderInvoices, matchToFuelLoads, summarizeDteReconciliation } from "./reconciliation"
import type { DteBandejaRow } from "./types"
import { classifyDteFailure } from "./failure"
import { chileClock, chilePeriod, previousChilePeriod } from "./chile-time"
import { claimDteSyncStart } from "./sync-start-gate"
import { clearDteSyncProgress, publishDteSyncProgress } from "./sync-progress"

/** Cada cuántos documentos se refresca el avance visible: ni una escritura por fila
 *  ni un salto de minutos en pantalla. */
const PROGRESS_EVERY = 25

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
  reconciliationStatus: "not_run" | "success" | "partial" | "failed"
  reconciliationError?: string
  reconciliation: {
    matched: number
    ambiguous: number
    unmatched: number
    discrepancies: number
  }
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
        reconciliationStatus: "not_run",
        reconciliation: { matched: 0, ambiguous: 0, unmatched: 0, discrepancies: 0 },
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
      reconciliationStatus: "not_run",
      reconciliation: { matched: 0, ambiguous: 0, unmatched: 0, discrepancies: 0 },
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

  // La consulta al portal es la etapa larga y la que no tiene contador: sin
  // publicar la etapa, el botón manual pasa minutos diciendo sólo "Sincronizando".
  await publishDteSyncProgress({ runId, periodo, phase: "portal", processed: 0, total: 0 })

  try {
    // 2. Consultar la Bandeja de Entrada (sin paginación, ver bandeja-entrada.ts)
    const [anio, mes] = periodo.split("-") as [string, string]
    // El contexto va sólo a los warns de fila descartada: sin él, un `partial`
    // que dice "faltan 3" deja tres avisos sueltos en stdout, mezclados con los
    // de las otras corridas del día y sin forma de atribuirlos a esta.
    const { rows: docs, declaredTotal } = await fetchBandejaEntrada(client, {
      mes,
      anio,
      codEmp,
      estadoPlataforma: "",
      rutProveedor: "",
    }, { correlationId, periodo })

    rowsSeen = docs.length
    await publishDteSyncProgress({ runId, periodo, phase: "documentos", processed: 0, total: docs.length })

    // El portal declara cuántos documentos tiene el período. Si parseamos menos,
    // se perdieron filas —fecha o folio irreconocibles descartan la fila con un
    // warn— y la corrida NO puede reportarse como exitosa: es un libro de
    // compras al que le faltan documentos.
    //
    // Y si el portal NO declara el total, tampoco hay éxito que reportar:
    // `totalRegistros` se rellena con `rows.length` y compararlos es una
    // tautología. Se lee `declaredTotal` justamente para no cerrar en `success`
    // una corrida cuya completitud nadie pudo verificar.
    if (declaredTotal === null || declaredTotal === undefined) {
      finalStatus = "partial"
      errorMsg = `El portal no declaró el total de registros: no se pudo verificar la completitud (se leyeron ${docs.length} documentos).`
    } else if (declaredTotal > docs.length) {
      finalStatus = "partial"
      errorMsg = `El portal declara ${declaredTotal} documentos y se pudieron leer ${docs.length}: faltan ${declaredTotal - docs.length}.`
    }

    // 3. Upsert cada documento, cada uno en su propia transacción
    let failures = 0
    for (const [index, row] of docs.entries()) {
      try {
        const result = await db.transaction((tx) => upsertDteDocument(tx, row, periodo, codEmp, runId))
        if (result === "inserted") rowsInserted++
        else if (result === "updated") rowsUpdated++
      } catch (err) {
        failures++
        const failure = classifyDteFailure(err, Object.values(client.credentials))
        logger.error({ correlationId }, "[dte-sync] documento no persistido", { code: failure.code, periodo })
      }
      // El avance cuenta documentos PROCESADOS, no insertados: en un re-sync casi
      // todos quedan "unchanged" y un contador de altas se ve congelado.
      if ((index + 1) % PROGRESS_EVERY === 0) {
        await publishDteSyncProgress({ runId, periodo, phase: "documentos", processed: index + 1, total: docs.length })
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
  if (finalStatus !== "failed") {
    await publishDteSyncProgress({ runId, periodo, phase: "conciliacion", processed: rowsSeen, total: rowsSeen })
  }

  let reconciliationStatus: DteSyncResult["reconciliationStatus"] = "not_run"
  let reconciliationError: string | undefined
  let reconciliation = { matched: 0, ambiguous: 0, unmatched: 0, discrepancies: 0 }
  /**
   * DTE que el modelo 1:1 no puede vincular porque el dato interno es
   * legítimamente múltiple (una factura TAE mensual cubre N cargas). NO entra en
   * `withIssues` —eso dejaría la conciliación en `partial` para siempre— pero sí
   * se deja dicho en el motivo de la corrida: quien lea el historial tiene que
   * poder distinguir "sin vínculo por la limitación del modelo" de un fallo.
   */
  let internalAmbiguity = 0
  try {
    if (finalStatus === "failed") throw new Error("ingesta fallida; conciliación no ejecutada")
    const ocMatches = await matchToPurchaseOrderInvoices(periodo, codEmp)
    const fuelMatches = await matchToFuelLoads(periodo, codEmp)
    const allMatches = [...ocMatches, ...fuelMatches]
    const summary = await summarizeDteReconciliation(periodo, codEmp, allMatches)
    reconciliation = summary
    internalAmbiguity = summary.internalAmbiguity ?? 0
    // `unmatched` es inventario de trabajo pendiente, no un defecto: los gastos
    // sin OC (servicios básicos, arriendos, compras menores) y todo DTE que
    // llega antes de que Compras registre su factura viven ahí por definición.
    // Contarlo como problema dejaba `reconciliationStatus` en "partial" de
    // forma permanente, con el mismo estado y el mismo código de salud que una
    // ingesta a la que le faltan documentos del libro: tres alertas diarias
    // idénticas a la única que importa, y salud que nunca vuelve a "healthy".
    const withIssues = reconciliation.ambiguous + reconciliation.discrepancies
    reconciliationStatus = withIssues > 0 ? "partial" : "success"
    const internalAmbiguityNote = internalAmbiguity > 0
      ? `${internalAmbiguity} sin vínculo por la limitación 1:1 del modelo de combustible (informativo)`
      : null
    if (reconciliationStatus === "partial") {
      reconciliationError = `DTE_RECONCILIATION_PENDING: ${[
        reconciliation.ambiguous > 0 ? `${reconciliation.ambiguous} coincidencias ambiguas` : null,
        reconciliation.discrepancies > 0 ? `${reconciliation.discrepancies} vínculos con diferencia de monto` : null,
        internalAmbiguityNote,
      ].filter(Boolean).join("; ")}`
    } else if (internalAmbiguityNote) {
      reconciliationError = `DTE_RECONCILIATION_INFO: ${internalAmbiguityNote}`
    }
  } catch (_err) {
    reconciliationStatus = finalStatus === "failed" ? "not_run" : "failed"
    reconciliationError = finalStatus === "failed"
      ? "La ingesta falló antes de ejecutar la conciliación."
      : "DTE_RECONCILIATION_FAILED: La conciliación posterior no se pudo completar."
    if (finalStatus === "failed") reconciliationStatus = "not_run"
    logger.error({ correlationId }, "[dte-sync] conciliación falló", { code: "DTE_RECONCILIATION_FAILED", periodo })
  }

  // Una ingesta incompleta y una conciliación pendiente son incidentes
  // distintos: sin código propio ambas llegaban al operador con el mismo texto
  // (y la ruta publicaba media frase como si fuera el código).
  if (errorMsg && !/^DTE_[A-Z_]+:/.test(errorMsg)) {
    errorMsg = `DTE_INGEST_${finalStatus === "failed" ? "FAILED" : "PARTIAL"}: ${errorMsg}`
  }
  // Una conciliación exitosa sólo lleva nota informativa (DTE_RECONCILIATION_INFO):
  // no es un error de la corrida y no debe teñir la columna `error`.
  const reconciliationErrorForRun = reconciliationStatus === "success" ? null : reconciliationError
  let finalError = [errorMsg, reconciliationErrorForRun].filter(Boolean).join(" ") || null

  // 5. Cerrar la corrida, sólo si la fila sigue siendo suya (fencing).
  const closed = await db.update(dteSyncRuns).set({
    status: finalStatus,
    rowsSeen,
    rowsInserted,
    rowsUpdated,
    correlationId,
    error: finalError,
    reconciliationStatus,
    reconciliationError: reconciliationError ?? null,
    finishedAt: new Date().toISOString(),
  }).where(and(
    eq(dteSyncRuns.id, runId),
    eq(dteSyncRuns.status, "running"),
  )).returning({ id: dteSyncRuns.id })

  // Sin la condición de estado, una corrida que `markStaleRunsAsFailed` ya
  // había declarado colgada volvía sola a `success` al terminar: el veredicto
  // del barrido —y con él el rastro de que otra corrida pudo entrar a raspar
  // el mismo período en paralelo— desaparecía sin dejar huella.
  if (closed.length === 0) {
    finalStatus = "failed"
    finalError = "DTE_SYNC_RUN_PREEMPTED: La corrida fue declarada colgada mientras seguía en curso; su resultado no se conservó."
    logger.error({ correlationId }, "[dte-sync] corrida expropiada por el barrido de colgadas", {
      code: "DTE_SYNC_RUN_PREEMPTED",
      periodo,
    })
  }

  errorMsg = finalError ?? undefined

  await clearDteSyncProgress(runId)

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
    reconciliationStatus,
    reconciliationError,
    reconciliation,
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
  // La ingesta era el único punto que guardaba el RUT con la ortografía cruda
  // del portal, siendo parte de la clave única: si la celda llegara con puntos
  // (`96.542.490-3`) la misma factura se insertaría dos veces y la
  // conciliación —que sí canoniza— descartaría ambas por ambiguas.
  const rutEmisor = cleanRut(row.rutEmisor)

  // Verificar si ya existe
  const existing = await tx.query.dteDocuments.findFirst({
    where: and(
      eq(dteDocuments.tipoDte, row.tipoDoc),
      eq(dteDocuments.folio, row.folio),
      eq(dteDocuments.rutEmisor, rutEmisor),
      eq(dteDocuments.codEmp, codEmp),
    ),
    columns: { id: true, rawHash: true, portalRecordId: true, fechaRecepcion: true },
  })

  // La fecha de recepción no entra en `rawHash` (cambiarlo re-escribiría toda la
  // tabla en producción), así que los documentos ya sincronizados sólo la
  // reciben por este relleno — mismo caso que Nreguist.
  const fechaRecepcion = row.fechaRecepcionDate ?? null

  if (existing) {
    const needsPortalRecordBackfill = Boolean(
      row.nreguist && existing.portalRecordId !== row.nreguist,
    )
    const needsFechaRecepcionBackfill = Boolean(fechaRecepcion && !existing.fechaRecepcion)
    if (existing.rawHash === rawHash && !needsPortalRecordBackfill && !needsFechaRecepcionBackfill) return "unchanged"

    // Actualizar el registro existente (estado en plataforma puede haber cambiado)
    // y completar Nreguist incluso si el contenido tributario no cambió. Sin
    // este segundo caso los DTE históricos quedaban sin ruta PDF para siempre.
    await tx.update(dteDocuments).set({
      montoTotal: row.montoTotal,
      razonSocialEmisor: row.razonSocial,
      fechaEmision: row.fecha,
      estadoPlataforma: row.estadoPlataforma,
      fechaRecepcion: fechaRecepcion ?? existing.fechaRecepcion,
      rawHash,
      portalRecordId: row.nreguist ?? existing.portalRecordId,
      syncRunId,
      syncedAt: new Date().toISOString(),
    }).where(eq(dteDocuments.id, existing.id))

    return "updated"
  }

  // Insertar nuevo documento. La Bandeja de Entrada no trae ni SII ni
  // intercambio (esos íconos son del panel de ventas, no del correo de
  // compras). `estadoSii` queda SIEMPRE null porque no existe fuente que lo
  // pueble por este camino: el estado real del documento es
  // `estado_plataforma`, que sí llega poblado y es el que leen el export
  // tributario y las pantallas. La columna se conserva por si algún día el
  // panel de ventas alimenta el libro.
  await tx.insert(dteDocuments).values({
    id: nanoid(),
    tipoDte: row.tipoDoc,
    folio: row.folio,
    rutEmisor,
    razonSocialEmisor: row.razonSocial,
    fechaEmision: row.fecha,
    // Fecha en que el proveedor subió el DTE al portal: la consulta filtra por
    // fecha del DOCUMENTO, así que es el único dato que permite medir su atraso.
    // ponytail: se guarda sólo el día (la hora del correo se descarta); si
    // hiciera falta el intervalo exacto, hay que guardar `row.fechaRecepcion`.
    fechaRecepcion,
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

/** Meses fuera de la ventana móvil que el barrido de recuperación re-consulta. */
const RECOVERY_SWEEP_MONTHS = 3

/**
 * Períodos del barrido mensual de recuperación.
 *
 * Un período que sale de la ventana móvil deja de mirarse para siempre: los
 * documentos que el proveedor entrega con más de un mes de retraso quedan
 * fuera del libro de compras sin que nada lo diga (verificado en producción el
 * 2026-08-11: el portal declaraba 578 documentos de julio y la plataforma
 * tenía 575). Una vez al mes se re-consultan con `force` los meses recién
 * cerrados; lo que aparezca ahí es evidencia tributaria que faltaba.
 *
 * Devuelve `[]` fuera de la ventana del barrido para que las demás corridas
 * del cron no lo repitan.
 *
 * ponytail: la cadencia se deriva del reloj (día 1, primer slot del día) en vez
 * de guardar estado; si esa invocación no corre, el barrido se salta el mes.
 */
export function recoverySweepPeriods(at = new Date()): string[] {
  const clock = chileClock(at)
  if (!clock.date.endsWith("-01") || clock.minutesSinceMidnight >= 12 * 60) return []

  const periods: string[] = []
  // El primero que ya salió de la ventana móvil [mes en curso, mes anterior].
  let periodo = previousPeriodo(previousPeriodo(clock.period))
  for (let i = 0; i < RECOVERY_SWEEP_MONTHS && periodo >= DTE_HISTORY_FLOOR; i++) {
    periods.push(periodo)
    periodo = previousPeriodo(periodo)
  }
  return periods
}
