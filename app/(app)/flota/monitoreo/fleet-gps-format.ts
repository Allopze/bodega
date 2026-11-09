import type { FleetGpsPosition } from "@/lib/services/fleet-gps"

/** Odómetro o horómetro informado por el GPS, como lo muestran la tabla y el mapa. */
export function formatGpsMeter(position: Pick<FleetGpsPosition, "odometer" | "hourMeter">): string {
  if (position.odometer !== null) return `${Math.round(position.odometer).toLocaleString("es-CL")} km`
  if (position.hourMeter !== null) return `${Math.round(position.hourMeter).toLocaleString("es-CL")} h`
  return "Sin medidor"
}

const HEADINGS = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"] as const

/** Rumbo en grados (0 = norte, sentido horario) como punto cardinal. */
export function headingLabel(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360
  return HEADINGS[Math.round(normalized / 45) % HEADINGS.length] ?? "norte"
}

/** Movimiento según la velocidad del snapshot, con rumbo cuando avanza. */
export function movementLabel(position: Pick<FleetGpsPosition, "speedKph" | "headingDegrees">): string {
  const speed = Math.round(position.speedKph)
  return speed > 0 ? `En movimiento · ${speed} km/h hacia el ${headingLabel(position.headingDegrees)}` : "Detenido"
}
