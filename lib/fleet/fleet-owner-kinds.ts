/**
 * Tipos de empresa propietaria (Trinorma, 2026-11-21). Sin dependencias de
 * servidor: lo importan componentes de cliente. El catálogo y las escrituras
 * viven en `lib/services/fleet-owners.ts`.
 */
export const FLEET_OWNER_KINDS = ["propia", "relacionada", "financiera", "tercero"] as const
export type FleetOwnerKind = (typeof FLEET_OWNER_KINDS)[number]

export const FLEET_OWNER_KIND_LABELS: Record<FleetOwnerKind, string> = {
  propia: "Propia",
  relacionada: "Relacionada",
  financiera: "Financiera",
  tercero: "Tercero",
}

export function isFleetOwnerKind(value: unknown): value is FleetOwnerKind {
  return typeof value === "string" && (FLEET_OWNER_KINDS as readonly string[]).includes(value)
}

export const FLEET_OWNER_NAME_MAX_LENGTH = 120
