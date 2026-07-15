"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardAuth, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"
import {
  buildMonthlyCounters,
  calcRates,
  getSafetyIndicators,
  listVisibleWorksites,
  upsertSafetyIndicatorMonth,
  type WorksiteScope,
} from "@/lib/services/prevention-indicadores"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/indicadores"
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): WorksiteScope {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function saveSafetyIndicatorMonthAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:indicadores:manage")) {
    return { ok: false, message: "No tienes permisos para registrar indicadores de accidentabilidad." }
  }
  try {
    await upsertSafetyIndicatorMonth(input, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    if (e instanceof ZodError) {
      return { ok: false, message: "Revisa los campos marcados.", fieldErrors: e.flatten().fieldErrors as Record<string, string[]> }
    }
    return { ok: false, message: (e as Error).message }
  }
}

export async function exportSafetyIndicatorsXlsxAction(year: number) {
  let session
  try { session = await requirePermission("prevention:indicadores:view") }
  catch { return { ok: false as const, message: "Sin permisos para exportar indicadores de accidentabilidad" } }

  const scope = scopeToIds(resolveWorksiteScope(session))
  const [worksiteRows, indicatorRows] = await Promise.all([
    listVisibleWorksites(scope),
    getSafetyIndicators(year, scope),
  ])

  const ExcelJS = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`Indicadores ${year}`)

  ws.columns = [
    { header: "Faena", key: "worksite", width: 22 },
    { header: "Mes", key: "month", width: 12 },
    { header: "Trabajadores", key: "trabajadores", width: 13 },
    { header: "Horas Hombre", key: "horasHombre", width: 14 },
    { header: "Acc. c/TP", key: "accCTP", width: 11 },
    { header: "Acc. s/TP", key: "accSTP", width: 11 },
    { header: "Días Perdidos", key: "diasPerdidos", width: 13 },
    { header: "Incidentes", key: "incidentes", width: 11 },
    { header: "Daño Material", key: "danoMaterial", width: 13 },
    { header: "Daño Ambiental", key: "danoAmbiental", width: 14 },
    { header: "Tasa Frecuencia", key: "tasaFrecuencia", width: 15 },
    { header: "Tasa Gravedad", key: "tasaGravedad", width: 14 },
    { header: "Total Accidentes", key: "totalAccidentes", width: 15 },
  ]
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }

  for (const worksite of worksiteRows) {
    const months = buildMonthlyCounters(indicatorRows, worksite.id)
    months.forEach((counters, i) => {
      const rates = calcRates(counters)
      ws.addRow({
        worksite: worksite.name, month: MONTHS[i],
        trabajadores: counters.trabajadores, horasHombre: counters.horasHombre,
        accCTP: counters.accConTiempoPerdido, accSTP: counters.accSinTiempoPerdido,
        diasPerdidos: counters.diasPerdidos, incidentes: counters.incidentes,
        danoMaterial: counters.danoMaterial, danoAmbiental: counters.danoAmbiental,
        tasaFrecuencia: Number(rates.tasaFrecuencia.toFixed(2)),
        tasaGravedad: Number(rates.tasaGravedad.toFixed(2)),
        totalAccidentes: rates.totalAccidentes,
      })
    })
  }

  addExportMetadataSheet(wb, session, { rowCount: worksiteRows.length * 12, from: `Enero ${year}`, to: `Diciembre ${year}` })

  const buffer = await wb.xlsx.writeBuffer()
  const base64 = Buffer.from(buffer).toString("base64")
  return {
    ok: true as const,
    data: { base64, filename: `indicadores_accidentabilidad_${year}.xlsx` },
  }
}
