/**
 * Vocabulario del catálogo de contenedores, sin dependencias de servidor.
 *
 * Vive aparte de `lib/services/prevention-containers` porque las etiquetas y la
 * forma de nombrar un contenedor las usan componentes cliente, y ese servicio
 * importa `@/db`: importarlo desde el navegador arrastra `postgres` al bundle y
 * el build de Next falla. Mismo criterio que `lib/prevention/emergency.ts`.
 */
export const CONTAINER_STATUSES = ["operational", "observed", "out_of_service"] as const
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number]

export const CONTAINER_STATUS_LABELS: Record<ContainerStatus, string> = {
  operational: "Operativo",
  observed: "Con observaciones",
  out_of_service: "Fuera de servicio",
}

export function containerStatusVariant(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "operational") return "success"
  if (status === "observed") return "warning"
  if (status === "out_of_service") return "danger"
  return "neutral"
}

/**
 * Etiqueta canónica del contenedor, la que se congela en `subjectLabel` al
 * inspeccionarlo. Identidad primero, emplazamiento después — mismo formato que
 * la del extintor en el motor PDTP.
 */
export function containerLabel(container: { code: string; location: string | null }) {
  return [container.code, container.location].filter(Boolean).join(" · ")
}
