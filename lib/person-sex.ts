/**
 * Sexo registral de una persona: el del padrón (`workers.sex`) y el que queda
 * fijado en cada persona de un incidente (`prevention_incident_people.sex`).
 *
 * Las dos columnas aceptan exactamente estos valores —lo imponen sus
 * restricciones `check`— porque el incidente copia el del padrón al vincular a
 * un trabajador. Un valor distinto en cada lado haría que esa copia fallara o
 * inventara una equivalencia.
 *
 * `null` y `unspecified` no son lo mismo: `null` es que nadie lo registró;
 * `unspecified` es que se preguntó y la persona no lo informa.
 */
export const PERSON_SEX_VALUES = ["female", "male", "intersex", "unspecified"] as const

export type PersonSex = (typeof PERSON_SEX_VALUES)[number]

export const PERSON_SEX_LABELS: Record<PersonSex, string> = {
  female: "Mujer",
  male: "Hombre",
  intersex: "Intersexual",
  unspecified: "No informa",
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
