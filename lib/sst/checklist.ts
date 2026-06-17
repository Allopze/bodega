import type { ChecklistDefinition, ChecklistSection, ChecklistItem, FieldKind } from './types'

/**
 * Kinds que producen un valor de estado (cumple/no_cumple/na/entregado/etc.).
 * Los kinds text, date, select, multiselect, signature y readonly no contribuyen
 * al cálculo de cumplimiento — no generan un StatusValue comparable.
 */
const STATUS_KINDS: FieldKind[] = [
  'cumple_nocumple_obs',
  'cumple_nocumple_na_obs',
  'entregado_obs',
  'apto_obs',
  'si_no_obs'
]

export function isStatusKind(kind: FieldKind): boolean {
  return STATUS_KINDS.includes(kind)
}

/**
 * Devuelve la lista de {seccionId, item} que cuentan para el % de cumplimiento,
 * dado un cargo (o lista de cargos) del trabajador.
 *
 * Criterios de inclusión:
 * 1. La sección tiene countsForCompliance === true (undefined se trata como true).
 * 2. La sección aplica al cargo: o no tiene appliesWhen, o al menos uno de los
 *    cargoKeys está en appliesWhen.
 * 3. El ítem tiene un kind que produce un StatusValue (STATUS_KINDS).
 */
export function getApplicableItems(
  definition: ChecklistDefinition,
  cargoKeys: string | string[]
): Array<{ seccionId: string; item: ChecklistItem }> {
  const keys = Array.isArray(cargoKeys) ? cargoKeys : [cargoKeys]

  return definition.sections.flatMap((sec: ChecklistSection) => {
    // 1. La sección debe contar para cumplimiento
    if ((sec.countsForCompliance ?? true) === false) return []

    // 2. La sección debe aplicar al cargo del trabajador
    if (sec.appliesWhen && sec.appliesWhen.length > 0) {
      const applies = keys.some((k) => sec.appliesWhen!.includes(k))
      if (!applies) return []
    }

    // 3. Solo ítems con kind de estado
    return sec.items
      .filter((item: ChecklistItem) => isStatusKind(item.kind))
      .map((item: ChecklistItem) => ({ seccionId: sec.id, item }))
  })
}

/**
 * Verifica si todos los ítems aplicables tienen una respuesta no nula.
 * Retorna la lista de ítems sin responder (vacía si está completo).
 */
export function getUnansweredApplicableItems(
  definition: ChecklistDefinition,
  cargoKeys: string | string[],
  respuestas: Array<{ seccionId: string; itemId: string; estado: string | null }>
): Array<{ seccionId: string; item: ChecklistItem }> {
  const applicable = getApplicableItems(definition, cargoKeys)
  return applicable.filter(({ seccionId, item }) => {
    const resp = respuestas.find(
      (r) => r.seccionId === seccionId && r.itemId === item.id
    )
    return !resp || resp.estado === null
  })
}
