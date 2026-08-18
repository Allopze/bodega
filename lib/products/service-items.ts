/**
 * Ítems de servicio del catálogo (mantención de monogás, calibración de
 * alcotest, vacunas) y las reglas que un ítem de solicitud debe cumplir según
 * el producto que eligió.
 *
 * El modelo es de datos, no de código: un servicio es un producto con
 * `is_service`, exige colaborador con `requires_worker` y pide sus campos
 * extra como `product_attributes`. Agregar "examen ocupacional" mañana es una
 * fila más, no un `if` nuevo — por eso no hay ninguna referencia a "vacuna" en
 * este archivo.
 *
 * Las mismas funciones las usan el formulario (aviso inmediato) y el servicio
 * de creación (fuente de verdad), para que ambos rechacen exactamente lo mismo.
 */

/** Un servicio se solicita sin precio; su costo se conoce al facturarlo. */
export const COST_PENDING_LABEL = "Costo pendiente"

/**
 * Familias de equipos que el catálogo ya usa, con su etiqueta legible. Viven
 * acá y no en la pantalla de Administración porque el alta automática (que
 * corre en el servidor) nombra las fichas nuevas con ellas.
 */
export const EQUIPMENT_KIND_LABELS: Record<string, string> = {
  monogas:  "Monogás",
  alcotest: "Alcotest",
}

export function equipmentKindLabel(kind: string): string {
  return EQUIPMENT_KIND_LABELS[kind] ?? kind
}

/**
 * Forma canónica del código interno de un equipo: sin espacios sobrantes y en
 * mayúsculas. El catálogo de instrumentos se va formando con lo que escribe
 * quien solicita la mantención, así que "mg-014", " MG-014 " y "mg 014" tienen
 * que caer en la misma ficha o el registro se bifurca solo.
 *
 * No valida el formato a propósito: los códigos son numéricos largos en unos
 * equipos y alfanuméricos en otros.
 */
export function normalizeEquipmentCode(code: string): string {
  return code.trim().replace(/\s+/g, " ").toLocaleUpperCase("es-CL")
}

/** Atributo declarado por el catálogo para un producto. */
export interface DeclaredAttribute {
  id:         string | null
  name:       string
  type:       string
  isRequired: boolean
  /** Su valor **es** la cantidad del ítem (nº de dosis, de sesiones). */
  drivesQuantity?: boolean
}

/** Reglas que el catálogo impone al ítem que referencia este producto. */
export interface CatalogProductRules {
  name:           string
  requiresWorker: boolean
  /** Familia de equipos que atiende ('monogas', 'alcotest'); null = no aplica. */
  equipmentKind?: string | null
  attributes:     DeclaredAttribute[]
}

/** Lo que el ítem trae desde el formulario. */
export interface SubmittedItemValues {
  workerId?:      string | null
  /** Código interno del equipo, tal como lo escribió quien solicita. */
  equipmentCode?: string | null
  attributes: readonly { attributeId?: string | null; attributeName: string; value: string }[]
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("es-CL")
}

/**
 * Valida el valor de un atributo contra el tipo declarado en el catálogo.
 * Devuelve el mensaje de error o `null` si es válido.
 *
 * `integer` es un conteo: entero, sin decimales, sin signo y mínimo 1. Es el
 * tipo del "Número de dosis" y de cualquier conteo que venga después.
 */
export function attributeValueIssue(
  attribute: Pick<DeclaredAttribute, "name" | "type" | "isRequired">,
  rawValue: string | null | undefined,
): string | null {
  const value = (rawValue ?? "").trim()
  if (value === "") {
    return attribute.isRequired ? `completa ${attribute.name}` : null
  }
  if (attribute.type === "integer") {
    if (!/^\d+$/.test(value) || Number(value) < 1) {
      return `${attribute.name} debe ser un número entero mayor o igual a 1`
    }
  }
  if (attribute.type === "number") {
    if (!Number.isFinite(Number(value))) return `${attribute.name} debe ser un número válido`
  }
  return null
}

/**
 * Todos los problemas del ítem frente a las reglas de su producto de catálogo.
 * Sin prefijo de "Ítem N": lo pone quien numera la lista.
 */
export function catalogItemIssues(
  product: CatalogProductRules,
  item: SubmittedItemValues,
): string[] {
  const issues: string[] = []

  if (product.requiresWorker && !item.workerId?.trim()) {
    issues.push(`selecciona el colaborador para ${product.name}`)
  }

  // El equipo se identifica por su código y no por una fila del registro: el
  // catálogo de instrumentos se forma con estas solicitudes, así que exigir que
  // el equipo ya estuviera dado de alta dejaba el servicio imposible de pedir.
  if (product.equipmentKind && !item.equipmentCode?.trim()) {
    issues.push(`indica el código del equipo para ${product.name}`)
  }

  const byId = new Map(
    item.attributes.flatMap((a) => (a.attributeId ? [[a.attributeId, a.value] as const] : [])),
  )
  const byName = new Map(item.attributes.map((a) => [normalizeName(a.attributeName), a.value] as const))

  for (const declared of product.attributes) {
    const value = (declared.id ? byId.get(declared.id) : undefined) ?? byName.get(normalizeName(declared.name))
    const issue = attributeValueIssue(declared, value)
    if (issue) issues.push(issue)
  }

  return issues
}

/**
 * Cantidad que impone el catálogo, si algún atributo la gobierna
 * (`drivesQuantity`). `null` = el producto no manda y vale la que escribió
 * quien solicita.
 *
 * Es una derivación, no una validación: el servidor recalcula la cantidad con
 * esto en vez de comparar dos números que el cliente pudo mandar distintos.
 */
export function quantityFromAttributes(
  product: Pick<CatalogProductRules, "attributes">,
  item: SubmittedItemValues,
): number | null {
  const driver = product.attributes.find((attribute) => attribute.drivesQuantity)
  if (!driver) return null

  const byId = new Map(
    item.attributes.flatMap((a) => (a.attributeId ? [[a.attributeId, a.value] as const] : [])),
  )
  const byName = new Map(item.attributes.map((a) => [normalizeName(a.attributeName), a.value] as const))
  const raw = ((driver.id ? byId.get(driver.id) : undefined) ?? byName.get(normalizeName(driver.name)) ?? "").trim()

  if (!/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return parsed >= 1 ? parsed : null
}
