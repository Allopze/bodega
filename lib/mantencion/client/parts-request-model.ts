import type { MantCatalog, SyncPartsNote } from "../contracts"
import { equipmentLabel } from "./fleet-view"

/**
 * «Pedir repuestos» desde el inicio de la app, sin OT (ADR mantención 0001, 2026-11-27): a qué faenas se puede pedir, a
 * qué se puede cargar cada línea y cómo se arma el pedido que se encola. Todo puro: lo que el teléfono sabe sin red es
 * el catálogo bajado (sus faenas, sus equipos y los centros de costo de esas faenas). El servidor vuelve a validar todo.
 */

/** Las faenas del mecánico a las que puede pedir. Con una sola, la pantalla no pregunta. */
export function requestWorksites(catalog: MantCatalog | null | undefined): Array<{ id: string; name: string }> {
  return catalog?.worksites ?? []
}

/** ¿Se ofrece «Pedir repuestos» sin OT? La plataforma lo dice (`mant:np:create`); un catálogo antiguo no lo dice y se oculta. */
export function canRequestParts(catalog: MantCatalog | null | undefined): boolean {
  return catalog?.user.canRequestParts === true && requestWorksites(catalog).length > 0
}

export interface ChargeChoices {
  /** Centros de costo de la faena («Taller»…); vacío si el catálogo no los trae. */
  costCenters: Array<{ id: string; name: string }>
  /** Equipos que HOY están en la faena. */
  equipment: Array<{ id: string; label: string }>
}

/**
 * Valor de la lista «Cargo» de una línea: `""` (sin cargo), `v:<equipo>` o `c:<centro de costo>`. Un solo campo porque
 * el servidor no admite los dos a la vez (CHECK de la línea).
 */
export const NO_CHARGE = ""
export const chargeOfVehicle = (id: string): string => `v:${id}`
export const chargeOfCostCenter = (id: string): string => `c:${id}`

/** Las opciones de cargo de una faena: centros de costo y equipos, por nombre. */
export function chargeChoices(catalog: MantCatalog | null | undefined, worksiteId: string): ChargeChoices {
  if (!catalog || !worksiteId) return { costCenters: [], equipment: [] }
  return {
    costCenters: (catalog.costCenters ?? []).filter((center) => center.worksiteId === worksiteId).map((center) => ({ id: center.id, name: center.name })),
    equipment: catalog.equipment
      .filter((eq) => eq.worksiteId === worksiteId)
      .sort((a, b) => a.code.localeCompare(b.code, "es"))
      .map((eq) => ({ id: eq.id, label: `${equipmentLabel(eq)} · ${eq.typeName}` })),
  }
}

/** ¿Ese cargo sigue siendo una opción de la faena? Al cambiar de faena, los cargos de la anterior se sueltan. */
export function chargeStillValid(value: string, choices: ChargeChoices): boolean {
  if (value === NO_CHARGE) return true
  if (value.startsWith("v:")) return choices.equipment.some((eq) => chargeOfVehicle(eq.id) === value)
  if (value.startsWith("c:")) return choices.costCenters.some((center) => chargeOfCostCenter(center.id) === value)
  return false
}

/** El cargo de la línea como lo espera el servidor: sólo las claves que tienen valor (un pedido sin cargo queda como siempre). */
export function chargeFields(value: string): { chargeVehicleId?: string; chargeCostCenterId?: string } {
  if (value.startsWith("v:")) return { chargeVehicleId: value.slice(2) }
  if (value.startsWith("c:")) return { chargeCostCenterId: value.slice(2) }
  return {}
}

export interface PartsNoteLineInput {
  description: string
  quantity: number
  partNumber: string
  /** Repuesto del catálogo elegido en el buscador; sin él (texto libre) la línea viaja con `productId: null`. */
  productId?: string | null
  /** Unidad del repuesto elegido (código del catálogo de unidades); sin repuesto, «unidad». */
  unit?: string
  /** `""`, `v:<id>` o `c:<id>`: ver `chargeFields`. */
  charge: string
}

export interface PartsNoteInput {
  /** Clave de idempotencia: se genera una vez al enviar y viaja igual en cada reintento. */
  id: string
  deviceId: string
  appVersion: string
  createdAt: string
  /** Con OT: la OT (la faena y el equipo salen de ella). Sin OT: la faena. */
  workOrderId?: string | null
  worksiteId?: string | null
  /** «El equipo está detenido esperando esto» (con OT). */
  equipmentStopped: boolean
  /** Urgencia fijada por quien pide (sin OT). Con OT no viaja: manda `equipmentStopped`, como siempre. */
  urgent?: boolean
  notes: string
  lines: PartsNoteLineInput[]
}

/**
 * El pedido tal como se valida con `partsNoteSchema` y se encola. Con OT es EXACTAMENTE el de siempre (sin `worksiteId`
 * ni `urgent`); sin OT lleva la faena y la urgencia, y cada línea su cargo sólo si lo eligió. Una línea con repuesto del
 * catálogo lleva su `productId` y su unidad; la de texto libre, `productId: null` y «unidad» (el servidor valida el id).
 */
export function partsNoteInput(input: PartsNoteInput): Record<string, unknown> {
  const free = !input.workOrderId
  return {
    id: input.id,
    ...(free ? { worksiteId: input.worksiteId ?? null } : { workOrderId: input.workOrderId }),
    deviceId: input.deviceId,
    appVersion: input.appVersion.slice(0, 40),
    createdAt: input.createdAt,
    equipmentStopped: input.equipmentStopped,
    ...(free ? { urgent: input.urgent ?? false } : {}),
    notes: input.notes.trim() || null,
    lines: input.lines.map((line): SyncPartsNote["lines"][number] => ({
      description: line.description,
      quantity: line.quantity,
      unitOfMeasure: line.productId ? line.unit?.trim() || "unidad" : "unidad",
      partNumber: line.partNumber.trim() || null,
      productId: line.productId ?? null,
      ...chargeFields(line.charge),
    })),
  }
}
