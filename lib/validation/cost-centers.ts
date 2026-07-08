import { z } from "zod"

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

export const costCenterFormSchema = z.object({
  id:          optionalText,
  code:        z
    .string()
    .trim()
    .min(2, "Ingresa un código")
    .max(40, "Máximo 40 caracteres"),
  name:        z
    .string()
    .trim()
    .min(2, "Ingresa un nombre")
    .max(160, "Máximo 160 caracteres"),
  worksiteId:  optionalText,
  description: optionalText,
  isActive:    z.coerce.boolean().default(true),
})

export type CostCenterFormInput = z.infer<typeof costCenterFormSchema>
