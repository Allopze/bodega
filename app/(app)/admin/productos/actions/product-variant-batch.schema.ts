import { z } from "zod"

const productVariantItemSchema = z.object({
  name: z.string().min(1, "Nombre requerido"),
  attributes: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
})

const productVariantSupplierSchema = z.object({
  supplierId: z.string().optional(),
  unitPrice: z.number().min(0).optional().nullable(),
  notes: z.string().max(300).optional(),
}).optional()

const productVariantAttributeSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["text", "select", "number", "integer"]),
  options: z.string().optional().nullable(),
  sizeFamily: z.string().optional(),
  sortOrder: z.number(),
})

export const productVariantBatchSchema = z.object({
  categoryId: z.string().min(1, "Selecciona una categoría"),
  familyName: z.string().min(2, "Nombre de familia requerido").max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  unitOfMeasure: z.string().max(20).default("unidad"),
  isEpp: z.boolean().default(true),
  requiresPrevencion: z.boolean().default(false),
  isService: z.boolean().default(false),
  requiresWorker: z.boolean().default(false),
  referencePrice: z.number().min(0).optional().nullable(),
  notes: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  attributes: z.array(productVariantAttributeSchema).default([]),
  variants: z.array(productVariantItemSchema)
    .min(1, "Debe haber al menos 1 variante")
    .max(500, "Máximo 500 variantes por lote. Reduce la cantidad de valores por atributo."),
  supplier: productVariantSupplierSchema,
})

/**
 * `z.input` y no `z.infer`: los campos con `.default()` son opcionales para
 * quien llama (el formulario los manda todos; un caller que sólo quiere lote de
 * variantes de EPP no tiene por qué declarar los flags de servicio). El body de
 * la action trabaja con el resultado ya parseado, donde sí están todos.
 */
export type ProductVariantBatchInput = z.input<typeof productVariantBatchSchema>
