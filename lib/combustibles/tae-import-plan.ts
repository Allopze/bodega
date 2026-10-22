import type { ParsedTaeLegacyRow } from "./tae-import"
import { normalizeCode, normalizeName, type TaeImportReportData } from "./tae-import-report"
import { isAllowedTaeEvidenceHost } from "./tae-evidence-hosts"

export type TaeImportCatalogs = {
  worksites: Array<{ id: string; name: string }>
  vehicles: Array<{ id: string; code: string | null; plate: string; worksiteId: string; worksiteName: string }>
  workers: Array<{ id: string; name: string; worksiteId: string; worksiteName: string }>
}

/**
 * Decisiones manuales guardadas por un humano para identidades históricas
 * ambiguas: `null` significa "revisado, sin equivalente en el catálogo" — se
 * distingue de "todavía no revisado" (ausencia de la llave en el mapa), para no
 * volver a marcar como ambiguo un código ya descartado a propósito.
 */
export interface TaeImportMappings {
  vehicles: Map<string, string | null>
  drivers: Map<string, string | null>
  supervisors: Map<string, string | null>
}

export type TaeImportMappingKind = "vehicle" | "driver" | "supervisor"

export interface TaeImportMappingDecision {
  kind: TaeImportMappingKind
  worksiteId: string
  legacyValue: string
  targetId: string | null
}

export interface TaeImportReviewItem {
  key: string
  kind: TaeImportMappingKind
  worksiteId: string
  worksiteName: string
  legacyValue: string
  occurrences: number
  suggestedId: string | null
  suggestedLabel: string | null
  confidence: "exacta" | "probable" | "posible" | "sin_match"
  options: Array<{ id: string; label: string }>
}

export interface TaeImportPreview {
  summary: TaeImportReportData["summary"]
  planned: { validatedRows: number; observedRows: number; rejectedRows: number; totalLiters: number }
  reviewItems: TaeImportReviewItem[]
  parseErrors: TaeImportReportData["errors"]
  sealObservations: number
  missingReadingRows: number
  missingSealRows: number
}

export function vehicleMappingKey(worksiteId: string, legacyCode: string) { return `${worksiteId}:${normalizeCode(legacyCode)}` }
export function workerMappingKey(worksiteId: string, legacyName: string) { return `${worksiteId}:${normalizeName(legacyName)}` }

function reviewMappingKey(kind: TaeImportMappingKind, worksiteId: string, legacyValue: string) {
  return `${kind}:${worksiteId}:${kind === "vehicle" ? normalizeCode(legacyValue) : normalizeName(legacyValue)}`
}

function catalogLabel(item: { code?: string | null; plate?: string; name?: string }) {
  if (item.name) return item.name
  return [item.code, item.plate].filter(Boolean).join(" · ")
}

export interface TaeImportPlanRow {
  row: ParsedTaeLegacyRow
  worksiteId: string
  resolvedWorksiteName: string
  vehicleId: string | null
  driverWorkerId: string | null
  supervisorWorkerId: string | null
  status: "validated" | "observed"
  observations: string[]
}

export function safeTaeEvidenceUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    // Host fuera del allowlist: no se persiste como evidencia válida — evita
    // que una URL de un host no confiable entre por importación o reproceso
    // y sólo se descubra al servirla (CO-040).
    return isAllowedTaeEvidenceHost(url) ? url.toString() : null
  } catch { return null }
}

export function buildTaeImportPlan(rows: ParsedTaeLegacyRow[], report: TaeImportReportData, allowedWorksiteIds?: ReadonlySet<string>, mappings?: TaeImportMappings) {
  const worksites = new Map(report.worksites.map((item) => [item.legacyName, item]))
  const equipment = new Map(report.equipment.map((item) => [item.legacyCode, item]))
  const drivers = new Map(report.drivers.map((item) => [item.legacyName, item]))
  const supervisors = new Map(report.supervisors.map((item) => [item.legacyName, item]))
  const sealRows = new Set(report.sealObservations.flatMap((item) => [item.previousRowIndex, item.nextRowIndex]))
  const planned: TaeImportPlanRow[] = []
  const rejected: Array<{ rowIndex: number; message: string; legacySourceId: string; rawRow: Record<string, unknown> }> = []

  for (const row of rows) {
    const worksite = worksites.get(row.worksiteName)
    if (!worksite?.worksiteId || (allowedWorksiteIds && !allowedWorksiteIds.has(worksite.worksiteId))) {
      rejected.push({ rowIndex: row.rowIndex, message: allowedWorksiteIds && worksite?.worksiteId ? "Faena fuera del alcance autorizado" : "Faena sin correspondencia en el catálogo", legacySourceId: row.legacySourceId, rawRow: row.rawRow })
      continue
    }
    const vehicle = equipment.get(row.equipmentCode)
    const driver = drivers.get(row.driverName)
    const supervisor = supervisors.get(row.supervisorName)

    // Una decisión manual guardada (aunque sea "sin equivalente") tiene prioridad
    // sobre el fuzzy-match: un humano ya revisó esta identidad para esta faena.
    const vehicleDecision = mappings?.vehicles.get(vehicleMappingKey(worksite.worksiteId, row.equipmentCode))
    const driverDecision = mappings?.drivers.get(workerMappingKey(worksite.worksiteId, row.driverName))
    const supervisorDecision = mappings?.supervisors.get(workerMappingKey(worksite.worksiteId, row.supervisorName))
    const hasVehicleDecision = vehicleDecision !== undefined
    const hasDriverDecision = driverDecision !== undefined
    const hasSupervisorDecision = supervisorDecision !== undefined

    const safeVehicle = hasVehicleDecision ? vehicleDecision != null : Boolean(vehicle?.matchedVehicleId && ["exacta", "probable"].includes(vehicle.confidence) && vehicle.matchedWorksite === worksite.resolvedName)
    const safeDriver = hasDriverDecision ? driverDecision != null : Boolean(driver?.matchedWorkerId && ["exacta", "probable"].includes(driver.confidence) && driver.sameWorksite)
    const safeSupervisor = hasSupervisorDecision ? supervisorDecision != null : Boolean(supervisor?.matchedWorkerId && ["exacta", "probable"].includes(supervisor.confidence) && supervisor.sameWorksite)
    const observations = [
      !safeVehicle && (hasVehicleDecision ? "Equipo sin equivalente (decisión manual confirmada)" : "Equipo sin match confiable en la misma faena"),
      !safeDriver && (hasDriverDecision ? "Conductor sin equivalente (decisión manual confirmada)" : "Conductor conservado como texto histórico"),
      !safeSupervisor && (hasSupervisorDecision ? "Supervisor sin equivalente (decisión manual confirmada)" : "Supervisor conservado como texto histórico"),
      row.meterReading == null && "Lectura no numérica o ausente",
      (!row.removedSealNumber || !row.installedSealNumber) && "Sello faltante",
      sealRows.has(row.rowIndex) && "Quiebre de continuidad de sello",
    ].filter((item): item is string => Boolean(item))
    planned.push({
      row,
      worksiteId: worksite.worksiteId,
      resolvedWorksiteName: worksite.resolvedName,
      vehicleId: hasVehicleDecision ? vehicleDecision : (safeVehicle ? vehicle!.matchedVehicleId : null),
      driverWorkerId: hasDriverDecision ? driverDecision : (safeDriver ? driver!.matchedWorkerId : null),
      supervisorWorkerId: hasSupervisorDecision ? supervisorDecision : (safeSupervisor ? supervisor!.matchedWorkerId : null),
      status: observations.length === 0 ? "validated" : "observed",
      observations,
    })
  }
  return { planned, rejected }
}

/**
 * Construye la revisión previa por identidad y faena. El dry-run no propone
 * decisiones inseguras: sólo muestra la sugerencia y exige que el operador
 * elija explícitamente un catálogo o "sin equivalente" antes de importar.
 */
export function buildTaeImportReview(input: {
  rows: ParsedTaeLegacyRow[]
  report: TaeImportReportData
  catalogs: TaeImportCatalogs
  allowedWorksiteIds?: ReadonlySet<string>
  mappings?: TaeImportMappings
}): TaeImportPreview {
  const { rows, report, catalogs, allowedWorksiteIds, mappings } = input
  const worksites = new Map(report.worksites.map((item) => [item.legacyName, item]))
  const equipment = new Map(report.equipment.map((item) => [item.legacyCode, item]))
  const drivers = new Map(report.drivers.map((item) => [item.legacyName, item]))
  const supervisors = new Map(report.supervisors.map((item) => [item.legacyName, item]))
  const counts = new Map<string, { kind: TaeImportMappingKind; worksiteId: string; worksiteName: string; legacyValue: string; occurrences: number }>()

  function add(kind: TaeImportMappingKind, worksiteId: string, worksiteName: string, legacyValue: string) {
    const key = reviewMappingKey(kind, worksiteId, legacyValue)
    const current = counts.get(key)
    if (current) current.occurrences++
    else counts.set(key, { kind, worksiteId, worksiteName, legacyValue, occurrences: 1 })
  }

  for (const row of rows) {
    const worksite = worksites.get(row.worksiteName)
    if (!worksite?.worksiteId || (allowedWorksiteIds && !allowedWorksiteIds.has(worksite.worksiteId))) continue
    add("vehicle", worksite.worksiteId, worksite.resolvedName, row.equipmentCode)
    add("driver", worksite.worksiteId, worksite.resolvedName, row.driverName)
    add("supervisor", worksite.worksiteId, worksite.resolvedName, row.supervisorName)
  }

  const reviewItems: TaeImportReviewItem[] = []
  for (const item of counts.values()) {
    const reportMatch = item.kind === "vehicle" ? equipment.get(item.legacyValue) : item.kind === "driver" ? drivers.get(item.legacyValue) : supervisors.get(item.legacyValue)
    const savedId = item.kind === "vehicle"
      ? mappings?.vehicles.get(vehicleMappingKey(item.worksiteId, item.legacyValue))
      : item.kind === "driver"
        ? mappings?.drivers.get(workerMappingKey(item.worksiteId, item.legacyValue))
        : mappings?.supervisors.get(workerMappingKey(item.worksiteId, item.legacyValue))
    if (savedId !== undefined) continue

    const safeSuggestion = Boolean(reportMatch && ["exacta", "probable"].includes(reportMatch.confidence) && (
      item.kind === "vehicle"
        ? "matchedWorksite" in reportMatch && reportMatch.matchedWorksite === item.worksiteName
        : "sameWorksite" in reportMatch && reportMatch.sameWorksite
    ))
    const options = item.kind === "vehicle"
      ? catalogs.vehicles.filter((vehicle) => vehicle.worksiteId === item.worksiteId).map((vehicle) => ({ id: vehicle.id, label: catalogLabel(vehicle) }))
      : catalogs.workers.filter((worker) => worker.worksiteId === item.worksiteId).map((worker) => ({ id: worker.id, label: catalogLabel(worker) }))
    // Exact/probable same-faena matches are already safe for the automatic
    // plan. Only ambiguous rows require an explicit pre-import decision.
    if (safeSuggestion) continue
    reviewItems.push({
      key: `${item.kind}:${item.worksiteId}:${item.legacyValue}`,
      kind: item.kind,
      worksiteId: item.worksiteId,
      worksiteName: item.worksiteName,
      legacyValue: item.legacyValue,
      occurrences: item.occurrences,
      suggestedId: reportMatch && "matchedWorkerId" in reportMatch ? reportMatch.matchedWorkerId : reportMatch && "matchedVehicleId" in reportMatch ? reportMatch.matchedVehicleId : null,
      suggestedLabel: reportMatch && "matchedName" in reportMatch ? reportMatch.matchedName : reportMatch && "matchedCode" in reportMatch ? ([reportMatch.matchedCode, reportMatch.matchedPlate].filter(Boolean).join(" · ") || null) : null,
      confidence: reportMatch?.confidence ?? "sin_match",
      options,
    })
  }

  const plan = buildTaeImportPlan(rows, report, allowedWorksiteIds, mappings)
  return {
    summary: report.summary,
    planned: {
      validatedRows: plan.planned.filter((row) => row.status === "validated").length,
      observedRows: plan.planned.filter((row) => row.status === "observed").length,
      rejectedRows: plan.rejected.length + report.errors.length,
      totalLiters: plan.planned.reduce((sum, row) => sum + row.row.liters, 0),
    },
    reviewItems,
    parseErrors: report.errors,
    sealObservations: report.sealObservations.length,
    missingReadingRows: report.missingReadingRows.length,
    missingSealRows: report.missingSealRows.length,
  }
}
