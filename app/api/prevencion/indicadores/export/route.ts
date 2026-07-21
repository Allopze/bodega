/** GET /api/prevencion/indicadores/export — motor canónico y conciliación XLSX. */

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { addExportMetadataSheet } from "@/lib/reports/export"
import { getCanonicalSafetyIndicatorYear } from "@/lib/services/prevention-indicadores"
import { encodeContentDisposition } from "@/lib/utils"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const FORMULAS = {
  accidentability: "Accidentes del trabajo incluidos / dotación promedio del período × 100",
  frequency: "Personas lesionadas incluidas / horas trabajadas × 1.000.000",
  severity: "(Días de ausencia + días de cargo) / horas trabajadas × 1.000.000",
}

function safe(value: unknown) {
  if (value === null || value === undefined) return ""
  const text = String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function displayRate(value: number | null) {
  return value === null ? "No calculable" : Number(value.toFixed(2))
}

function styleHeader(sheet: { getRow: (row: number) => { font: object; fill: object } }) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:indicadores:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  const requestedYear = Number.parseInt(request.nextUrl.searchParams.get("year") ?? "", 10)
  const currentYear = new Date().getFullYear()
  const year = Number.isFinite(requestedYear) && requestedYear >= 2024 && requestedYear <= currentYear + 2 ? requestedYear : currentYear

  try {
    const view = await getCanonicalSafetyIndicatorYear(year, resolveWorksiteScope(session))
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    workbook.creator = "Plataforma Chome"
    workbook.created = new Date()
    const groups = view.groups.filter((group) => group.worksiteId !== "total")

    const monthly = workbook.addWorksheet("Resultados mensuales")
    monthly.columns = [
      { header: "Faena", key: "worksite", width: 24 }, { header: "Período", key: "period", width: 14 },
      { header: "Estado", key: "status", width: 18 }, { header: "Fórmula", key: "formula", width: 28 },
      { header: "Accidentes confirmados", key: "accidents", width: 20 }, { header: "Lesionados confirmados", key: "injured", width: 20 },
      { header: "Casos pendientes", key: "pending", width: 16 }, { header: "Dotación promedio", key: "workers", width: 18 },
      { header: "Horas trabajadas", key: "hours", width: 18 }, { header: "Tasa accidentabilidad", key: "accidentability", width: 20 },
      { header: "Tasa frecuencia", key: "frequency", width: 18 }, { header: "Días ausencia", key: "absence", width: 15 },
      { header: "Días cargo", key: "charge", width: 13 }, { header: "Error/conciliación", key: "issues", width: 55 },
      { header: "Versión fórmula", key: "version", width: 24 },
    ]
    for (const group of groups) group.monthly.forEach((result, index) => monthly.addRow({
      worksite: safe(group.worksiteName), period: `${MONTHS[index]} ${year}`, status: result.status,
      formula: `${FORMULAS.frequency}; ${FORMULAS.accidentability}`,
      accidents: result.confirmed.accidents, injured: result.confirmed.injuredPeople, pending: result.pendingCaseCount,
      workers: result.workerAverage ?? "No calculable", hours: result.workedHours,
      accidentability: displayRate(result.confirmed.accidentabilityRate), frequency: displayRate(result.confirmed.frequencyRate),
      absence: result.confirmed.absenceDays, charge: result.confirmed.chargeDays,
      issues: safe([...result.errors, ...result.reconciliationIssues].join(" ")), version: result.formulaVersion,
    }))
    styleHeader(monthly)
    monthly.autoFilter = { from: "A1", to: "O1" }

    const semesters = workbook.addWorksheet("Gravedad semestral")
    semesters.columns = [
      { header: "Faena", key: "worksite", width: 24 }, { header: "Semestre", key: "semester", width: 12 },
      { header: "Estado", key: "status", width: 18 }, { header: "Días ausencia", key: "absence", width: 15 },
      { header: "Días cargo", key: "charge", width: 13 }, { header: "Horas", key: "hours", width: 16 },
      { header: "Tasa gravedad", key: "severity", width: 18 }, { header: "Fórmula", key: "formula", width: 60 },
      { header: "Versión", key: "version", width: 24 },
    ]
    for (const group of groups) group.semesters.forEach((result, index) => semesters.addRow({
      worksite: safe(group.worksiteName), semester: `S${index + 1} ${year}`, status: result.status,
      absence: result.confirmed.absenceDays, charge: result.confirmed.chargeDays, hours: result.workedHours,
      severity: displayRate(result.confirmed.severityRate), formula: FORMULAS.severity, version: result.formulaVersion,
    }))
    styleHeader(semesters)

    const annual = workbook.addWorksheet("Accidentabilidad anual")
    annual.columns = [
      { header: "Faena", key: "worksite", width: 24 }, { header: "Año", key: "year", width: 10 },
      { header: "Estado", key: "status", width: 18 }, { header: "Accidentes", key: "accidents", width: 14 },
      { header: "Dotación promedio", key: "workers", width: 18 }, { header: "Tasa", key: "rate", width: 14 },
      { header: "Fórmula", key: "formula", width: 65 }, { header: "Versión", key: "version", width: 24 },
    ]
    for (const group of groups) annual.addRow({
      worksite: safe(group.worksiteName), year, status: group.annual.status,
      accidents: group.annual.confirmed.accidents, workers: group.annual.workerAverage ?? "No calculable",
      rate: displayRate(group.annual.confirmed.accidentabilityRate), formula: FORMULAS.accidentability, version: group.annual.formulaVersion,
    })
    styleHeader(annual)

    const denominators = workbook.addWorksheet("Denominadores")
    denominators.columns = [
      { header: "Faena ID", key: "worksite", width: 24 }, { header: "Período", key: "period", width: 12 },
      { header: "Dotación", key: "workers", width: 12 }, { header: "Horas", key: "hours", width: 14 },
      { header: "Procedencia", key: "sourceType", width: 18 }, { header: "Referencia", key: "source", width: 36 },
      { header: "Evidencia", key: "evidence", width: 36 }, { header: "SHA-256", key: "checksum", width: 66 },
      { header: "Estado", key: "status", width: 16 }, { header: "Conciliación", key: "reconciliation", width: 16 },
      { header: "Aprobador", key: "approver", width: 24 }, { header: "Fecha aprobación", key: "approvedAt", width: 22 },
      { header: "Versión", key: "version", width: 10 },
    ]
    view.denominators.forEach((item) => denominators.addRow({
      worksite: item.worksiteId, period: `${String(item.month).padStart(2, "0")}/${item.year}`,
      workers: item.workerCount, hours: item.workedHours, sourceType: item.sourceType,
      source: safe(item.sourceReference), evidence: safe(item.evidenceReference), checksum: safe(item.evidenceChecksumSha256),
      status: item.status, reconciliation: item.reconciliationStatus, approver: item.approvedByUserId ?? "",
      approvedAt: item.approvedAt ?? "", version: item.version,
    }))
    styleHeader(denominators)

    const sources = workbook.addWorksheet("Fuentes numerador")
    sources.columns = [
      { header: "Faena", key: "worksite", width: 24 }, { header: "Período", key: "period", width: 14 },
      { header: "Incidente ID", key: "incident", width: 32 }, { header: "Caso persona-evento", key: "caseKey", width: 55 },
      { header: "Estado cálculo", key: "status", width: 18 }, { header: "Drill-down", key: "href", width: 70 },
    ]
    for (const group of groups) group.monthly.forEach((result, index) => {
      const max = Math.max(result.incidentIds.length, result.personCaseKeys.length)
      for (let row = 0; row < max; row++) sources.addRow({
        worksite: safe(group.worksiteName), period: `${MONTHS[index]} ${year}`,
        incident: result.incidentIds[row] ?? "", caseKey: result.personCaseKeys[row] ?? "", status: result.status,
        href: `/prevencion/incidentes?worksiteId=${group.worksiteId}&year=${year}&monthFrom=${index + 1}&monthTo=${index + 1}&indicator=frequency`,
      })
    })
    styleHeader(sources)

    const reconciliation = workbook.addWorksheet("Conciliación legado")
    reconciliation.columns = [
      { header: "Faena", key: "worksite", width: 24 }, { header: "Período", key: "period", width: 14 },
      { header: "Estado", key: "status", width: 16 }, { header: "Legado", key: "legacy", width: 70 },
      { header: "Canónico", key: "derived", width: 70 }, { header: "Diferencias", key: "differences", width: 70 },
    ]
    for (const group of groups) group.monthly.forEach((result, index) => reconciliation.addRow({
      worksite: safe(group.worksiteName), period: `${MONTHS[index]} ${year}`,
      status: result.legacyComparison.status, legacy: safe(JSON.stringify(result.legacyComparison.legacy)),
      derived: safe(JSON.stringify(result.legacyComparison.derived)), differences: safe(JSON.stringify(result.legacyComparison.differences)),
    }))
    styleHeader(reconciliation)

    const snapshots = workbook.addWorksheet("Snapshots de cierre")
    snapshots.columns = [
      { header: "Faena ID", key: "worksite", width: 24 }, { header: "Período", key: "period", width: 16 },
      { header: "Estado", key: "status", width: 16 }, { header: "Fórmula", key: "formula", width: 24 },
      { header: "Hash fuentes", key: "hash", width: 66 }, { header: "Aprobador", key: "approver", width: 24 },
      { header: "Fundamento", key: "reason", width: 55 }, { header: "Aprobado", key: "approved", width: 22 },
    ]
    view.snapshots.forEach((item) => snapshots.addRow({
      worksite: item.worksiteId, period: `${item.startMonth}-${item.endMonth}/${item.year}`,
      status: item.status, formula: item.formulaVersion, hash: item.sourceHashSha256,
      approver: item.approvedByUserId ?? "", reason: safe(item.approvalReason), approved: item.approvedAt ?? "",
    }))
    styleHeader(snapshots)

    addExportMetadataSheet(workbook, session, { rowCount: groups.length * 12, from: `Enero ${year}`, to: `Diciembre ${year}` })
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "prevention_safety_indicators",
      entityId: String(year),
      newState: { formulaVersions: [...new Set(groups.map((item) => item.annual.formulaVersion))], worksiteCount: groups.length, sheetCount: workbook.worksheets.length },
      reason: "Exportación XLSX canónica de indicadores, fuentes y conciliación",
    })
    const reconciled = groups.every((group) => group.monthly.every((item) => item.status === "reconciled"))
    const xlsx = await workbook.xlsx.writeBuffer()
    return new NextResponse(xlsx, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`indicadores_canonicos_${year}.xlsx`, "attachment"),
        "X-Chome-Data-Status": reconciled ? "canonical-reconciled" : "canonical-mixed",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    logger.error("[prevencion/indicadores/export]", error)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
