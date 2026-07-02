import { z } from "zod"

export const laborHoursSetSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),
  period:     z.string().regex(/^\d{4}-\d{2}$/, "Formato de periodo inválido (YYYY-MM)"),
  hours:      z.coerce.number().positive("Las horas hombre deben ser mayores a 0"),
})
