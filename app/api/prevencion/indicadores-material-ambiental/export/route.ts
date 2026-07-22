/** GET /api/prevencion/indicadores-material-ambiental/export — export Excel de indicadores material y ambiental. */

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { addExportMetadataSheet } from "@/lib/reports/export"
import { getMaterialEnvironmentalEvents } from "@/lib/services/prevention-indicadores"
import { encodeContentDisposition } from "@/lib/utils"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

function safe(value: unknown) {
  if (value === null || value === undefined) return ""
  const text = String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
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
    const { eventData } = await getMaterialEnvironmentalEvents(year, resolveWorksiteScope(session))
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    workbook.creator = "Plataforma Chome"
    workbook.created = new Date()

    const groups = eventData.filter((item) => item.worksiteId !== "total")

    // ── Hoja 1: Desglose mensual ──────────────────────────────────────
    const monthly = workbook.addWorksheet("Desglose mensual")
    monthly.columns = [
      { header: "Faena", key: "worksite", width: 24 },
      { header: "Mes", key: "month", width: 14 },
      { header: "Incidentes peligrosos", key: "dangerous", width: 22 },
      { header: "Daño material", key: "material", width: 18 },
      { header: "Daño ambiental", key: "environmental", width: 18 },
      { header: "Total eventos", key: "total", width: 16 },
    ]
    for (const group of groups) {
      group.monthly.forEach((item) => {
        const total = item.dangerousIncidents + item.materialDamage + item.environmentalSpills
        monthly.addRow({
          worksite: safe(group.worksiteName),
          month: `${MONTHS[item.month - 1]} ${year}`,
          dangerous: item.dangerousIncidents,
          material: item.materialDamage,
          environmental: item.environmentalSpills,
          total,
        })
      })
    }
    styleHeader(monthly)
    monthly.autoFilter = { from: "A1", to: "F1" }

    // ── Hoja 2: Resumen anual por faena ──────────────────────────────
    const annual = workbook.addWorksheet("Resumen anual")
    annual.columns = [
      { header: "Faena", key: "worksite", width: 24 },
      { header: "Año", key: "year", width: 10 },
      { header: "Incidentes peligrosos", key: "dangerous", width: 22 },
      { header: "Daño material", key: "material", width: 18 },
      { header: "Daño ambiental", key: "environmental", width: 18 },
      { header: "Total eventos", key: "total", width: 16 },
    ]
    for (const group of groups) {
      const total = group.annual.dangerousIncidents + group.annual.materialDamage + group.annual.environmentalSpills
      annual.addRow({
        worksite: safe(group.worksiteName),
        year,
        dangerous: group.annual.dangerousIncidents,
        material: group.annual.materialDamage,
        environmental: group.annual.environmentalSpills,
        total,
      })
    }
    styleHeader(annual)

    // ── Hoja 3: Metadatos ────────────────────────────────────────────
    addExportMetadataSheet(workbook, session, {
      rowCount: groups.length * 12,
      from: `Enero ${year}`,
      to: `Diciembre ${year}`,
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "prevention_material_environmental_indicators",
      entityId: String(year),
      newState: { worksiteCount: groups.length, sheetCount: workbook.worksheets.length },
      reason: "Exportación Excel de indicadores material y ambiental",
    })

    const xlsx = await workbook.xlsx.writeBuffer()
    return new NextResponse(xlsx, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`indicadores_material_ambiental_${year}.xlsx`, "attachment"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    logger.error("[prevencion/indicadores-material-ambiental/export]", error)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
