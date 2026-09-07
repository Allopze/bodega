import { z } from "zod"
import { parseSizeOptions } from "@/lib/products/product-size"
import { unitOfMeasureSchema } from "@/lib/validation/product-catalogs"
import { duplicateNormalizedNames, normalizeAttributeName } from "@/lib/products/attribute-names"

const productVariantItemSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(240),
  attributes: z.array(z.object({ name: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(4000) })).default([]),
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

/**
 * Atributos que no son ejes de variante y se copian tal cual a cada producto
 * del lote: tipo real, obligatoriedad real y, sobre todo, `drivesQuantity`.
 * Es el único camino por el que un driver de cantidad llega a un producto
 * creado por el asistente.
 */
const advancedAttributeSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(["text", "number", "integer"]),
  isRequired: z.boolean().default(false),
  drivesQuantity: z.boolean().default(false),
  sortOrder: z.number(),
}).refine(
  (data) => !data.drivesQuantity || (data.type === "integer" && data.isRequired),
  { message: "El atributo que gobierna la cantidad debe ser entero y obligatorio", path: ["drivesQuantity"] },
)

export const productVariantBatchSchema = z.object({
  categoryId: z.string().min(1, "Selecciona una categoría"),
  familyName: z.string().min(2, "Nombre de familia requerido").max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  unitOfMeasure: unitOfMeasureSchema.default("unidad"),
  isEpp: z.boolean().default(true),
  requiresPrevencion: z.boolean().default(false),
  isService: z.boolean().default(false),
  requiresWorker: z.boolean().default(false),
  /**
   * Mismo slug que `productSchema.equipmentKind`. Faltaba en este schema, así
   * que un lote de servicios siempre nacía sin la familia de equipos que
   * atiende y no se podía pedir contra el registro de instrumentos.
   */
  equipmentKind: z.string().trim().toLowerCase().max(40)
                   .regex(/^[a-z0-9._-]*$/, "Usa sólo letras, números, guiones o puntos, sin espacios ni tildes")
                   .optional().or(z.literal("")),
  referencePrice: z.number().min(0).optional().nullable(),
  notes: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  attributes: z.array(productVariantAttributeSchema).default([]),
  advancedAttributes: z.array(advancedAttributeSchema).default([]),
  variants: z.array(productVariantItemSchema)
    .min(1, "Debe haber al menos 1 variante")
    .max(500, "Máximo 500 variantes por lote. Reduce la cantidad de valores por atributo."),
  supplier: productVariantSupplierSchema,
}).superRefine((data, ctx) => {
  const combinations = new Set<string>()
  const declared = new Map(data.attributes.map((a) => [normalizeAttributeName(a.name), a]))
  const advancedNames = new Set(data.advancedAttributes.map((a) => normalizeAttributeName(a.name)))
  for (const [index, variant] of data.variants.entries()) {
    const names = variant.attributes.map((a) => normalizeAttributeName(a.name))
    const signature = JSON.stringify(variant.attributes.map((a) => [normalizeAttributeName(a.name), a.value]).sort())
    if (new Set(names).size !== names.length || variant.attributes.some((a) =>
      advancedNames.has(normalizeAttributeName(a.name)))) {
      ctx.addIssue({ code: "custom", path: ["variants", index], message: "La variante tiene atributos repetidos" })
    }
    if (declared.size > 0 && (declared.size !== names.length || variant.attributes.some((a) => {
      const definition = declared.get(normalizeAttributeName(a.name))
      return !definition || !parseSizeOptions(definition.options).includes(a.value)
    }))) {
      ctx.addIssue({ code: "custom", path: ["variants", index], message: "La variante no coincide con los atributos y valores declarados" })
    }
    if (combinations.has(signature)) {
      ctx.addIssue({ code: "custom", path: ["variants", index], message: "Hay combinaciones de atributos repetidas" })
    }
    combinations.add(signature)
  }

  if (data.advancedAttributes.filter((a) => a.drivesQuantity).length > 1) {
    ctx.addIssue({
      code: "custom",
      message: "Solo un atributo puede gobernar la cantidad del producto",
      path: ["advancedAttributes"],
    })
  }
  // Los ejes de variante y los avanzados terminan en la misma tabla: dos con el
  // mismo nombre se pisan al resolverse por nombre en la solicitud.
  const names = [...data.attributes, ...data.advancedAttributes].map((a) => a.name).filter(Boolean)
  if (duplicateNormalizedNames(names).size > 0) {
    ctx.addIssue({
      code: "custom",
      message: "Hay dos atributos con el mismo nombre",
      path: ["advancedAttributes"],
    })
  }
})

/**
 * `z.input` y no `z.infer`: los campos con `.default()` son opcionales para
 * quien llama (el formulario los manda todos; un caller que sólo quiere lote de
 * variantes de EPP no tiene por qué declarar los flags de servicio). El body de
 * la action trabaja con el resultado ya parseado, donde sí están todos.
 */
export type ProductVariantBatchInput = z.input<typeof productVariantBatchSchema>
