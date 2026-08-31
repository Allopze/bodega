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

/**
 * Unidad de medida de un ítem (solicitud, OC, guía, repuesto, servicio).
 *
 * Normaliza pero **no** valida contra `product_units`: el texto libre es una
 * decisión deliberada (un `Select` rechazaría las unidades heredadas y
 * obligaría al admin a mantener el catálogo antes de poder solicitar). Lo que
 * sí se corrige es la basura evitable: `"CAJAS "` y `"cajas"` eran valores
 * distintos en la base.
 *
 * `max(24)` iguala el largo de `productUnitSchema.code`: con el `max(20)`
 * anterior un código válido del catálogo era rechazado aguas abajo.
 *
 * Sin `.default()`: cada call site aplica el suyo, porque no todos son
 * "unidad" (servicios usa "servicio" y la línea de OC no tiene default).
 */
export const unitOfMeasureSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Unidad requerida")
  .max(24)

// `integer` es un conteo entero ≥ 1 (nº de dosis, de sesiones). Faltaba acá
// aunque `productAttributeSchema` lo acepta desde hace tiempo: una plantilla no
// podía declararlo. Las plantillas no-`select` ahora sí llegan al editor
// avanzado del producto, así que el tipo se usa de verdad.
const ATTRIBUTE_TYPES = ["text", "select", "number", "integer"] as const

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

// ── Familia de producto EPP ──────────────────────────────────────────────────

/**
 * `lifespanMonths` es el campo que enciende el vencimiento de EPP:
 * `computeEppCoverageGaps` sólo produce un gap `"expired"` cuando la familia
 * declara una vida útil. Mientras no hubo dónde editarlo, ninguna familia
 * vencía nunca.
 *
 * `brand`/`model` alimentan `identityKey`, que es UNIQUE y con el que el
 * import deduplica familias: la action tiene que recalcularlo al guardarlos.
 */
export const eppProductFamilySchema = z.object({
  id:             z.string().trim().min(1, "Familia requerida"),
  brand:          optionalText,
  model:          optionalText,
  certification:  optionalText,
  // Vacío = sin vida útil declarada (no vence). El formulario manda `undefined`
  // en ese caso: un string vacío coaccionaría a 0, que no es "sin definir".
  lifespanMonths: z.coerce.number().int()
                    .min(1, "Debe ser al menos 1 mes")
                    .max(600, "Máximo 600 meses (50 años)")
                    .optional().nullable(),
})

export type EppProductFamilyInput = z.infer<typeof eppProductFamilySchema>
