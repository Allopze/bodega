import { z } from "zod"

export const safetyIndicatorMonthSchema = z.object({
  worksiteId:          z.string().min(1, "Faena requerida"),
  year:                z.coerce.number().int().min(2024, "El año debe ser al menos 2024").max(2100, "El año no puede superar 2100"),
  month:               z.coerce.number().int().min(1).max(12),
  trabajadores:        z.coerce.number().int().min(0).default(0),
  horasHombre:         z.coerce.number().min(0).default(0),
  accConTiempoPerdido: z.coerce.number().int().min(0).default(0),
  accSinTiempoPerdido: z.coerce.number().int().min(0).default(0),
  diasPerdidos:        z.coerce.number().int().min(0).default(0),
  incidentes:          z.coerce.number().int().min(0).default(0),
  danoMaterial:        z.coerce.number().int().min(0).default(0),
  danoAmbiental:       z.coerce.number().int().min(0).default(0),
})

export type SafetyIndicatorMonthInput = z.infer<typeof safetyIndicatorMonthSchema>
