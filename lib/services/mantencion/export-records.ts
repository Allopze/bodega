import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  mantRecordCorrectives, mantRecordDrivers, mantRecordItems, mantRecordParts, mantRecordVoids, mantRecords,
  mantWorkshopUpdates, users, worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { executorText, ITEM_VALUE_LABEL, RECORD_STATUS_LABEL, REVIEW_LABEL } from "@/lib/mantencion/format"
import { workshopState } from "@/lib/mantencion/status"
import type { MantExecutorKind, MantItemValue, MantRecordKind, MantRecordStatus, MantReview } from "@/lib/mantencion/types"
import { EXCEL_DATE_FORMAT, EXCEL_DATETIME_FORMAT, excelDateTime, excelPlainDate } from "@/lib/reports/excel-dates"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export-module/types"
import { todayInChile } from "@/lib/utils"
import { recordVisibility, recordVisibilitySql, viewerFromSession } from "./access"
import type { RecordFilters } from "./records-filters"
import { recordsWhere } from "./records-query"

/**
 * Libro «Registros» (§12): cinco hojas con las fechas como fecha real
 * (`dd-mm-aaaa hh:mm`), los números como número, la fila 1 fija, el autofiltro y
 * una hoja de metadatos con quién lo bajó y con qué filtros — todo eso lo pone
 * `buildXlsxBuffer`, el constructor común de la plataforma.
 *
 * Respeta el alcance (`recordVisibilitySql`) igual que la lista, y deja una
 * fila en la bitácora por cada exportación: quién, qué y con qué filtros.
 */

/** Tope de registros por libro. Pasado esto se avisa DENTRO del archivo (hoja «Advertencias»). */
export const RECORDS_EXPORT_LIMIT = 5000

export type ExportOutcome =
  | { ok: true; data: { base64: string; filename: string; truncated: boolean; rowLimit: number } }
  | { ok: false; message: string }

const KIND_LABEL: Record<MantRecordKind, string> = { P: "Preventiva", C: "Correctiva" }

/** Ítems de la preventiva con un resultado dado (subconsulta correlacionada con el registro). */
const itemCount = (value: MantItemValue) =>
  sql<number>`(select count(*)::int from ${mantRecordItems} i where i.record_id = ${mantRecords.id} and i.value = ${value})`
const yesNo = (value: boolean) => (value ? "Sí" : "No")

export async function exportRecords(input: {
  session: Session
  filters: RecordFilters
  /** Un solo registro (el «Exportar a Excel» del detalle): ignora los filtros, no el alcance. */
  recordId?: string
}): Promise<ExportOutcome> {
  const viewer = viewerFromSession(input.session)
  const where = input.recordId
    ? and(recordVisibilitySql(recordVisibility(viewer)), eq(mantRecords.id, input.recordId))!
    : recordsWhere(viewer, input.filters)

  const registrar = alias(users, "registrar")
  const voider = alias(users, "voider")
  const duplicate = alias(mantRecords, "duplicate")
  const corrects = alias(mantRecords, "corrects")

  const rows = await db
    .select({
      record: mantRecords,
      worksiteName: worksites.name,
      registeredByName: registrar.name,
      duplicateFolio: duplicate.folio,
      correctsFolio: corrects.folio,
      voidReason: mantRecordVoids.reason,
      voidAt: mantRecordVoids.createdAt,
      voidBy: voider.name,
      corrective: mantRecordCorrectives,
      done: itemCount("R"),
      notDone: itemCount("NR"),
      notApplicable: itemCount("NA"),
    })
    .from(mantRecords)
    .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
    .innerJoin(registrar, eq(registrar.id, mantRecords.registeredBy))
    .leftJoin(duplicate, eq(duplicate.id, mantRecords.duplicateOfRecordId))
    .leftJoin(corrects, eq(corrects.id, mantRecords.correctsRecordId))
    .leftJoin(mantRecordVoids, eq(mantRecordVoids.recordId, mantRecords.id))
    .leftJoin(voider, eq(voider.id, mantRecordVoids.userId))
    .leftJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
    .where(where)
    .orderBy(desc(mantRecords.workDate), desc(mantRecords.receivedAt), asc(mantRecords.id))
    .limit(RECORDS_EXPORT_LIMIT + 1)

  const truncated = rows.length > RECORDS_EXPORT_LIMIT
  const kept = truncated ? rows.slice(0, RECORDS_EXPORT_LIMIT) : rows
  if (kept.length === 0) return { ok: false, message: "No hay registros para exportar con estos filtros." }
  const ids = kept.map((row) => row.record.id)
  const today = todayInChile()

  const [items, parts, drivers, updates] = await Promise.all([
    db.select().from(mantRecordItems).where(inArray(mantRecordItems.recordId, ids))
      .orderBy(asc(mantRecordItems.recordId), asc(mantRecordItems.sortOrder), asc(mantRecordItems.itemName)),
    db.select().from(mantRecordParts).where(inArray(mantRecordParts.recordId, ids))
      .orderBy(asc(mantRecordParts.recordId), asc(mantRecordParts.sortOrder)),
    db.select().from(mantRecordDrivers).where(inArray(mantRecordDrivers.recordId, ids))
      .orderBy(asc(mantRecordDrivers.recordId), asc(mantRecordDrivers.driverName)),
    db.select({ update: mantWorkshopUpdates, userName: users.name })
      .from(mantWorkshopUpdates).innerJoin(users, eq(users.id, mantWorkshopUpdates.userId))
      .where(inArray(mantWorkshopUpdates.recordId, ids))
      .orderBy(asc(mantWorkshopUpdates.recordId), asc(mantWorkshopUpdates.createdAt)),
  ])

  const meta = new Map(kept.map((row) => [row.record.id, {
    folio: row.record.folio ?? "",
    date: excelPlainDate(row.record.workDate),
    worksite: row.worksiteName,
    code: row.record.equipmentSnapshot.code,
    plate: row.record.equipmentSnapshot.plate,
  }]))
  /** Las cuatro primeras columnas de las hojas de detalle: a qué registro pertenece cada fila. */
  const lead = (recordId: string): ReportCell[] => {
    const m = meta.get(recordId)!
    return [m.folio, m.date, m.worksite, m.code, m.plate]
  }
  const updatesByRecord = new Map<string, Array<{ kind: "sigue" | "salio"; createdDate: string; exitDate: string | null }>>()
  for (const { update } of updates) {
    const list = updatesByRecord.get(update.recordId) ?? []
    list.push({ kind: update.kind as "sigue" | "salio", createdDate: todayInChile(update.createdAt), exitDate: update.exitDate })
    updatesByRecord.set(update.recordId, list)
  }

  const recordRows: ReportCell[][] = kept.map((row) => {
    const r = row.record
    const c = row.corrective
    const workshop = c?.inWorkshop
      ? workshopState({ inWorkshop: true, entryDate: c.workshopEntryDate, workDate: r.workDate, updates: updatesByRecord.get(r.id) ?? [] }, today)
      : null
    return [
      r.folio ?? "",
      KIND_LABEL[r.kind as MantRecordKind],
      RECORD_STATUS_LABEL[r.status as MantRecordStatus],
      REVIEW_LABEL[r.review as MantReview],
      excelPlainDate(r.workDate),
      excelDateTime(r.signedAt),
      excelDateTime(r.receivedAt),
      row.worksiteName,
      r.equipmentSnapshot.code,
      r.equipmentSnapshot.plate,
      r.equipmentSnapshot.type,
      r.equipmentSnapshot.brand,
      r.equipmentSnapshot.model ?? "",
      r.equipmentSnapshot.year,
      r.reading,
      r.unit,
      r.scheduleNameSnapshot ?? "",
      r.intervalValue,
      r.suggestedIntervalValue,
      r.kind === "P" ? yesNo(r.intervalValue !== r.suggestedIntervalValue) : "",
      r.manualScheduleReason ?? "",
      r.executorName,
      row.registeredByName,
      executorText({ executorKind: r.executorKind as MantExecutorKind, registeredByName: row.registeredByName, executorName: r.executorName }),
      r.kind === "P" ? row.done : null,
      r.kind === "P" ? row.notDone : null,
      r.kind === "P" ? row.notApplicable : null,
      r.notes ?? "",
      c ? c.workTypes.join(", ") : "",
      c ? (c.oils.length ? c.oils.join(", ") : "No se cambió aceite") : "",
      c?.description ?? "",
      c?.hours ?? null,
      c ? yesNo(c.inWorkshop) : "",
      excelPlainDate(c?.workshopEntryDate),
      excelPlainDate(workshop?.exitDate),
      workshop?.daysStopped ?? null,
      yesNo(r.readingJumpAlert),
      yesNo(r.outOfWorksite),
      row.duplicateFolio ?? "",
      row.correctsFolio ?? "",
      row.voidReason ?? "",
      row.voidBy ?? "",
      excelDateTime(row.voidAt),
    ]
  })

  const recordHeaders = [
    "Folio", "Tipo", "Estado", "Revisión", "Fecha del trabajo", "Firmado en el teléfono", "Recibido en la plataforma",
    "Faena", "Equipo", "Patente", "Tipo de equipo", "Marca", "Modelo", "Año", "Lectura", "Unidad",
    "Pauta", "Intervalo", "Intervalo sugerido", "Pauta elegida a mano", "Motivo de la pauta a mano",
    "Hecho por", "Registrado por", "Detalle de autoría",
    "Ítems realizados", "Ítems no realizados", "Ítems no aplica", "Observaciones",
    "Tipos de trabajo", "Aceites", "Trabajo realizado", "Horas", "Pasó por taller", "Entró a taller", "Salió de taller", "Días detenido",
    "Salto de lectura", "Fuera de faena", "Duplicado de", "Corrige a", "Motivo de anulación", "Anulado por", "Anulado el",
  ]
  const recordFormats: Record<number, string> = {
    4: EXCEL_DATE_FORMAT, 5: EXCEL_DATETIME_FORMAT, 6: EXCEL_DATETIME_FORMAT,
    17: "#,##0", 18: "#,##0", 31: "0.0", 33: EXCEL_DATE_FORMAT, 34: EXCEL_DATE_FORMAT, 42: EXCEL_DATETIME_FORMAT,
  }

  const leadHeaders = ["Folio", "Fecha del trabajo", "Faena", "Equipo", "Patente"]
  const leadFormats = { 1: EXCEL_DATE_FORMAT }
  const sheets: ReportSheet[] = [
    {
      worksheetName: "Ítems de preventivas",
      headers: [...leadHeaders, "Sistema", "Ítem", "Resultado", "Motivo", "Aviso del fabricante"],
      rows: items.map((item) => [
        ...lead(item.recordId), item.groupName, item.itemName, ITEM_VALUE_LABEL[item.value as MantItemValue], item.reason ?? "",
        yesNo(item.manufacturerWarning),
      ]),
      columnFormats: leadFormats,
    },
    {
      worksheetName: "Repuestos",
      headers: [...leadHeaders, "Cantidad", "Repuesto"],
      rows: parts.map((part) => [...lead(part.recordId), part.quantity, part.description]),
      columnFormats: leadFormats,
    },
    {
      worksheetName: "Conductores",
      headers: [...leadHeaders, "Conductor de las últimas 24 h"],
      rows: drivers.map((driver) => [...lead(driver.recordId), driver.driverName]),
      columnFormats: leadFormats,
    },
    {
      worksheetName: "Actualizaciones de taller",
      headers: [...leadHeaders, "Novedad", "Detalle", "Fecha de salida", "Registrada el", "Registrada por"],
      rows: updates.map(({ update, userName }) => [
        ...lead(update.recordId),
        update.kind === "salio" ? "Salió de taller" : "Sigue en taller",
        update.note ?? "",
        excelPlainDate(update.exitDate),
        excelDateTime(update.createdAt),
        userName,
      ]),
      columnFormats: { ...leadFormats, 7: EXCEL_DATE_FORMAT, 8: EXCEL_DATETIME_FORMAT },
    },
  ]

  const report: ReportData = {
    filenameBase: "registros-mantencion",
    worksheetName: "Registros",
    headers: recordHeaders,
    rows: recordRows,
    columnFormats: recordFormats,
    sheets,
    rowLimitApplied: truncated,
  }
  const buffer = await buildXlsxBuffer(report, {
    session: input.session,
    filters: input.recordId ? { registro: input.recordId } : input.filters,
    from: input.filters.from ?? null,
    to: input.filters.to ?? null,
    rowLimit: RECORDS_EXPORT_LIMIT,
  })

  await recordAudit({
    userId: input.session.user.id,
    userEmail: input.session.user.email ?? undefined,
    action: "export",
    entityType: "mant_records_export",
    entityId: input.recordId ?? nanoid(),
    entityCode: input.recordId ? (kept[0]?.record.folio ?? undefined) : undefined,
    newState: {
      rowCount: kept.length,
      truncated,
      filters: input.recordId ? { registro: input.recordId } : { ...input.filters },
    },
  })

  return {
    ok: true,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: input.recordId && kept[0]?.record.folio
        ? `registro-${kept[0].record.folio}-${today}.xlsx`
        : `registros-mantencion-${today}.xlsx`,
      truncated,
      rowLimit: RECORDS_EXPORT_LIMIT,
    },
  }
}
