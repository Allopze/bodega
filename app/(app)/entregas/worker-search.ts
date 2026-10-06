import { cleanRut } from "@/lib/rut"
import type { DeliveryWorkerOption } from "./delivery-form.types"

/**
 * Texto contra el que filtra el selector de trabajadores. Incluye el RUT en las
 * tres formas en que se teclea —con puntos y guion, sólo con guion y sin
 * puntuación— porque el filtro del selector es una subcadena literal: sin esto
 * "17" o "17123456" no encontraban a "17.123.456-7".
 */
export function buildWorkerSearchText(worker: Pick<DeliveryWorkerOption, "name" | "position" | "worksiteName" | "rut">): string {
  const parts = [worker.name, worker.position ?? "", worker.worksiteName]
  if (worker.rut) {
    const dashed = cleanRut(worker.rut)
    parts.push(worker.rut, dashed, dashed.replace(/-/g, ""))
  }
  return parts.join(" ")
}
