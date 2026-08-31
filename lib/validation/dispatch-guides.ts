import { z } from "zod"
import { unitOfMeasureSchema } from "./product-catalogs"

/**
 * Guías de Despacho Internas (GDI) — validación de entrada.
 *
 * Nótese lo que NO está en estos schemas: el **origen**. Es siempre la bodega
 * de la oficina central, la resuelve el backend (`getOfficeWorksite`) y no
 * viaja en el formulario, así que ninguna petición —ni construida a mano—
 * puede elegir otro punto de partida ni invertir el traslado.
 */

/** Un `<select>` vacío llega como "" o como el centinela de OptionSelect. */
const optionalId = z
  .string()
  .trim()
  .transform((value) => (value === "" || value === "__none__" ? null : value))
  .nullable()
  .optional()

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()

export const dispatchGuideItemInputSchema = z.object({
  productId:     z.string().trim().min(1, "Selecciona un producto del catálogo"),
  quantity:      z.coerce.number().positive("La cantidad debe ser mayor a 0"),
  unitOfMeasure: unitOfMeasureSchema.default("unidad"),
  notes:         optionalText(300),
})

export const dispatchGuideInputSchema = z.object({
  destinationWorksiteId: z.string().trim().min(1, "Selecciona la faena de destino"),
  dispatcherWorkerId:    optionalId,
  receiverWorkerId:      optionalId,
  vehicleId:             optionalId,
  driverWorkerId:        optionalId,
  notes:                 optionalText(1000),
  items: z
    .array(dispatchGuideItemInputSchema)
    .min(1, "Agrega al menos un elemento a la guía")
    .max(200, "Una guía admite hasta 200 líneas")
    .refine(
      (items) => new Set(items.map((item) => item.productId)).size === items.length,
      "Hay un producto repetido: súmalo en una sola línea",
    ),
})

export const cancelDispatchGuideSchema = z.object({
  guideId: z.string().trim().min(1),
  reason:  z.string().trim().min(5, "Indica el motivo de la anulación (mínimo 5 caracteres)").max(500),
})

export const receiveDispatchGuideSchema = z.object({
  guideId:            z.string().trim().min(1),
  receivedByWorkerId: optionalId,
  items: z.array(z.object({
    guideItemId:       z.string().trim().min(1),
    quantityReceived:  z.coerce.number().finite().min(0, "La cantidad no puede ser negativa"),
    differenceReason:  optionalText(500),
  })).max(200).optional(),
  notes: optionalText(1000),
})

export type DispatchGuideInput = z.infer<typeof dispatchGuideInputSchema>
export type DispatchGuideItemInput = z.infer<typeof dispatchGuideItemInputSchema>
