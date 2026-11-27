import { z } from "zod"
import { compactKey } from "./normalize"

/**
 * Tabla de equivalencias de cargos de CHOME ERP (`scripts/data/chome-erp-cargos.json`, editable por jefatura).
 *
 *   {"alias": {"CR43-51-52": {"revisar": true}, "TALLER": {"centro": "Taller"}, "KA 115": {"equipo": "KA-115"}}}
 *
 * La clave se compara sin tildes, mayúsculas, espacios ni signos («ka-115» = «KA 115»). Cada alias lleva exactamente una de:
 *  - `equipo`: código o patente de un equipo de la flota;
 *  - `centro`: nombre de un centro de costo de la faena de la nota;
 *  - `revisar`: no se adivina; la línea conserva el texto y va al informe de pendientes.
 */

export type CargoEntry = { equipo: string } | { centro: string } | { revisar: true }
export type CargoTable = ReadonlyMap<string, CargoEntry>

const entrySchema = z.union([
  z.object({ equipo: z.string().trim().min(1) }).strict(),
  z.object({ centro: z.string().trim().min(1) }).strict(),
  z.object({ revisar: z.literal(true) }).strict(),
], "Cada alias lleva exactamente una de: equipo, centro o revisar: true")

const fileSchema = z.object({ alias: z.record(z.string(), entrySchema) })

export const EMPTY_CARGO_TABLE: CargoTable = new Map()

/** Lee el JSON de la tabla. Un alias vacío o dos alias que se comparan igual con entradas distintas es un error del archivo. */
export function parseCargoTable(json: unknown): CargoTable {
  const parsed = fileSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`La tabla de cargos no es válida: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
  }
  const table = new Map<string, CargoEntry>()
  for (const [alias, entry] of Object.entries(parsed.data.alias)) {
    const key = compactKey(alias)
    if (!key) throw new Error(`La tabla de cargos tiene un alias vacío («${alias}»).`)
    const previous = table.get(key)
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
      throw new Error(`La tabla de cargos repite el alias «${alias}» con otra equivalencia.`)
    }
    table.set(key, entry)
  }
  return table
}
