/**
 * Sexo registral de una persona: el del padrón (`workers.sex`) y el que queda
 * fijado en cada persona de un incidente (`prevention_incident_people.sex`).
 *
 * Las dos columnas aceptan exactamente estos valores —lo imponen sus
 * restricciones `check`— porque el incidente copia el del padrón al vincular a
 * un trabajador. Un valor distinto en cada lado haría que esa copia fallara o
 * inventara una equivalencia.
 *
 * `null` es que nadie lo registró. Hasta la migración 0349 existían además
 * `intersex` (pasó a `other`) y `unspecified` —«No informa»—, que pasó a
 * `null`: llevarlo a `other` habría afirmado un sexo que la persona no declaró.
 */
export const PERSON_SEX_VALUES = ["male", "female", "other"] as const

export type PersonSex = (typeof PERSON_SEX_VALUES)[number]

export const PERSON_SEX_LABELS: Record<PersonSex, string> = {
  male: "Hombre",
  female: "Mujer",
  other: "Otro",
}

export function isPersonSex(value: unknown): value is PersonSex {
  return typeof value === "string" && (PERSON_SEX_VALUES as readonly string[]).includes(value)
}

/**
 * Un valor fuera del catálogo se muestra tal cual, igual que `labelOf` del
 * inventario ARCO: un dato raro visible es preferible a uno silenciado.
 */
export function personSexLabel(value: string | null | undefined): string {
  if (!value) return "Sin registrar"
  return isPersonSex(value) ? PERSON_SEX_LABELS[value] : value
}
