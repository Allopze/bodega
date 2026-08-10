import type { ItemRow, AttrRow, ProductOption } from "./request-form.types"
import { REPUESTO_ATTRIBUTE_NAMES } from "@/lib/validation/repuestos"
import { SERVICE_ATTRIBUTE_NAMES } from "@/lib/validation/servicios"
import { REQUEST_STATE_META } from "@/components/states/state-badge"
import { QUOTATION_TYPES } from "@/lib/request-types"
import { catalogItemIssues } from "@/lib/products/service-items"

export function equipmentFromAttributes(
  requestType: string,
  attributes: { attributeName: string; value: string }[],
): { partNumber: string; location: string; equipmentName: string; patent: string; brand: string; model: string } {
  const m = Object.fromEntries(attributes.map((a) => [a.attributeName, a.value]))
  const R = REPUESTO_ATTRIBUTE_NAMES
  const S = SERVICE_ATTRIBUTE_NAMES
  return {
    partNumber:    requestType === "repuestos" ? (m[R.partNumber] ?? "") : "",
    location:      requestType === "servicios" ? (m[S.location] ?? "") : "",
    equipmentName: m[R.equipmentName] ?? m[S.equipmentName] ?? "",
    patent:        m[R.patent] ?? m[S.patent] ?? "",
    brand:         m[R.brand] ?? m[S.brand] ?? "",
    model:         m[R.model] ?? m[S.model] ?? "",
  }
}

export function blankItem(key = "new-0"): ItemRow {
  return {
    _key: key, productId: null, productNameFree: "", quantity: "1", unitOfMeasure: "unidad",
    urgency: "normal", suggestedSupplierId: "", supplierHint: "", notes: "", attributes: [],
    variantQuantities: {}, workerId: "", workerName: "", isEpp: false, productName: "", showAttrs: false, cotizaciones: [],
    partNumber: "", location: "", equipmentName: "", patent: "", brand: "", model: "",
  }
}

export function blankItemForType(key: string, requestType: string): ItemRow {
  return requestType === "servicios" ? { ...blankItem(key), unitOfMeasure: "servicio" } : blankItem(key)
}

export function parseAttributeOptions(options: string | null | undefined): string[] {
  if (!options) return []
  try {
    const parsed = JSON.parse(options)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean)
    }
  } catch {
    // Legacy product attributes stored comma/newline text before normalization.
  }
  return options.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

export function buildAttrsFromProduct(prod: ProductOption): AttrRow[] {
  return prod.attributes.map((a) => {
    const options = parseAttributeOptions(a.options)
    return {
      attributeId: a.id,
      attributeName: a.name,
      value: options.length === 1 ? (options[0] ?? "") : "",
      isRequired: a.isRequired,
      type: a.type,
      options,
    }
  })
}

// Lee del vocabulario canónico de StateBadge — evita un cuarto diccionario de
// estados divergente del badge y de lib/work-queue-labels.ts.
export function requestStatusLabel(status: string): string {
  return REQUEST_STATE_META[status as keyof typeof REQUEST_STATE_META]?.label ?? status
}

export function buildRequestSummaryIssues({
  worksiteId, requiredDate, items, requestType, notes, products = [],
}: {
  worksiteId: string; requiredDate: string; items: ItemRow[]
  /** Repuestos/servicios exigen ≥3 cotizaciones o justificación (LOG-9/UX-2). */
  requestType?: string; notes?: string
  /** Catálogo, para evaluar las reglas del producto elegido (colaborador, dosis). */
  products?: ProductOption[]
}): string[] {
  const issues: string[] = []
  if (!worksiteId) issues.push("Selecciona una faena.")
  if (!requiredDate) issues.push("Indica la fecha requerida.")
  items.forEach((item, index) => {
    const label = `Ítem ${index + 1}`
    if (!item.productId && !item.productNameFree.trim()) issues.push(`${label}: selecciona o describe un producto.`)
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) issues.push(`${label}: ingresa una cantidad válida.`)
    // Mismas reglas que reevalúa el servidor al crear (colaborador obligatorio,
    // atributos requeridos y tipados). Aquí sólo para avisar antes de enviar.
    const product = item.productId ? products.find((p) => p.id === item.productId) : undefined
    if (product) {
      const catalogIssues = catalogItemIssues(
        {
          name: product.name,
          requiresWorker: product.requiresWorker,
          attributes: product.attributes.map((a) => ({
            id: a.id, name: a.name, type: a.type, isRequired: a.isRequired,
          })),
        },
        item,
      )
      for (const issue of catalogIssues) issues.push(`${label}: ${issue}.`)
    } else {
      const missingAttrs = item.attributes.filter((attr) => attr.isRequired && !attr.value.trim())
      if (missingAttrs.length > 0) issues.push(`${label}: completa ${missingAttrs.map((attr) => attr.attributeName).join(", ")}.`)
    }
  })
  if (requestType && QUOTATION_TYPES.has(requestType)) {
    const totalCotizaciones = items.reduce((sum, item) => sum + (item.cotizaciones?.length ?? 0), 0)
    if (totalCotizaciones < 3 && !notes?.trim()) {
      issues.push("Adjunta 3 cotizaciones o justifica en Notas generales por qué no es posible.")
    }
  }
  return issues
}
