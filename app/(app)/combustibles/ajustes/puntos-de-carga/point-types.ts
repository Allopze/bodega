import { LOADING_POINT_TYPE_LABELS, type LoadingPointType } from "@/lib/combustibles/control/contracts"

/** Filas ya serializables que la página entrega al panel de puntos de carga. */

export interface LoadingPointRow {
  id: string
  worksiteId: string
  worksiteName: string
  name: string
  type: string
  isActive: boolean
  storageLocationId: string | null
  /** Enlaces (QR) vigentes de este punto. */
  activeLinks: number
}

export interface PublicLinkRow {
  id: string
  label: string
  worksiteName: string
  loadingPointName: string | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface StorageOption {
  id: string
  worksiteId: string
  name: string
}

export interface WorksiteOption {
  id: string
  name: string
}

/** Tipos que se ofrecen al crear un punto. `tae` y `other` son legados: se muestran, pero ya no se eligen. */
export const LOADING_POINT_TYPE_CHOICES: readonly LoadingPointType[] = ["fixed_dispenser", "truck_dispenser", "pickup_tank", "jerrycan", "card_station"]

/** Rótulo del tipo de punto en lenguaje de usuario (el legado «tae» se dice por su nombre completo, sin la sigla). */
export function loadingPointTypeLabel(type: string): string {
  if (type === "tae") return "Tarjeta Copec de abastecimiento"
  return (LOADING_POINT_TYPE_LABELS as Record<string, string>)[type] ?? "Otro"
}

/** Cuántos enlaces vigentes tiene cada punto de carga. */
export function activeLinksByPoint(links: ReadonlyArray<{ loadingPointId: string | null; revokedAt: string | null }>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const link of links) {
    if (link.revokedAt || !link.loadingPointId) continue
    counts.set(link.loadingPointId, (counts.get(link.loadingPointId) ?? 0) + 1)
  }
  return counts
}
