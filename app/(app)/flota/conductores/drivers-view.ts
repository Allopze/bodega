/**
 * Lo puro de la pantalla `/flota/conductores`: qué conductores entran en cada
 * vista, cómo se cuentan y cómo se escriben. Lo comparten la página (servidor),
 * el taller de trabajo (cliente) y la exportación a Excel: si cada uno contara
 * «los que requieren atención» a su modo, el número del botón no cuadraría con
 * las filas ni con el archivo.
 *
 * El estado de cada persona (`status`) lo decide `resolveDriverStatus`
 * (`lib/driver-license-status.ts`); acá sólo se agrupa.
 */

import { DRIVER_STATUS_RANK } from "@/lib/driver-license-status"
import type { DriverRosterRow } from "@/lib/services/driver-licenses-contract"
import {
  DRIVER_ATTENTION_STATUSES,
  DRIVER_LICENSE_CLASS_INFO,
  formatLicenseClassList,
  type DriverLicenseClass,
  type DriverStatus,
} from "@/lib/validation/driver-licenses"

/** Una sola representación del estado del trabajo (regla A5): tres vistas, ninguna se solapa. */
export const DRIVER_ESTADOS = ["atencion", "vigentes", "todos"] as const
export type DriverEstado = (typeof DRIVER_ESTADOS)[number]

export const DRIVER_ESTADO_LABEL: Record<DriverEstado, string> = {
  atencion: "Requieren atención",
  vigentes: "Vigentes",
  todos: "Todos",
}

/** Filtros con los que se pide la exportación: lo que se ve es lo que se descarga. */
export interface DriverExportFilters {
  estado: DriverEstado
  /** Id de la faena filtrada; null = todas las del alcance. */
  faena: string | null
}

export function parseDriverEstado(value: unknown): DriverEstado | null {
  return typeof value === "string" && (DRIVER_ESTADOS as readonly string[]).includes(value) ? (value as DriverEstado) : null
}

/**
 * «Requieren atención» y «Vigentes» parten el conjunto sin dejar a nadie fuera:
 * todo estado que no es `vigente` está en `DRIVER_ATTENTION_STATUSES`.
 */
export function statusMatchesEstado(status: DriverStatus, estado: DriverEstado): boolean {
  if (estado === "todos") return true
  if (estado === "vigentes") return status === "vigente"
  return DRIVER_ATTENTION_STATUSES.has(status)
}

export function filterDriversByEstado<T extends { status: DriverStatus }>(rows: readonly T[], estado: DriverEstado): T[] {
  return rows.filter((row) => statusMatchesEstado(row.status, estado))
}

export function countDriversByEstado(rows: readonly { status: DriverStatus }[]): Record<DriverEstado, number> {
  const counts: Record<DriverEstado, number> = { atencion: 0, vigentes: 0, todos: rows.length }
  for (const row of rows) {
    if (row.status === "vigente") counts.vigentes += 1
    else if (DRIVER_ATTENTION_STATUSES.has(row.status)) counts.atencion += 1
  }
  return counts
}

/** Abre en «Requieren atención» si hay algo; si no, en la lista completa. */
export function defaultDriverEstado(counts: Record<DriverEstado, number>): DriverEstado {
  return counts.atencion > 0 ? "atencion" : "todos"
}

const normalizeKey = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase()

/** «Sin clasificar» es el cargo de sistema de quien no tiene uno: para la persona, «Sin cargo». */
export function displayPosition(positionName: string | null | undefined): string {
  if (!positionName || normalizeKey(positionName) === "sin clasificar") return "Sin cargo"
  return positionName
}

/**
 * Texto que busca el buscador de la barra superior (`DataTable searchKeys`).
 * Lleva el nombre con y sin tildes y el RUT con y sin puntos: quien escribe
 * «perez» o «12345678» encuentra a «Pérez» y a «12.345.678-5».
 */
export function driverSearchText(row: Pick<DriverRosterRow, "name" | "rut" | "positionName" | "worksiteName">): string {
  const base = [row.name, row.rut, displayPosition(row.positionName), row.worksiteName].filter(Boolean).join(" ")
  const withoutAccents = base.normalize("NFD").replace(/\p{Diacritic}/gu, "")
  const rutDigits = row.rut ? row.rut.replace(/[^0-9kK]/g, "") : ""
  return `${base} ${withoutAccents} ${rutDigits}`.toLowerCase()
}

/**
 * Valor para ordenar por «Vigencia»: primero el estado (vencida → vigente) y,
 * dentro de cada uno, la fecha más cercana: lo vencido hace más tiempo antes.
 */
export function driverUrgency(row: Pick<DriverRosterRow, "status" | "expiry">): number {
  return DRIVER_STATUS_RANK[row.status] * 1_000_000 + 500_000 + (row.expiry?.days ?? 0)
}

/** «A2, A4, B» (etiquetas cortas, sin «y») para celdas y para el Excel. */
export function classesLabel(classes: readonly DriverLicenseClass[]): string {
  return classes.map((code) => DRIVER_LICENSE_CLASS_INFO[code].short).join(", ")
}

/** «su cargo exige A4 o A5». Sin clase fija, que el cargo conduzca ya exige una licencia. */
export function requirementText(requiredClasses: readonly DriverLicenseClass[]): string {
  return requiredClasses.length > 0
    ? `su cargo exige ${formatLicenseClassList(requiredClasses)}`
    : "su cargo exige licencia de conducir"
}

/**
 * La frase de los dos estados que no se miden en días: sin licencia y clase
 * insuficiente. Para los demás la dice `ExpiryStatus`.
 */
export function driverStatusDetail(row: Pick<DriverRosterRow, "status" | "requiredClasses" | "license">): string | null {
  if (row.status === "sin_licencia") return requirementText(row.requiredClasses)
  if (row.status === "clase_insuficiente") {
    const held = row.license ? formatLicenseClassList(row.license.classes, "y") : ""
    return `Tiene ${held} · ${requirementText(row.requiredClasses)}`
  }
  return null
}

/** Lo que exige el cargo, para la columna «Clases exigidas» del Excel. */
export function requiredClassesLabel(row: Pick<DriverRosterRow, "requiresLicense" | "requiredClasses">): string {
  if (!row.requiresLicense) return "No exige"
  return row.requiredClasses.length > 0 ? formatLicenseClassList(row.requiredClasses) : "Cualquiera"
}
