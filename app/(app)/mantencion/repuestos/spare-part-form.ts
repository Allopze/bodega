import { z } from "zod"
import { parseZ, type ParseZResult } from "@/lib/actions/parse-z"
import type { SparePartInput } from "@/lib/services/spare-parts-catalog"

/**
 * Lectura y validación del formulario del catálogo de repuestos (alta y edición).
 *
 * El servicio (`lib/services/spare-parts-catalog.ts`) vuelve a validar y es quien
 * decide en última instancia; esto existe para que cada error caiga bajo SU campo
 * y diga qué corregir, en vez de un único aviso del servicio. Los topes son los
 * mismos que los del servicio.
 */

export const SPARE_PART_FIELDS = ["name", "partNumber", "partBrand", "unitOfMeasure", "referencePrice", "notes"] as const
export type SparePartField = (typeof SPARE_PART_FIELDS)[number]

const NAME_MAX = 200
const PART_FIELD_MAX = 100
const NOTES_MAX = 2000

const sparePartFormSchema = z
  .object({
    name: z.string().trim()
      .min(1, "Escribe el nombre del repuesto")
      .max(NAME_MAX, `El nombre no puede superar ${NAME_MAX} caracteres`),
    partNumber: z.string().trim().max(PART_FIELD_MAX, `El N° de parte no puede superar ${PART_FIELD_MAX} caracteres`),
    partBrand: z.string().trim().max(PART_FIELD_MAX, `La marca no puede superar ${PART_FIELD_MAX} caracteres`),
    unitOfMeasure: z.string().trim().min(1, "Elige la unidad de medida"),
    referencePrice: z.string().trim().refine(
      (value) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "El precio de referencia debe ser un número, 0 o más",
    ),
    notes: z.string().trim().max(NOTES_MAX, `Las notas no pueden superar ${NOTES_MAX} caracteres`),
  })
  .transform((value): SparePartInput => ({
    name: value.name,
    partNumber: value.partNumber || null,
    partBrand: value.partBrand || null,
    unitOfMeasure: value.unitOfMeasure,
    notes: value.notes || null,
    referencePrice: value.referencePrice === "" ? null : Number(value.referencePrice),
  }))

/** Lo que llega del `<form>` del Sheet: todo texto; vacío = sin dato. */
export function parseSparePartForm(formData: FormData): ParseZResult<SparePartInput> {
  const raw: Record<string, string> = {}
  for (const field of SPARE_PART_FIELDS) raw[field] = String(formData.get(field) ?? "")
  return parseZ(sparePartFormSchema, raw)
}

/**
 * A qué campo pertenece un error de negocio del servicio (que sólo trae el texto),
 * para pintarlo bajo el campo y no sólo en un aviso.
 */
export function fieldForServiceMessage(message: string): SparePartField | null {
  if (/N° de parte/.test(message)) return "partNumber"
  if (/^El nombre/.test(message)) return "name"
  if (/^La marca/.test(message)) return "partBrand"
  if (/^Las notas/.test(message)) return "notes"
  if (/precio de referencia/i.test(message)) return "referencePrice"
  if (/\bunidad\b/i.test(message)) return "unitOfMeasure"
  return null
}
