import type { FleetGpsPosition } from "@/lib/services/fleet-gps"

/**
 * Cómo se dicen en pantalla los valores crudos que traen las fuentes GPS
 * (regla A6 de AGENTS.md: nunca un enum ni un código al usuario). Antes
 * Monitoreo mostraba `linkedEntityType.toUpperCase()`, el id numérico del tipo
 * de alerta y el estado del dispositivo tal como llegaba (auditoría Control
 * operacional 2026-11-13, F9).
 */

export function providerLabel(provider: string): string {
  return provider === "onway" ? "OnWay" : provider === "wialon" ? "Wialon" : provider
}

/** Fuentes que reportan un vehículo, con la del medidor cuando la hay. */
export function gpsSourceLabel(position: Pick<FleetGpsPosition, "providers" | "meterProvider">): string {
  const sources = position.providers.map(providerLabel).join(" + ") || "Sin fuente"
  return position.meterProvider ? `${sources} · medidor ${providerLabel(position.meterProvider)}` : sources
}

export type GpsBadgeVariant = "success" | "signal" | "warning" | "danger" | "neutral" | "info"

/** Estado de procesamiento de una alerta GPS (`fleet_gps_alerts.processing_status`). */
export const ALERT_STATUS_META: Record<string, { label: string; variant: GpsBadgeVariant }> = {
  new: { label: "Nueva", variant: "signal" },
  actioned: { label: "Atendida", variant: "success" },
  ignored: { label: "Descartada", variant: "neutral" },
  blocked: { label: "Requiere atención", variant: "danger" },
}

export function alertStatusMeta(status: string): { label: string; variant: GpsBadgeVariant } {
  return ALERT_STATUS_META[status] ?? { label: humanizeToken(status), variant: "neutral" }
}

/** Lo que una alerta creó al atenderse (`linked_entity_type`). */
const LINKED_ENTITY_LABEL: Record<string, string> = {
  capa: "Acción correctiva creada",
  work_order: "Orden de trabajo creada",
  ot: "Orden de trabajo creada",
}

export function linkedEntityLabel(type: string): string {
  return LINKED_ENTITY_LABEL[type] ?? `${humanizeToken(type)} creada`
}

/** `ignition_unknown` → «Ignition unknown»: un token sin traducción se lee como texto, no como un identificador. */
export function humanizeToken(raw: string): string {
  const text = raw.trim().replaceAll("_", " ")
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/**
 * Estado de la señal de un vehículo: lo que dice el dispositivo (`gpsStatus`) o,
 * a falta de eso, el estado de la fuente (`sourceStatus`). Wialon informa los
 * satélites como `sats:7` y la ausencia del encendido como `ignition_unknown`.
 */
export function gpsSignalLabel(position: Pick<FleetGpsPosition, "gpsStatus" | "sourceStatus">): string {
  const raw = position.gpsStatus ?? position.sourceStatus
  if (!raw) return "Sin estado GPS"
  const satellites = /^sats:(\d+)$/i.exec(raw)
  if (satellites) {
    const count = Number(satellites[1])
    return count === 1 ? "1 satélite" : `${count} satélites`
  }
  if (raw === "ignition_unknown") return "Sin dato de encendido"
  // Un valor en texto libre del portal («Activo») se muestra tal cual; un token técnico se humaniza.
  return /^[a-z0-9_:]+$/.test(raw) ? humanizeToken(raw.replace(":", " ")) : raw
}

export function ignitionMeta(position: Pick<FleetGpsPosition, "ignitionKnown" | "ignition">): { label: string; variant: "success" | "neutral" } {
  if (!position.ignitionKnown) return { label: "Sin dato", variant: "neutral" }
  return position.ignition ? { label: "Encendido", variant: "success" } : { label: "Apagado", variant: "neutral" }
}
