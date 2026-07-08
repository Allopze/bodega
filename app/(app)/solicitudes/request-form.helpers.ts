import type { ItemRow, AttrRow, ProductOption } from "./request-form.types"
import { REPUESTO_ATTRIBUTE_NAMES } from "@/lib/validation/repuestos"
import { SERVICE_ATTRIBUTE_NAMES } from "@/lib/validation/servicios"

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
    isEpp: false, productName: "", showAttrs: false, cotizaciones: [],
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
  return prod.attributes.map((a) => ({
    attributeId: a.id, attributeName: a.name, value: "", isRequired: a.isRequired,
    type: a.type, options: parseAttributeOptions(a.options),
  }))
}

export function requestStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Borrador", submitted: "Enviada", approved: "Aprobada",
    partially_approved: "Aprobada parcial", rejected: "Rechazada",
    in_purchase: "En OC", closed: "Cerrada", cancelled: "Cancelada", returned: "Devuelta",
  }
  return labels[status] ?? status
}

export function buildRequestSummaryIssues({
  worksiteId, requiredDate, items,
}: {
  worksiteId: string; requiredDate: string; items: ItemRow[]
}): string[] {
  const issues: string[] = []
  if (!worksiteId) issues.push("Selecciona una faena.")
  if (!requiredDate) issues.push("Indica la fecha requerida.")
  items.forEach((item, index) => {
    const label = `Ítem ${index + 1}`
    if (!item.productId && !item.productNameFree.trim()) issues.push(`${label}: selecciona o describe un producto.`)
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) issues.push(`${label}: ingresa una cantidad válida.`)
    const missingAttrs = item.attributes.filter((attr) => attr.isRequired && !attr.value.trim())
    if (missingAttrs.length > 0) issues.push(`${label}: completa ${missingAttrs.map((attr) => attr.attributeName).join(", ")}.`)
  })
  return issues
}
