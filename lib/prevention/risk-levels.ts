/**
 * Vocabulario único del nivel de riesgo MIPER (inherente y residual).
 *
 * Antes había tres: el schema de escritura aceptaba texto libre
 * (`z.string().min(1)`), la UI leía un enum inglés de 5 claves
 * (`low|moderate|medium|high|critical`) y los importadores/seeds escribían
 * español ("Alto", "critico", "Medio"). Resultado: el mapa de riesgos y el
 * detalle de control pintaban gris cualquier valor que no fuera inglés, o sea
 * casi todos los reales.
 *
 * La fuente de verdad es esta lista de 4 niveles, la misma escala del ISP y la
 * que ya usaba el registro IPER anterior ('bajo','medio','alto','critico'):
 * `moderate` desaparece porque era otro nombre para `medium` — dos claves para
 * un nivel es el problema en miniatura. Todas las capas importan de acá:
 * validación (`riskLevelSchema`), UI (etiqueta y color) y la restricción de
 * base (`prevention_risk_entries_*_level_valid`).
 */

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const

export type RiskLevel = typeof RISK_LEVELS[number]

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  critical: "Crítico",
}

export const RISK_LEVEL_COLOR: Record<RiskLevel, string> = {
  low: "var(--color-success)",
  medium: "var(--color-warning)",
  high: "var(--color-danger)",
  critical: "var(--color-danger)",
}

/** Sinónimos aceptados al entrar (Excel histórico, seeds, el enum inglés viejo). */
const ALIASES: Record<string, RiskLevel> = {
  low: "low", bajo: "low", baja: "low", leve: "low", menor: "low", insignificante: "low", trivial: "low", aceptable: "low",
  medium: "medium", medio: "medium", media: "medium", moderate: "medium", moderado: "medium", moderada: "medium", tolerable: "medium",
  high: "high", alto: "high", alta: "high", importante: "high", severo: "high", grave: "high",
  critical: "critical", critico: "critical", critica: "critical", "muy alto": "critical", "muy alta": "critical", extremo: "critical", intolerable: "critical", inaceptable: "critical",
}

/** Devuelve el nivel canónico, o `null` si el texto no corresponde a ninguno. */
export function normalizeRiskLevel(value: unknown): RiskLevel | null {
  const key = String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase().replace(/\s+/g, " ")
  return ALIASES[key] ?? null
}

export function riskLevelLabel(value: string) {
  const level = normalizeRiskLevel(value)
  return level ? RISK_LEVEL_LABEL[level] : value
}

export function riskLevelColor(value: string) {
  const level = normalizeRiskLevel(value)
  return level ? RISK_LEVEL_COLOR[level] : "var(--color-text-subtle)"
}
