import type { ItemRow, AttrRow, ProductOption, VehicleOption } from "./request-form.types"
import { REPUESTO_ATTRIBUTE_NAMES } from "@/lib/validation/repuestos"
import { SERVICE_ATTRIBUTE_NAMES } from "@/lib/validation/servicios"
import { REQUEST_STATE_META } from "@/components/states/state-badge"
import { QUOTATION_TYPES } from "@/lib/request-types"
import { catalogItemIssues } from "@/lib/products/service-items"
import {
  estimatedRequestTotal,
  evaluateQuotationRequirement,
  fastPathCoversRequest,
  quotationRequirementMessage,
} from "@/lib/requests/quotation-requirement"
import { formatCLP } from "@/lib/utils"

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
    variantQuantities: {}, workerId: "", workerName: "", equipmentCode: "", equipmentLabel: "",
    emergencyResourceId: "", emergencyResourceLabel: "",
    vehicleId: "", vehicleLabel: "", workOrderId: "", workOrderFolio: "", estimatedUnitPrice: "",
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

/**
 * Vuelca sobre los atributos del producto los valores que traía la copia.
 * El molde lo sigue poniendo el catálogo (qué es obligatorio, de qué tipo);
 * de la copia sólo se toman los valores, y se descarta lo que el producto
 * actual ya no declara.
 */
export function applyPrefillAttributeValues(
  attrs: AttrRow[],
  prefilled: readonly { attributeId: string | null; attributeName: string; value: string }[] | undefined,
): AttrRow[] {
  if (!prefilled || prefilled.length === 0) return attrs
  const byId = new Map(prefilled.flatMap((a) => (a.attributeId ? [[a.attributeId, a.value] as const] : [])))
  const byName = new Map(prefilled.map((a) => [a.attributeName.toLocaleLowerCase("es-CL"), a.value] as const))
  return attrs.map((attr) => {
    const value = (attr.attributeId ? byId.get(attr.attributeId) : undefined)
      ?? byName.get(attr.attributeName.toLocaleLowerCase("es-CL"))
    return value === undefined ? attr : { ...attr, value }
  })
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
      drivesQuantity: a.drivesQuantity,
    }
  })
}

// Lee del vocabulario canónico de StateBadge — evita un cuarto diccionario de
// estados divergente del badge y de lib/work-queue-labels.ts.
export function requestStatusLabel(status: string): string {
  return REQUEST_STATE_META[status as keyof typeof REQUEST_STATE_META]?.label ?? status
}

/** Precio unitario estimado tal como se escribe → número; `null` si está vacío o no es un número. */
export function parseEstimatedPrice(raw: string | null | undefined): number | null {
  const text = (raw ?? "").trim()
  if (text === "") return null
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** El umbral de cotizaciones sólo existe en repuestos; servicios conserva la regla legada (`null`). */
function quotationThresholdFor(requestType: string | undefined, thresholdClp: number | null | undefined): number | null {
  return requestType === "repuestos" ? (thresholdClp ?? null) : null
}

export interface RequestQuotationState {
  /** Umbral aplicado: `null` en servicios (y en repuestos si la página no lo informó). */
  thresholdClp: number | null
  /** `null` cuando la regla se cumple. */
  message: string | null
}

/**
 * La regla de cotizaciones de la solicitud tal como la evaluará el servidor al
 * enviar (`lib/requests/quotation-requirement.ts`), con lo que hay en pantalla.
 * Una sola función para el panel de pendientes y el aviso bajo las cotizaciones.
 *
 * `null` para los tipos sin cotización (EPP/otro).
 */
export function evaluateRequestQuotations({
  items, requestType, notes, urgency = "normal", vehicles = [], quotationThresholdClp, attachedQuotationTotals = [],
}: {
  items: ItemRow[]
  requestType?: string
  notes?: string
  urgency?: string
  vehicles?: readonly Pick<VehicleOption, "id" | "operationalStatus">[]
  quotationThresholdClp?: number | null
  /**
   * Totales de las cotizaciones YA guardadas en el borrador (pendientes). Al
   * guardar, el formulario saca de `item.cotizaciones` lo que subió; sin esto,
   * un borrador con su cotización adjunta se veía «sin cotización» y el envío
   * quedaba bloqueado en el cliente aunque el servidor lo aceptara.
   */
  attachedQuotationTotals?: readonly number[]
}): RequestQuotationState | null {
  if (!requestType || !QUOTATION_TYPES.has(requestType)) return null
  const thresholdClp = quotationThresholdFor(requestType, quotationThresholdClp)
  // Una cotización sin monto escrito aún cuenta como archivo, pero su total es 0.
  const quotationTotals = [
    ...attachedQuotationTotals,
    ...items.flatMap((item) => (item.cotizaciones ?? []).map((cot) => Number(cot.totalAmount) || 0)),
  ]
  const estimatedTotal = estimatedRequestTotal(items.map((item) => ({
    quantity: Number(item.quantity),
    estimatedUnitPrice: parseEstimatedPrice(item.estimatedUnitPrice),
  })))
  const operationalStatusById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.operationalStatus]))
  // Vía rápida por ítem: una OT vinculada o un equipo que no está operativo.
  const fastPathEligible = fastPathCoversRequest(items.map((item) => ({
    quantity: Number(item.quantity),
    estimatedUnitPrice: parseEstimatedPrice(item.estimatedUnitPrice),
    fastPath: !!item.workOrderId
      || !!(item.vehicleId && (operationalStatusById.get(item.vehicleId) ?? "operativo") !== "operativo"),
  })), thresholdClp)

  const result = evaluateQuotationRequirement({
    quotationTotals, estimatedTotal, thresholdClp, urgency, fastPathEligible,
    hasJustification: !!notes?.trim(),
  })
  return { thresholdClp, message: result.ok ? null : quotationRequirementMessage(result.reason, thresholdClp) }
}

/** Explica la regla vigente bajo el título «Cotizaciones» del ítem, en el idioma de quien pide. */
export function quotationRuleHint(requestType: string, thresholdClp: number | null): string {
  if (requestType === "repuestos" && thresholdClp !== null && thresholdClp > 0) {
    return `Bajo ${formatCLP(thresholdClp)} basta una cotización o el precio unitario estimado de cada ítem. Sobre ese monto se necesitan 3 cotizaciones, o menos con una justificación en Notas generales. Cada archivo necesita proveedor y monto.`
  }
  return "Mínimo 3 cotizaciones, o menos con una justificación en Notas generales. Cada archivo necesita proveedor y monto."
}

export function buildRequestSummaryIssues({
  worksiteId, requiredDate, items, requestType, notes, products = [],
  urgency, vehicles, quotationThresholdClp, attachedQuotationTotals,
}: {
  worksiteId: string; requiredDate: string; items: ItemRow[]
  /** Repuestos/servicios: cotizaciones según la regla única de `quotation-requirement` (LOG-9/UX-2). */
  requestType?: string; notes?: string
  /** Catálogo, para evaluar las reglas del producto elegido (colaborador, dosis). */
  products?: ProductOption[]
  /** Urgencia de la solicitud: la vía rápida exige «crítica». */
  urgency?: string
  /** Equipos de flota del formulario; dicen cuáles no están operativos (vía rápida). */
  vehicles?: readonly Pick<VehicleOption, "id" | "operationalStatus">[]
  /** Umbral de repuestos en CLP, de Parámetros operativos. */
  quotationThresholdClp?: number | null
  /** Cotizaciones ya guardadas en el borrador (ver `evaluateRequestQuotations`). */
  attachedQuotationTotals?: readonly number[]
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
          equipmentKind: product.equipmentKind,
          attributes: product.attributes.map((a) => ({
            id: a.id, name: a.name, type: a.type, isRequired: a.isRequired, options: a.options,
            drivesQuantity: a.drivesQuantity,
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
  const quotationState = evaluateRequestQuotations({ items, requestType, notes, urgency, vehicles, quotationThresholdClp, attachedQuotationTotals })
  if (quotationState?.message) issues.push(quotationState.message)
  return issues
}
