import { z } from "zod"

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

/**
 * Unidad de medida de un ítem (solicitud, OC, guía, repuesto, servicio).
 *
 * Normaliza pero **no** valida contra la lista de unidades (`PRODUCT_UNITS`):
 * en solicitudes y OC el texto libre es una decisión deliberada (un `Select`
 * rechazaría las unidades heredadas). Lo que sí se corrige es la basura
 * evitable: `"CAJAS "` y `"cajas"` eran valores distintos en la base. Los
 * productos sí se validan contra la lista (`resolveActiveUnitCode`).
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
  /**
   * El nombre canónico y la categoría alimentan `identityKey` igual que
   * marca/modelo, así que cambiarlos obliga a recalcularla. Antes no eran
   * editables: una familia mal nombrada quedaba así para siempre.
   */
  canonicalName:  z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(200),
  categoryId:     z.string().trim().min(1, "Categoría requerida"),
  brand:          optionalText,
  model:          optionalText,
  certification:  optionalText,
  // Vacío = sin vida útil declarada. El formulario manda `undefined` en ese
  // caso: un string vacío coaccionaría a 0, que no es "sin definir".
  lifespanMonths: z.coerce.number().int()
                    .min(1, "Debe ser al menos 1 mes")
                    .max(600, "Máximo 600 meses (50 años)")
                    .optional().nullable(),
  /**
   * Declara que la familia no vence por diseño, para distinguirlo de "nadie
   * llenó el campo". Sin esto la tabla afirmaba "No vence" sobre toda familia
   * en blanco, y no había forma de avisar del descuido sin generar ruido
   * perpetuo sobre el EPP que legítimamente no caduca.
   */
  lifespanNotApplicable: z.coerce.boolean().default(false),
  /**
   * Pictograma de la familia. La columna existía en el esquema desde su
   * creación y nadie la leía ni la escribía: es lo que hace legible un
   * comprobante de entrega para el trabajador, así que se conecta en vez de
   * borrarse.
   */
  pictogramUrl: z.string().trim().url("Debe ser una URL válida (https://…)").max(500).optional().or(z.literal("")),
}).superRefine((value, ctx) => {
  if (value.lifespanNotApplicable && value.lifespanMonths != null) {
    ctx.addIssue({
      code: "custom",
      path: ["lifespanNotApplicable"],
      message: "No puede declararse «no vence» y a la vez fijar una vida útil.",
    })
  }
})

export type EppProductFamilyInput = z.infer<typeof eppProductFamilySchema>
