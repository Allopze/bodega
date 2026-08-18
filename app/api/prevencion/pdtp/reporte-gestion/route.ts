/**
 * GET /api/prevencion/pdtp/reporte-gestion
 * Reporte de gestión del Programa de Trabajo Preventivo: avance, desviaciones
 * y responsables por actividad. No es el perfil de compatibilidad 2026 (§6.6,
 * no construido); usa la estructura que mejor comunica gestión.
 */

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { addExportMetadataSheet } from "@/lib/reports/export"
import { sanitizeCell as safe } from "@/lib/reports/export-module/excel-builder"
import {
  assertWorksiteAccess,
  getPdtpManagementReport,
  isActivePdtpWorksite,
  resolveActivePdtpProgramId,
  type PdtpManagementReportFilters,
} from "@/lib/services/prevention-pdtp"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { recordAudit } from "@/lib/audit"

function parseFilters(url: URL): PdtpManagementReportFilters {
  const filters: PdtpManagementReportFilters = {}
  const responsibleSlug = url.searchParams.get("responsable")
  if (responsibleSlug) filters.responsibleSlug = responsibleSlug
  const activityNumber = Number.parseInt(url.searchParams.get("actividad") ?? "", 10)
  if (Number.isFinite(activityNumber) && activityNumber >= 1) filters.activityNumber = activityNumber
  const status = url.searchParams.get("estado")
  if (status === "meets" || status === "deviates") filters.status = status
  const monthFrom = Number.parseInt(url.searchParams.get("desde") ?? "", 10)
  if (Number.isFinite(monthFrom) && monthFrom >= 1 && monthFrom <= 12) filters.monthFrom = monthFrom
  const monthTo = Number.parseInt(url.searchParams.get("hasta") ?? "", 10)
  if (Number.isFinite(monthTo) && monthTo >= 1 && monthTo <= 12) filters.monthTo = monthTo
  return filters
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  const url = request.nextUrl
  const requestedWorksiteId = url.searchParams.get("faena") || undefined
  let programId = url.searchParams.get("programId") || undefined
  const filters = parseFilters(url)

  const auditOutcome = async (result: "success" | "denied" | "invalid" | "error", reason: string, worksiteId?: string) => {
    try {
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "export",
        entityType: "prevention_pdtp_program",
        entityId: programId ?? "unspecified",
        entityCode: programId,
        newState: { result, requestedWorksiteId: worksiteId ?? requestedWorksiteId ?? null, filters },
        reason,
      })
    } catch (auditError) {
      logger.error("[prevencion/pdtp/reporte-gestion:audit]", auditError)
    }
  }

  if (!can(session, "prevention:pdtp:view")) {
    await auditOutcome("denied", "Reporte de gestión PDTP denegado por falta de permiso")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  if (scope.mode === "none") {
    await auditOutcome("denied", "Reporte de gestión PDTP denegado por falta de alcance de faena")
    return NextResponse.json({ error: "No tienes faenas habilitadas para exportar." }, { status: 403 })
  }

  const worksiteId = requestedWorksiteId ?? (scope.mode === "some" && scope.ids.length === 1 ? scope.ids[0] : undefined)
  if (!worksiteId) {
    await auditOutcome("invalid", "Reporte de gestión PDTP rechazado porque falta seleccionar una faena")
    return NextResponse.json({ error: "Selecciona una faena para generar el reporte." }, { status: 400 })
  }

  try {
    try {
      assertWorksiteAccess(worksiteId, worksiteIds)
    } catch {
      await auditOutcome("denied", "Reporte de gestión PDTP denegado por faena fuera del alcance", worksiteId)
      return NextResponse.json({ error: "Sin acceso a la faena solicitada." }, { status: 403 })
    }
    if (!(await isActivePdtpWorksite(worksiteId))) {
      await auditOutcome("invalid", "Reporte de gestión PDTP rechazado porque la faena no existe o está inactiva", worksiteId)
      return NextResponse.json({ error: "La faena solicitada no existe o está inactiva." }, { status: 400 })
    }

    if (!programId) {
      const yearParam = Number.parseInt(url.searchParams.get("year") ?? "", 10)
      const year = Number.isFinite(yearParam) ? yearParam : new Date().getFullYear()
      programId = (await resolveActivePdtpProgramId(year)) ?? undefined
    }
    if (!programId) {
      await auditOutcome("invalid", "Reporte de gestión PDTP rechazado porque no se encontró un programa", worksiteId)
      return NextResponse.json({ error: "No se encontró un programa para generar el reporte." }, { status: 404 })
    }

    const report = await getPdtpManagementReport({ programId, worksiteId, scope: worksiteIds, filters })
    if (!report) {
      await auditOutcome("invalid", "Reporte de gestión PDTP rechazado porque el programa no existe", worksiteId)
      return NextResponse.json({ error: "Programa no encontrado." }, { status: 404 })
    }

    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    workbook.creator = "Plataforma Chome"
    workbook.created = new Date()

    const summary = workbook.addWorksheet("Resumen por actividad")
    summary.columns = [
      { header: "N°", key: "order", width: 6 },
      { header: "Actividad", key: "activity", width: 60 },
      { header: "Planificado", key: "planned", width: 14 },
      { header: "Ejecutado", key: "executed", width: 14 },
      { header: "Avance", key: "percent", width: 12 },
      { header: "Estado", key: "status", width: 16 },
      { header: "Responsables", key: "responsibles", width: 40 },
      { header: "Ver registros", key: "href", width: 60 },
    ]
    for (const row of report.activities) {
      summary.addRow({
        order: row.activityNumber,
        activity: safe(row.activity),
        planned: row.planned,
        executed: row.executed,
        percent: row.percent !== null ? `${Math.round(row.percent * 100)}%` : "Sin datos",
        status: row.meetsTarget ? "Cumple meta" : "En desviación",
        responsibles: safe(row.responsibles.join(", ")),
        href: `${url.origin}/prevencion/pdtp/${report.programId}?faena=${report.worksiteId}#registros-pdtp`,
      })
    }
    summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
    summary.autoFilter = { from: "A1", to: "H1" }

    const indicators = workbook.addWorksheet("Indicadores")
    indicators.columns = [
      { header: "Código", key: "code", width: 20 },
      { header: "Indicador", key: "label", width: 28 },
      { header: "Fórmula", key: "formula", width: 90 },
    ]
    // `safe` como las otras hojas del archivo (ver la nota en el expediente).
    for (const definition of report.indicatorDefinitions) {
      indicators.addRow(Object.fromEntries(Object.entries(definition).map(([key, value]) => [key, safe(value)])))
    }
    indicators.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    indicators.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
    indicators.addRow({})
    indicators.addRow({ code: "Meta del programa", label: `${Math.round(report.target * 100)}%`, formula: "" })

    addExportMetadataSheet(workbook, session, {
      rowCount: report.activities.length,
      filters: { ...filters, programId, worksiteId },
    })

    await auditOutcome("success", `Reporte de gestión PDTP generado (${report.activities.length} actividad(es))`, worksiteId)
    const xlsx = await workbook.xlsx.writeBuffer()

    return new NextResponse(xlsx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`pdtp-reporte-gestion-${report.year}.xlsx`, "attachment"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    logger.error("[prevencion/pdtp/reporte-gestion]", err)
    await auditOutcome("error", "Reporte de gestión PDTP fallido durante la generación", worksiteId)
    return NextResponse.json({ error: "Error al generar el reporte" }, { status: 500 })
  }
}
