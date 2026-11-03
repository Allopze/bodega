import type { FuelInboxCaseRule } from "./types"

/**
 * Pendientes por regla (CHART-023a): lo que la bandeja dice de la lista de reglas.
 * Módulo puro, para la página y la prueba.
 */

/** El nombre de la regla; si ya no tiene ficha, su código (es lo que dice también la fila de la bandeja). */
export function caseRuleLabel(rule: FuelInboxCaseRule): string {
  return rule.ruleName ?? rule.ruleCode
}

/** La respuesta de la lista: qué regla reúne más casos pendientes. `null` sin casos. */
export function summarizeCaseRules(rules: readonly FuelInboxCaseRule[]): string | null {
  const total = rules.reduce((sum, rule) => sum + rule.count, 0)
  if (total === 0) return null
  const top = rules.reduce((best, rule) => (rule.count > best.count ? rule : best))
  const name = `«${caseRuleLabel(top)}»`
  if (top.count === total) return total === 1 ? `El único caso pendiente es de ${name}.` : `Los ${total} casos pendientes son todos de ${name}.`
  return `${name} reúne ${top.count} de los ${total} casos pendientes.`
}

const RULE_CODE = /^[a-z0-9_]{1,80}$/

/** `?regla=`: un código de regla (minúsculas, dígitos y guion bajo). Cualquier otra cosa se ignora, como un filtro ausente. */
export function parseCaseRuleParam(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && RULE_CODE.test(trimmed) ? trimmed : undefined
}
