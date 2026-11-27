import { z } from "zod"
import { cleanText, mapErpStatus, parseErpDate } from "./normalize"
import type { ErpNote, InvalidNote } from "./types"

/**
 * Lectura y validación del archivo de CHOME ERP:
 *
 *   {"notas":[{"id":123,"fecha":"2026-05-02T10:15:00","solicitante":"…","usuario":"…","faena":"…","urgente":false,
 *     "observacion":"…","estado":"Enviada|Aceptada|En espera|Rechazada|Cerrada","motivo":null,
 *     "items":[{"articulo":"…","codigo":"…","cargo":"KA 115","cantidad":2,"proveedor":"…"}]}]}
 *
 * Una nota mala NO tumba la carga: queda en `invalid` con sus errores (en español, por línea) y las demás siguen. Sólo un
 * archivo que no tiene la forma `{"notas":[…]}` aborta.
 */

const IMPORTED_STATUSES = ["enviada", "aceptada", "en_espera", "rechazada", "cerrada"] as const

/** Texto opcional: acepta cadena, número (un código numérico) o nada; lo vacío es `null`. */
const looseText = z.union([z.string(), z.number()]).nullish().transform((value) => cleanText(value === null || value === undefined ? null : String(value)))

const requiredText = (message: string) => z.string(message).transform((value) => cleanText(value)).pipe(z.string(message))

const quantity = z.union([z.number(), z.string()], "Falta la cantidad")
  .transform((value) => (typeof value === "number" ? value : Number(value.trim().replace(",", "."))))
  .refine((value) => Number.isFinite(value) && value > 0, "La cantidad debe ser un número mayor que cero")
  .refine((value) => value <= 99_999_999, "La cantidad es demasiado grande")

const itemSchema = z.object({
  articulo: requiredText("Falta el artículo"),
  codigo: looseText,
  cargo: looseText,
  proveedor: looseText,
  cantidad: quantity,
})

const noteSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)], "El id debe ser un número").transform(String),
  fecha: z.string("Falta la fecha")
    .transform((value) => parseErpDate(value))
    .pipe(z.string("La fecha no es válida: se espera AAAA-MM-DDTHH:mm en hora de Chile")),
  solicitante: looseText,
  usuario: looseText,
  faena: requiredText("Falta la faena"),
  urgente: z.boolean("«urgente» debe ser verdadero o falso").nullish().transform((value) => value ?? false),
  observacion: looseText,
  estado: z.string("Falta el estado")
    .transform((value) => mapErpStatus(value))
    .pipe(z.enum(IMPORTED_STATUSES, "El estado debe ser Enviada, Aceptada, En espera, Rechazada o Cerrada")),
  motivo: looseText,
  items: z.array(itemSchema, "La nota no trae líneas").min(1, "La nota no trae líneas"),
})

/** «items.0.cantidad» → «línea 1, cantidad»; «fecha» → «fecha». */
function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String)
  const where = path[0] === "items" && path.length > 1
    ? [`línea ${Number(path[1]) + 1}`, ...path.slice(2)].join(", ")
    : path.join(", ")
  return where ? `${where}: ${issue.message}` : issue.message
}

function rawRef(raw: unknown): string | null {
  const id = raw && typeof raw === "object" ? (raw as { id?: unknown }).id : null
  return typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id)) ? `CHOME-${id}` : null
}

export interface ParsedFile {
  notes: ErpNote[]
  invalid: InvalidNote[]
}

/** Valida el contenido ya leído del JSON. Un `id` repetido deja pasar la primera nota y marca las siguientes como inválidas. */
export function parseErpFile(json: unknown): ParsedFile {
  const list = json && typeof json === "object" ? (json as { notas?: unknown }).notas : undefined
  if (!Array.isArray(list)) throw new Error("El archivo debe ser un JSON con la forma {\"notas\": [ … ]}.")
  const notes: ErpNote[] = []
  const invalid: InvalidNote[] = []
  const seen = new Set<string>()
  list.forEach((raw, index) => {
    const position = index + 1
    const parsed = noteSchema.safeParse(raw)
    if (!parsed.success) {
      invalid.push({ position, externalRef: rawRef(raw), errors: parsed.error.issues.map(describeIssue) })
      return
    }
    const data = parsed.data
    const externalRef = `CHOME-${data.id}`
    if (seen.has(externalRef)) {
      invalid.push({ position, externalRef, errors: [`El id ${data.id} está repetido en el archivo: sólo se considera la primera nota.`] })
      return
    }
    seen.add(externalRef)
    notes.push({
      erpId: data.id, externalRef, createdAt: data.fecha, solicitante: data.solicitante, usuario: data.usuario, faena: data.faena,
      urgente: data.urgente, observacion: data.observacion, estado: data.estado, motivo: data.motivo, items: data.items,
    })
  })
  return { notes, invalid }
}
