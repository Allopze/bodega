import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { MONTH_LABELS } from "@/lib/utils"

/**
 * Aviso de cobertura de los gráficos de combustible e integraciones (Fase 4 de
 * `AUDITORIA_VISUALIZACIONES_CHOME.md`, CHART-022): el estado que `Fuentes de datos`
 * muestra en el mapa fuente × mes, dicho en una línea sobre cada gráfico que lo usa.
 *
 * Antes cada pantalla lo contaba a su manera (un `Callout` en Flota, un texto en el
 * detalle de un tile del tablero, una nota bajo el gráfico de rendimiento, un
 * subtítulo en Analítica), con redacciones distintas y a veces sin decir qué cifra
 * quedaba corta. Este módulo es la **única redacción**: la pantalla (`CoverageNotice`)
 * y la hoja «Metadatos» de las exportaciones (`fleetProviderGapNotice`) salen de aquí.
 *
 * Qué es un hueco lo decide `monthsWithoutProviderData` (`copec-coverage.ts`), la misma
 * vara con que el mapa de cobertura pinta «Sin datos»: un mes sin transacciones aceptadas
 * ni cobertura que lo cierre. Un hueco **no es un cero**: el proveedor no informó, que no
 * es lo mismo que «no se cargó combustible».
 */
export interface CoverageNoticeInput {
  /** Meses (`YYYY-MM`) sin datos del proveedor. */
  gapMonths: readonly string[]
  /**
   * Meses (`YYYY-MM`) con datos pero incompletos: el mes en curso, o uno todavía sin cerrar.
   * Un mes que ya está en `gapMonths` no se repite aquí.
   */
  partialMonths?: readonly string[]
  /**
   * Qué cifras quedan cortas, en plural y con la fuente a la vista («los totales de 12 meses»,
   * «las cifras de tarjeta Copec»). Es obligatorio a propósito: la frase tiene que ser cierta de
   * lo que la pantalla muestra, y sólo quien la dibuja sabe qué cifras dependen del proveedor.
   */
  subject: string
  /** De quién faltan los datos, con su preposición («del proveedor», «de la telemetría»). */
  source?: string
}

/** `2026-09` → `sep-2026`: el rótulo con que el resto de la plataforma nombra un mes en una frase. */
export function formatCoverageMonth(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
  const label = match ? MONTH_LABELS[Number(match[2]) - 1] : undefined
  return match && label ? `${label.toLowerCase()}-${match[1]}` : monthKey
}

/** `[2025-11, 2025-12, 2026-09]` → «nov-2025, dic-2025 y sep-2026». */
export function formatCoverageMonths(monthKeys: readonly string[]): string {
  const names = monthKeys.map(formatCoverageMonth)
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
}

/** Meses únicos y en orden cronológico: una frase no repite ni desordena. */
const unique = (months: readonly string[]) => [...new Set(months)].sort()

/**
 * Los meses de la frase, ya normalizados: el hueco manda sobre el parcial (un mes sin datos
 * no es «incompleto», es un hueco) y los dos salen ordenados y sin repetir.
 */
export function coverageMonthsOf(input: Pick<CoverageNoticeInput, "gapMonths" | "partialMonths">): { gaps: string[]; partial: string[] } {
  const gaps = unique(input.gapMonths)
  const partial = unique(input.partialMonths ?? []).filter((month) => !gaps.includes(month))
  return { gaps, partial }
}

/**
 * La frase del aviso, sin enlace; `null` si no falta nada (no hay aviso que dar).
 *
 * Una sola oración por estado, y cada una cierta de los dos bordes: con un solo mes habla en
 * singular, con varios en plural, y un mes parcial que ya es hueco no se dice dos veces.
 */
export function coverageNoticeText(input: CoverageNoticeInput): string | null {
  const { gaps, partial } = coverageMonthsOf(input)
  const sentences: string[] = []
  if (gaps.length > 0) {
    sentences.push(
      `Sin datos ${input.source ?? "del proveedor"} en ${formatCoverageMonths(gaps)}: ${input.subject} no incluyen ${gaps.length === 1 ? "ese mes" : "esos meses"}.`,
    )
  }
  if (partial.length > 0) {
    sentences.push(
      partial.length === 1
        ? `El mes de ${formatCoverageMonth(partial[0]!)} todavía no está completo.`
        : `Los meses de ${formatCoverageMonths(partial)} todavía no están completos.`,
    )
  }
  return sentences.length > 0 ? sentences.join(" ") : null
}

/** Permisos que abren «Fuentes de datos» (la guarda de `combustibles/fuentes/page.tsx`). */
const SOURCES_PERMISSIONS = ["combustibles:import", "combustibles:tae_import", "combustibles:sync_integrations"] as const

/**
 * El enlace del aviso a «Fuentes de datos», sólo para quien puede abrirlo: ofrecerlo a una
 * persona sin permiso la llevaría a `/forbidden`. Ocultar el enlace no es autorización —la
 * página se guarda sola—, sólo evita un camino roto.
 */
export function fuelSourcesHref(session: { user?: { permissions?: readonly string[] } | null } | null): string | undefined {
  const permissions = session?.user?.permissions ?? []
  return SOURCES_PERMISSIONS.some((permission) => permissions.includes(permission)) ? FUEL_PATHS.fuentes : undefined
}
