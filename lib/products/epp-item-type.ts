/**
 * Vocabulario de tipos de ítem EPP («botin», «chaleco», «guante») y la familia
 * de tallas por la que se sizea cada uno.
 *
 * Sin dependencias a propósito: lo usan el importador XLSX, el asistente de
 * productos (componente de cliente) para sugerir la escala de tallas, y los
 * backfills de tallas. Vivía en `epp-import.types.ts`, que importa exceljs, y
 * eso metía exceljs en el bundle de cliente y rompía el bundle ESM del backfill.
 */
export const EPP_TYPES = [
  "casco", "guante", "lente", "antiparra", "botin", "zapato", "chaleco",
  "mascarilla", "respirador", "arnes", "protector auditivo", "buzo", "traje",
  "pantalon", "chaqueta",
  // Vocabulario que el catálogo real usa y este listado no cubría. Sin estos,
  // `normalizeEppRow` marcaba la fila con el issue bloqueante "No se pudo
  // identificar un tipo de EPP en el nombre" y la familia quedaba sin
  // clasificar, así que ninguna entrega suya acreditaba cobertura.
  "fono", "bota", "camisa", "polera", "blusa", "overol", "jardinera",
  "primera capa", "capa", "coleto", "gorro", "casquete", "barbiquejo",
  "visor", "mascara", "filtro",
  "otros",
] as const

/**
 * Familia de talla (`lib/products/size-catalog.ts`) que corresponde al
 * vocabulario de ítem de este importador. Gemelo de
 * `EPP_TYPE_TO_BODY_PART_CODE`: uno traduce a la zona corporal con que
 * Prevención acredita, éste al eje por el que el ítem se sizea.
 *
 * Un tipo sin escala de talla —lentes, mascarillas, arnés, filtros— no entra
 * al mapa: su talla, si la trae la planilla, queda como el atributo genérico
 * `Talla` sin familia. Devolver `null` antes que adivinar es el mismo criterio
 * de `classifyEppTypeIdByName`.
 *
 * El pantalón va a `pantalon`, que desde la compilación de compras 2022-2026
 * usa la escala de letras igual que `ropa`: lo que distingue a las dos familias
 * es con qué campo del padrón cruzan (`size_bottom` contra `size_top`), no la
 * escala. Un trabajador puede ser L arriba y XL abajo.
 *
 * Jardinera, overol, buzo, traje y capa se quedan en `ropa`: la talla del
 * conjunto es la de arriba. Un traje se sizea como conjunto aunque venga en
 * dos piezas —«Traje PU Verde Activex Pantalón» es el pantalón de un traje PU,
 * y su talla es la del traje, no una talla de pantalón—, así que `inferEppItemType`
 * clasificándolo como `traje` es lo correcto y no un caso a corregir.
 */
export const EPP_TYPE_TO_SIZE_FAMILY: Partial<Record<(typeof EPP_TYPES)[number], string>> = {
  guante: "guantes",
  botin: "calzado",
  zapato: "calzado",
  bota: "calzado",
  casco: "casco",
  casquete: "casco",
  gorro: "casco",
  chaleco: "ropa",
  buzo: "ropa",
  traje: "ropa",
  pantalon: "pantalon",
  chaqueta: "ropa",
  camisa: "ropa",
  polera: "ropa",
  blusa: "ropa",
  overol: "ropa",
  jardinera: "ropa",
  "primera capa": "ropa",
  capa: "ropa",
  coleto: "ropa",
}

/** Familia de talla de un tipo de ítem, o `null` si ese ítem no se sizea. */
export function sizeFamilyForEppType(eppType: string | null): string | null {
  if (!eppType) return null
  return (EPP_TYPE_TO_SIZE_FAMILY as Record<string, string | undefined>)[eppType] ?? null
}

/**
 * Accesorios cuyo nombre menciona el EPP al que se montan: "Fono ... p/casco"
 * es protección auditiva, no de cabeza. La mención se descarta antes de buscar
 * el tipo para que gane el ítem propio del producto y no la pieza citada.
 */
const MOUNTED_ON_MENTION = /(?:\bp\/\s*|\bpara\s+|\bporta\s+)(?:casco|visor|respirador|mascarilla|arnes)\b/gi

/**
 * Tipo de ítem que el nombre del producto declara, o `null` si no declara
 * ninguno — preferible a adivinar: `EPP_TYPE_TO_BODY_PART_CODE` traduce esto a
 * la zona corporal con que Prevención acredita al trabajador.
 */
export function inferEppItemType(name: string): (typeof EPP_TYPES)[number] | null {
  const searchable = cleanText(name).replace(MOUNTED_ON_MENTION, " ")
  return EPP_TYPES.find((type) => {
    const normalizedType = cleanText(type)
    // `s?` porque el catálogo nombra varios ítems en plural ("Guantes de cabritilla").
    return normalizedType && new RegExp(`\\b${escapeRegex(normalizedType)}s?\\b`, "i").test(searchable)
  }) ?? null
}

function cleanText(value: string | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim()
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
