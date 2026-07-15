/** GET /api/prevencion/indicadores/export — export XLSX en streaming HTTP. */

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { addExportMetadataSheet } from "@/lib/reports/export"
import {
  buildMonthlyCounters,
  calcRates,
  getSafetyIndicators,
  listVisibleWorksites,
  type WorksiteScope,
} from "@/lib/services/prevention-indicadores"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): WorksiteScope {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:indicadores:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const requestedYear = Number.parseInt(request.nextUrl.searchParams.get("year") ?? "", 10)
  const currentYear = new Date().getFullYear()
  const year = Number.isFinite(requestedYear) && requestedYear >= 2024 && requestedYear <= currentYear + 2
    ? requestedYear
    : currentYear

  try {
    const scope = scopeToIds(resolveWorksiteScope(session))
    const [worksites, indicators] = await Promise.all([
      listVisibleWorksites(scope),
      getSafetyIndicators(year, scope),
    ])
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(`Indicadores ${year}`)
    sheet.columns = [
      { header: "Faena", key: "worksite", width: 22 }, { header: "Mes", key: "month", width: 12 },
      { header: "Trabajadores", key: "trabajadores", width: 13 }, { header: "Horas Hombre", key: "horasHombre", width: 14 },
      { header: "Acc. c/TP", key: "accCTP", width: 11 }, { header: "Acc. s/TP", key: "accSTP", width: 11 },
      { header: "Días Perdidos", key: "diasPerdidos", width: 13 }, { header: "Incidentes", key: "incidentes", width: 11 },
      { header: "Daño Material", key: "danoMaterial", width: 13 }, { header: "Daño Ambiental", key: "danoAmbiental", width: 14 },
      { header: "Tasa Frecuencia", key: "tasaFrecuencia", width: 15 }, { header: "Tasa Gravedad", key: "tasaGravedad", width: 14 },
      { header: "Total Accidentes", key: "totalAccidentes", width: 15 },
    ]
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }

    for (const worksite of worksites) {
      buildMonthlyCounters(indicators, worksite.id).forEach((counters, index) => {
        const rates = calcRates(counters)
        sheet.addRow({
          worksite: worksite.name, month: MONTHS[index], trabajadores: counters.trabajadores,
          horasHombre: counters.horasHombre, accCTP: counters.accConTiempoPerdido,
          accSTP: counters.accSinTiempoPerdido, diasPerdidos: counters.diasPerdidos,
          incidentes: counters.incidentes, danoMaterial: counters.danoMaterial, danoAmbiental: counters.danoAmbiental,
          tasaFrecuencia: Number(rates.tasaFrecuencia.toFixed(2)), tasaGravedad: Number(rates.tasaGravedad.toFixed(2)),
          totalAccidentes: rates.totalAccidentes,
        })
      })
    }
    addExportMetadataSheet(workbook, session, {
      rowCount: worksites.length * 12,
      from: `Enero ${year}`,
      to: `Diciembre ${year}`,
    })
    const xlsx = await workbook.xlsx.writeBuffer()
    return new NextResponse(xlsx, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`indicadores_accidentabilidad_${year}.xlsx`, "attachment"),
      },
    })
  } catch (error) {
    logger.error("[prevencion/indicadores/export]", error)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
