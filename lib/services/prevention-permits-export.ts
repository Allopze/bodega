import { asc, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionJsaSteps,
  preventionPermitControls,
  preventionPermitCrew,
  preventionPermitIsolations,
  preventionPermitMeasurements,
} from "@/db/schema"
import {
  ENERGY_SOURCE_LABELS,
  PERMIT_CREW_ROLE_LABELS,
  PERMIT_STATUS_LABELS,
  RESIDUAL_RISK_LABELS,
} from "@/lib/prevention/permits"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export"
import { sanitizeCell as safeCell } from "@/lib/reports/export-module/excel-builder"
import { listWorkPermits, type PermitAccess } from "@/lib/services/prevention-permits"
import { todayInChile } from "@/lib/utils"

function sheet(worksheetName: string, headers: string[], rows: ReportCell[][]): ReportSheet {
  return { worksheetName, headers, rows }
}

function label(map: Record<string, string>, key: string | null | undefined) {
  if (!key) return ""
  return map[key] ?? key
}

/** Expediente del permiso: la evidencia de que el trabajo se habilitó con controles. */
export async function buildPermitExport(access: PermitAccess): Promise<ReportData> {
  if (!access.permissions.includes("prevention:permits:export")) {
    throw new Error("Permiso de trabajo no encontrado o fuera de alcance.")
  }

  const permits = await listWorkPermits(access)
  const ids = permits.map((row) => row.permit.id)
  const code = new Map(permits.map((row) => [row.permit.id, row.permit.code]))

  const [controls, isolations, measurements, jsaSteps, crew] = ids.length === 0
    ? [[], [], [], [], []]
    : await Promise.all([
      db.select().from(preventionPermitControls).where(inArray(preventionPermitControls.permitId, ids)),
      db.select().from(preventionPermitIsolations).where(inArray(preventionPermitIsolations.permitId, ids)),
      db.select().from(preventionPermitMeasurements).where(inArray(preventionPermitMeasurements.permitId, ids)),
      db.select().from(preventionJsaSteps).where(inArray(preventionJsaSteps.permitId, ids)).orderBy(asc(preventionJsaSteps.stepOrder)),
      db.select().from(preventionPermitCrew).where(inArray(preventionPermitCrew.permitId, ids)),
    ])

  const sheets: ReportSheet[] = [
    sheet(
      "Permisos",
      ["Código", "Tipo", "Faena", "Tarea", "Lugar", "Estado", "Inicio planificado", "Término planificado", "Extendido hasta", "Motivo de extensión", "Activado", "Suspendido", "Motivo de suspensión", "Cerrado", "Resumen de cierre", "Cuadrilla", "Acuses", "Aislamientos abiertos"],
      permits.map((row) => [
        safeCell(row.permit.code),
        safeCell(row.typeName),
        safeCell(row.worksiteName),
        safeCell(row.permit.taskDescription),
        safeCell(row.permit.location),
        label(PERMIT_STATUS_LABELS, row.permit.status),
        row.permit.plannedStartAt,
        row.permit.plannedEndAt,
        row.permit.extendedUntilAt,
        safeCell(row.permit.extensionReason),
        row.permit.activatedAt,
        row.permit.suspendedAt,
        safeCell(row.permit.suspensionReason),
        row.permit.closedAt,
        safeCell(row.permit.closureSummary),
        row.crewCount,
        row.acknowledgedCount,
        row.openIsolationCount,
      ]),
    ),
    sheet(
      "AST / JSA",
      ["Permiso", "Paso", "Descripción", "Peligros", "Controles", "Riesgo residual"],
      jsaSteps.map((step) => [
        safeCell(code.get(step.permitId)),
        step.stepOrder,
        safeCell(step.stepDescription),
        safeCell(step.hazards),
        safeCell(step.controls),
        label(RESIDUAL_RISK_LABELS, step.residualRisk),
      ]),
    ),
    sheet(
      "Controles verificados",
      ["Permiso", "Control", "Obligatorio", "Verificado", "Verificado por", "Fecha", "Motivo de no aplicabilidad"],
      controls.map((control) => [
        safeCell(code.get(control.permitId)),
        safeCell(control.description),
        control.isMandatory ? "Sí" : "No",
        control.verified ? "Sí" : "No",
        safeCell(control.verifiedByUserId),
        control.verifiedAt,
        safeCell(control.notApplicableReason),
      ]),
    ),
    sheet(
      "Aislamientos LOTO",
      ["Permiso", "Energía", "Equipo", "Método", "Bloqueo/tarjeta", "Aplicado por", "Aplicado", "Energía cero verificada", "Retirado por", "Retirado"],
      isolations.map((isolation) => [
        safeCell(code.get(isolation.permitId)),
        label(ENERGY_SOURCE_LABELS, isolation.energySource),
        safeCell(isolation.equipmentTag),
        safeCell(isolation.isolationMethod),
        safeCell(isolation.lockTagId),
        safeCell(isolation.appliedByUserId),
        isolation.appliedAt,
        isolation.verifiedZeroEnergy ? "Sí" : "No",
        safeCell(isolation.removedByUserId),
        isolation.removedAt,
      ]),
    ),
    sheet(
      "Mediciones",
      ["Permiso", "Parámetro", "Valor", "Unidad", "Mínimo", "Máximo", "En rango", "Equipo", "Calibración", "Tomada por", "Fecha"],
      measurements.map((measurement) => [
        safeCell(code.get(measurement.permitId)),
        safeCell(measurement.parameter),
        measurement.value,
        safeCell(measurement.unit),
        measurement.acceptableMin,
        measurement.acceptableMax,
        measurement.withinRange ? "Sí" : "No",
        safeCell(measurement.equipmentTag),
        measurement.calibrationDate,
        safeCell(measurement.takenByUserId),
        measurement.takenAt,
      ]),
    ),
    sheet(
      "Cuadrilla",
      ["Permiso", "Rol", "Trabajador", "Acuse", "Firma SHA-256"],
      crew.map((member) => [
        safeCell(code.get(member.permitId)),
        label(PERMIT_CREW_ROLE_LABELS, member.role),
        safeCell(member.workerId),
        member.acknowledgedAt ?? "Pendiente",
        safeCell(member.acknowledgementSha256),
      ]),
    ),
  ]

  return {
    filenameBase: `permisos_trabajo_${todayInChile()}`,
    worksheetName: sheets[0]!.worksheetName,
    headers: sheets[0]!.headers,
    rows: sheets[0]!.rows,
    sheets,
  }
}
