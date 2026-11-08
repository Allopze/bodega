/**
 * Correspondencias entre Talana y el catálogo de Chome. Nacieron en la carga de
 * la nómina de noviembre de 2026 (`scripts/apply-lista-empleados-2026-11.ts`,
 * que lee un export de Talana) y las comparte la sincronización diaria.
 */

/** Sin tildes, mayúsculas, sin puntuación, espacios simples. */
export function textKey(value: string | null | undefined): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9Ñ]+/g, " ").trim()
}

const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "da", "di", "y"])

export function titleCase(text: string): string {
  return text.trim().split(/\s+/).filter(Boolean).map((word, index) => {
    const lower = word.toLocaleLowerCase("es-CL")
    if (index > 0 && NAME_PARTICLES.has(lower)) return lower
    return lower.replace(/(^|[-'’])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toLocaleUpperCase("es-CL"))
  }).join(" ")
}

function words(value: string): string[] {
  return textKey(value).split(" ").filter(Boolean)
}

/**
 * Nombre y apellidos que deben quedar, o `null` si los de Chome ya sirven.
 *
 * La nómina manda en la ortografía, pero suele omitir el segundo nombre que
 * Chome sí tiene («Verónica» frente a «Verónica del Pilar»): si las palabras de
 * la nómina son el comienzo de las de Chome, se conserva Chome. Tildes,
 * mayúsculas y espacios no cuentan como diferencia.
 */
export function reconcileName(
  current: { firstName: string; lastName: string },
  sheet: { firstName: string; lastName: string },
): { firstName: string; lastName: string } | null {
  const currentFirst = words(current.firstName)
  const sheetFirst = words(sheet.firstName)
  const keepFirst = sheetFirst.length > 0 && sheetFirst.every((word, index) => currentFirst[index] === word)
  const keepLast = words(current.lastName).join(" ") === words(sheet.lastName).join(" ")
  if (keepFirst && keepLast) return null
  return {
    firstName: keepFirst ? current.firstName.trim() : titleCase(sheet.firstName),
    lastName: keepLast ? current.lastName.trim() : titleCase(sheet.lastName),
  }
}

/**
 * Centro de costo de Talana («Nombre Centro Costo 2» en el export) → faena de
 * Chome. Talana subdivide faenas que en Chome son una sola (Cholguán
 * máquinas/residuos, Masisa maderas/tableros/complejo deportivo); «Una sola
 * faena Masisa» ya lo decidió el usuario. Las llaves van por `textKey`.
 */
export const AREA_TO_WORKSITE = new Map<string, string>([
  ["CHOLGUAN MAQUINAS", "Cholguan - Arauco"],
  ["CHOLGUAN RESIDUOS", "Cholguan - Arauco"],
  ["SANTA FE GRUAS", "Santa Fe"],
  ["BIODIVERSA", "Biodiversa"],
  ["MASISA MADERAS", "Masisa"],
  ["MASISA TABLEROS", "Masisa"],
  ["COMPLEJO DEPORTIVO MASISA", "Masisa"],
  ["ADMINISTRACION", "Oficina Central"],
  ["TENO", "Teno - Arauco"],
  ["PACIFICO", "Pacifico"],
  ["HORCONES ASIR", "Horcones"],
  ["HORCONES", "Horcones"],
].map(([raw, name]) => [textKey(raw!), name!]))

/**
 * Cargo de Talana → nombre del cargo en el catálogo. «Chofer» y «Conductor» son
 * el mismo cargo (alias de «Conductor de camión» en el plan de vencimientos).
 * «Supervisor de faena» es un supervisor bajo el administrador de contrato de su
 * faena, no el administrador mismo.
 */
export const CARGO_MAP = new Map<string, string>([
  ["OPERADOR", "Operador de maquinaria"],
  ["CHOFER", "Conductor de camión"],
  ["CONDUCTOR", "Conductor de camión"],
  ["PREVENCIONISTA", "Prevencionista de riesgos"],
  ["EXPERTO EN PREVENCION DE RIESGOS", "Prevencionista de riesgos"],
  ["SOLDADOR", "Soldador"],
  ["ADMINISTRADOR DE CONTRATO", "Administrador de contrato"],
  ["SUPERVISOR", "Supervisor"],
  ["SUPERVISOR DE FAENA", "Supervisor"],
  ["AUXILIAR", "Auxiliar"],
  ["AUXILIAR ASEO", "Auxiliar"],
  ["MECANICO", "Mecánico"],
  ["AYUDANTE DE MECANICO", "Ayudante mecánico"],
  ["JEFE DE TERRENO", "Jefe de terreno"],
  ["JEFE DE MANTENCION", "Jefe de mantención"],
  ["GERENTE GENERAL", "Gerente general"],
  ["GERENTE DE ADMINISTRACION Y OPERACIONES", "Gerente de administración y operaciones"],
  ["GERENTE LEGAL Y DE PERSONAS", "Gerente legal y de personas"],
  ["SECRETARIA DE GERENCIA", "Secretaria de gerencia"],
  ["RIGGER", "Rigger"],
].map(([raw, name]) => [textKey(raw!), name!]))

/**
 * Razones sociales cuyos contratos cuentan como dotación de Chome. La cuenta de
 * Talana tiene además «Agrícola Flor del Laja», sin trabajadores de Chome.
 */
export const CHOME_EMPLOYER_KEYS = new Set([textKey("SERVICIOS INDUSTRIALES CHOME LTDA")])

export function isChomeEmployer(employerName: string | null | undefined): boolean {
  return CHOME_EMPLOYER_KEYS.has(textKey(employerName))
}

/** Sexo de Talana (`M`/`F`/`N`) → valor de `workers.sex`. `N` no dice nada. */
export function mapTalanaSex(value: string | null | undefined): "male" | "female" | null {
  const key = textKey(value)
  return key === "M" ? "male" : key === "F" ? "female" : null
}

/**
 * Tipo de ausencia de Talana (`tipoAusencia`, el código) → rótulo. Nunca hay
 * diagnóstico: Talana sólo da el tipo y las fechas.
 */
export const ABSENCE_LABELS: ReadonlyMap<string, string> = new Map([
  ["LICENCIA MEDICA", "Licencia médica"],
  ["LICENCIA MATERNAL", "Licencia maternal"],
  ["PERMISO CON GOCE", "Permiso con goce"],
  ["PERMISO SIN GOCE", "Permiso sin goce"],
  ["FALTA INJUSTIFICADA", "Ausencia no justificada"],
  ["ACCIDENTE", "Accidente del trabajo"],
])

export function absenceLabel(type: string | null | undefined): string {
  return ABSENCE_LABELS.get(textKey(type)) ?? (type ? titleCase(type) : "Ausencia")
}

/** Contrato a plazo según el texto de Talana («Plazo Fijo»). */
export function isFixedTermContract(contractType: string | null | undefined): boolean {
  return textKey(contractType).includes("PLAZO")
}
