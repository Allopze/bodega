import { z } from "zod"

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

export const productUnitSchema = z.object({
  id:          optionalText,
  code:        z.string().trim().min(1, "Ingresa un código").max(24),
  label:       z.string().trim().min(1, "Ingresa una etiqueta").max(80),
  description: optionalText,
  sortOrder:   z.coerce.number().int().min(0).default(0),
  isActive:    z.coerce.boolean().default(true),
})

export type ProductUnitInput = z.infer<typeof productUnitSchema>

const ATTRIBUTE_TYPES = ["text", "select", "number"] as const

export const productAttributeTemplateSchema = z.object({
  id:            optionalText,
  categoryId:    optionalText,
  name:          z.string().trim().min(1, "Ingresa un nombre").max(80),
  type:          z.enum(ATTRIBUTE_TYPES),
  optionsText:   optionalText,
  isRequired:    z.coerce.boolean().default(false),
  sortOrder:     z.coerce.number().int().min(0).default(0),
  isActive:      z.coerce.boolean().default(true),
}).superRefine((data, ctx) => {
  if (data.type === "select") {
    const value = data.optionsText?.trim() ?? ""
    if (!value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["optionsText"],
        message: "Define al menos una opción para el tipo select",
      })
    }
  }
})

export type ProductAttributeTemplateInput = z.infer<typeof productAttributeTemplateSchema>

export const ATTRIBUTE_TYPE_OPTIONS = ATTRIBUTE_TYPES
