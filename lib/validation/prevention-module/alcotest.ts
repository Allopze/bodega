import { z } from "zod"

export const alcoholTestRegisterSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),
  shift: z.string().min(1, "Turno requerido").max(40),
  performedAt: z.string().min(1, "Fecha y hora requeridas"),
  result: z.enum(["negativo", "positivo"]).default("negativo"),
  /** Personal propio. Excluyente con `testedPersonName` (ver el CHECK del esquema). */
  testedWorkerId: z.string().min(1).nullable().optional(),
  /** Tercero que no está en `workers` (chofer de proveedor, visita). */
  testedPersonName: z.string().trim().min(3).max(200).nullable().optional(),
  equipmentId: z.string().min(1).nullable().optional(),
}).superRefine((value, ctx) => {
  // El CHECK de la base ya lo impide, pero ahí el error llega como violación
  // de constraint; acá llega marcado en el campo que el operador debe corregir.
  const hasWorker = Boolean(value.testedWorkerId)
  const hasName = Boolean(value.testedPersonName)
  if (!hasWorker && !hasName) {
    ctx.addIssue({ code: "custom", path: ["testedWorkerId"], message: "Indica a quién se le tomó el control: una persona de la dotación o el nombre de un tercero." })
  }
  if (hasWorker && hasName) {
    ctx.addIssue({ code: "custom", path: ["testedPersonName"], message: "Es una persona de la dotación o un tercero, no ambos." })
  }
})

export const alcoholTestDispatchSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  recipient: z.string().trim().min(3, "Destinatario requerido").max(200),
})
