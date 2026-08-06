import type { ChecklistDefinition, ChecklistSection, ChecklistItem, FieldKind, StatusValue } from './types'

/**
 * Kinds que producen un valor de estado (cumple/no_cumple/na/entregado/etc.).
 * Los kinds text, textarea, date, select, multiselect, signature y readonly no
 * contribuyen al cálculo de cumplimiento — no generan un StatusValue comparable.
 */
const STATUS_KINDS: FieldKind[] = [
  'cumple_nocumple_obs',
  'cumple_nocumple_na_obs',
  'entregado_obs',
  'apto_obs',
  'si_no_obs',
  'bueno_regular_malo_obs',
  'bueno_regular_malo_na_obs',
  'bueno_regular_malo_na_nt_obs'
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

type ChecklistResponseStatus = {
  seccionId: string
  itemId: string
  estado: StatusValue
}

export function getApplicableResponses(
  definition: ChecklistDefinition,
  cargoKeys: string | string[],
  respuestas: ChecklistResponseStatus[]
): ChecklistResponseStatus[] {
  const applicableSet = new Set(
    getApplicableItems(definition, cargoKeys).map(({ seccionId, item }) => `${seccionId}::${item.id}`)
  )

  return respuestas.filter((r) => applicableSet.has(`${r.seccionId}::${r.itemId}`))
}

export function getApplicableResponseStatuses(
  definition: ChecklistDefinition,
  cargoKeys: string | string[],
  respuestas: ChecklistResponseStatus[]
): Array<{ estado: StatusValue }> {
  return getApplicableResponses(definition, cargoKeys, respuestas).map((r) => ({
    estado: r.estado,
  }))
}

export type SectionAccess = { canView: boolean; canEdit: boolean }

/**
 * Qué secciones cuentan para el cierre/cumplimiento de UNA evaluación según el
 * rol de quien la ejecuta (no de quien la mira): las de Punto 3
 * (`requiresPermission`) solo aplican a evaluaciones de conductor_lider, y para
 * ese rol solo aplican esas. Es el mismo criterio de
 * `getEvaluationApplicableItems` en el servidor; compartirlo evita que el
 * cliente bloquee el cierre exigiendo ítems que el servidor no cuenta.
 */
export function sectionAppliesToEvaluatorRole(
  section: Pick<ChecklistSection, "requiresPermission">,
  evaluatorRole: string | null | undefined,
): boolean {
  if (evaluatorRole === "conductor_lider") return section.requiresPermission === "sst:evaluate_acompanamiento"
  return !section.requiresPermission
}

/**
 * Calcula el acceso por sección de un usuario sobre un checklist.
 *
 * - Secciones con `requiresPermission`: solo visibles/editables si el usuario
 *   tiene ese permiso (independiente de sst:view/sst:create).
 * - Secciones normales: visibles si `canViewFull` (sst:view) y editables si
 *   `canCreate` (sst:create).
 *
 * Resultado serializable, apto para pasar a un Client Component.
 */
export function getSectionAccess(
  definition: ChecklistDefinition,
  permissions: string[],
  opts: { canCreate: boolean; canViewFull: boolean },
): Record<string, SectionAccess> {
  const map: Record<string, SectionAccess> = {}
  for (const sec of definition.sections) {
    if (sec.requiresPermission) {
      const has = permissions.includes(sec.requiresPermission)
      map[sec.id] = { canView: has, canEdit: has }
    } else {
      map[sec.id] = { canView: opts.canViewFull, canEdit: opts.canCreate }
    }
  }
  return map
}

/**
 * Conjunto de seccionId que el usuario puede escribir. Usado para reforzar en el
 * servidor que un rol acotado (p.ej. conductor_lider) solo persista su sección.
 */
export function writableSectionIds(
  definition: ChecklistDefinition,
  permissions: string[],
  canCreate: boolean,
): Set<string> {
  const access = getSectionAccess(definition, permissions, { canCreate, canViewFull: canCreate })
  return new Set(
    Object.entries(access)
      .filter(([, a]) => a.canEdit)
      .map(([id]) => id),
  )
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
