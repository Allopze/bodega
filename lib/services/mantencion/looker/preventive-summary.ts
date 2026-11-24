import { bucketLabel, listBuckets } from "@/lib/indicators/period"
import { nameKey } from "@/lib/mantencion/normalize"
import { formatQty } from "@/lib/utils"
import type {
  ComplianceBucket, ComplianceByPlate, ComplianceCheck, MatrixCheck, MatrixItem, PreventiveCompliance,
} from "./types"

/**
 * Agregaciones puras de la pestaña Preventivo. El % de una pauta es
 * `realizados / (realizados + no realizados)`; los «No aplica» quedan fuera. El % de un mes o de
 * una faena + mecánico es el PROMEDIO de los % de cada pauta, no el cociente de los totales.
 */

export function parseLevelValue(label: string | null | undefined): number | null {
  if (!label) return null
  const digits = label.replace(/[^\d]/g, "")
  if (!digits) return null
  const value = Number(digits)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function levelLabel(value: number | null, unit: "km" | "h" | null): string {
  if (value == null) return "Pauta"
  return `${formatQty(value)} ${unit === "km" ? "km" : "h"}`
}

export function percentFromCounts(done: number, notDone: number, declared: number | null): number | null {
  if (done + notDone > 0) return (done / (done + notDone)) * 100
  if (declared != null) return declared * 100
  return null
}

export function mechanicKeyOf(mechanic: string | null): string | null {
  const trimmed = mechanic?.trim()
  return trimmed ? nameKey(trimmed) : null
}

export function averagePercent(values: ReadonlyArray<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (valid.length === 0) return null
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10
}

function monthBuckets(checks: readonly ComplianceCheck[], from: string, to: string): ComplianceBucket[] {
  return listBuckets(from, to, "month").map((key) => {
    const inMonth = checks.filter((check) => check.month === key)
    return {
      key,
      label: bucketLabel(key, "month"),
      percent: averagePercent(inMonth.map((check) => check.percent)),
      checks: inMonth.length,
    }
  })
}

function worksiteMechanicBuckets(checks: readonly ComplianceCheck[]): ComplianceBucket[] {
  const groups = new Map<string, { worksiteId: string | null; worksiteName: string | null; mechanic: string | null; values: number[]; checks: number }>()
  for (const check of checks) {
    const key = `${check.worksiteId ?? "none"}|${check.mechanicKey ?? "none"}`
    const group = groups.get(key) ?? { worksiteId: check.worksiteId, worksiteName: check.worksiteName, mechanic: check.mechanic, values: [], checks: 0 }
    group.checks += 1
    if (check.percent != null) group.values.push(check.percent)
    groups.set(key, group)
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: `${group.worksiteName ?? "Sin faena"} · ${group.mechanic ?? "Sin mecánico"}`,
    percent: averagePercent(group.values),
    checks: group.checks,
    worksiteId: group.worksiteId,
    worksiteName: group.worksiteName,
    mechanicKey: group.mechanic ? nameKey(group.mechanic) : null,
    mechanicLabel: group.mechanic,
  })).sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.label.localeCompare(b.label, "es"))
}

function plateRows(checks: readonly ComplianceCheck[]): ComplianceByPlate[] {
  const groups = new Map<string, { row: ComplianceByPlate; values: number[]; levels: Set<string> }>()
  for (const check of checks) {
    const key = check.vehicleId ?? `${check.code}|${check.plate}`
    const group = groups.get(key) ?? {
      row: {
        vehicleId: check.vehicleId,
        code: check.code,
        plate: check.plate,
        worksiteId: check.worksiteId,
        worksiteName: check.worksiteName,
        percent: null,
        checks: 0,
        levels: [],
      },
      values: [],
      levels: new Set<string>(),
    }
    group.row.checks += 1
    if (check.percent != null) group.values.push(check.percent)
    if (check.level) group.levels.add(check.level)
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({
    ...group.row,
    percent: averagePercent(group.values),
    levels: [...group.levels],
  })).sort((a, b) => (a.code || a.plate).localeCompare(b.code || b.plate, "es", { numeric: true }))
}

export function summarizeCompliance(
  checks: readonly ComplianceCheck[],
  from: string,
  to: string,
): PreventiveCompliance {
  return {
    checks: [...checks],
    byMonth: monthBuckets(checks, from, to),
    byWorksiteMechanic: worksiteMechanicBuckets(checks),
    byPlate: plateRows(checks),
    average: averagePercent(checks.map((check) => check.percent)),
    total: checks.length,
  }
}

/** Filas de la matriz: la unión de los ítems, en el orden de la pauta más reciente. */
export function matrixRows(checks: readonly MatrixCheck[]): MatrixItem[] {
  const rows = new Map<string, MatrixItem>()
  const order: string[] = []
  for (const check of checks) {
    const names = Object.entries(check.itemOrder)
      .sort(([, a], [, b]) => a - b)
      .map(([name]) => name)
    for (const name of names) {
      const current = rows.get(name)
      if (current) {
        if (current.group == null && check.itemGroups[name]) current.group = check.itemGroups[name] ?? null
        continue
      }
      rows.set(name, { name, group: check.itemGroups[name] ?? null, sortOrder: check.itemOrder[name] ?? 0 })
      order.push(name)
    }
  }
  return order.map((name) => rows.get(name)!)
}

export function matrixCellText(value: MatrixCheck["items"][string] | undefined): string {
  if (value === "realizado") return "Realizado"
  if (value === "no_realizado") return "No realizado"
  if (value === "no_aplica") return "No aplica"
  return "No está en esta pauta"
}

export function matrixCellShort(value: MatrixCheck["items"][string] | undefined): string {
  if (value === "realizado") return "R"
  if (value === "no_realizado") return "NR"
  if (value === "no_aplica") return "NA"
  return "—"
}
