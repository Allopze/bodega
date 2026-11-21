/**
 * Tipo de faena (Trinorma, 2026-11-21): `operacion` (por defecto), `deposito`
 * (Flor del Laja) o `administracion` (Oficina Central). Es un rótulo: no cambia
 * permisos, alcance ni dónde se imputa el costo.
 *
 * Sin dependencias de servidor: lo importan componentes de cliente. La
 * escritura vive en `lib/services/worksite-kind.ts`.
 */
export const WORKSITE_KINDS = ["operacion", "deposito", "administracion"] as const
export type WorksiteKind = (typeof WORKSITE_KINDS)[number]

export const WORKSITE_KIND_LABELS: Record<WorksiteKind, string> = {
  operacion: "Operación",
  deposito: "Depósito",
  administracion: "Administración",
}

export function isWorksiteKind(value: unknown): value is WorksiteKind {
  return typeof value === "string" && (WORKSITE_KINDS as readonly string[]).includes(value)
}
