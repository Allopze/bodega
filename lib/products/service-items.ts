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

/** Atributo declarado por el catálogo para un producto. */
export interface DeclaredAttribute {
  id:         string | null
  name:       string
  type:       string
  isRequired: boolean
}

/** Reglas que el catálogo impone al ítem que referencia este producto. */
export interface CatalogProductRules {
  name:           string
  requiresWorker: boolean
  attributes:     DeclaredAttribute[]
}

/** Lo que el ítem trae desde el formulario. */
export interface SubmittedItemValues {
  workerId?:  string | null
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
