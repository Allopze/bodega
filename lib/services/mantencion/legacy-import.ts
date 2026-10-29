import { nameKey, normalizeCode, normalizePlate } from "@/lib/mantencion/normalize"
import type { MantItemValue, MantUnit } from "@/lib/mantencion/types"

/**
 * IMPORTADOR PREPARADO de los Google Forms históricos (§19-10) — sin UI, sin
 * ruta y sin escribir en la base. La decisión vigente (plan §8, punto 10) es NO
 * migrar el historial; esto deja resuelto lo difícil —cómo se lee una fila del
 * formulario y a qué calza en el formato interno— para que migrarlo, si se
 * decide, sea cuestión de conectar tres piezas.
 *
 * Qué hace: toma UNA fila ya normalizada de la planilla de respuestas
 * (`LegacyFormRow`, con texto tal como lo escribió la persona) y la mapea a un
 * borrador del formato interno (`LegacyRecordDraft`) resolviendo nombres a ids
 * con las búsquedas que entregue quien llama (`LegacyLookups`), sin tocar la
 * base. Cada borrador lleva su `origin` (formulario y fila de origen) para que
 * un registro importado jamás se confunda con uno firmado en la app, y para que
 * reimportar la misma fila sea idempotente.
 *
 * QUÉ FALTA PARA USARLO (nada de esto existe hoy, y nada se inventa aquí):
 * 1. Un lector de la planilla exportada (CSV/Excel de las 3 formularios) que
 *    produzca `LegacyFormRow`. Las columnas exactas están en el levantamiento de
 *    formularios de Francisco Amestica (referencias locales, sin versionar).
 * 2. Un lugar donde guardar `origin`: `mant_records` no tiene columna de origen.
 *    Hace falta una migración nueva (p. ej. `legacy_ref text unique`) —el
 *    esquema de la fase 0 no se edita— o, como mínimo, un `entity_code` en la
 *    bitácora que la reemplace.
 * 3. El insertor: NO debe pasar por `createRecord`. Un registro histórico no
 *    tiene fotos con sello, ni credencial de dispositivo, ni hora de firma
 *    confiable, y su lectura puede chocar con la regla 2 si se importa fuera de
 *    orden (importar cronológicamente por equipo, o saltarse `checkReading` y
 *    marcar el borrador). Los `check` de la base no exigen fotos, así que un
 *    insert directo es posible; la regla «todas las fotos son obligatorias»
 *    es del validador, no de la tabla.
 * 4. La decisión de negocio sobre folios (¿consumen el correlativo de la faena?)
 *    y sobre mecánicos que ya no existen como usuario (hoy `registered_by` es
 *    obligatorio y `NOT NULL`: habría que crear un usuario «Historial»).
 */

export const LEGACY_FORMS = ["preventiva_camiones", "preventiva_maquinaria", "correctiva"] as const
export type LegacyForm = (typeof LEGACY_FORMS)[number]

/** Una fila de una planilla de respuestas de Google Forms, con el texto tal como se escribió. */
export interface LegacyFormRow {
  form: LegacyForm
  /** Identificador estable de la fila en su planilla («correctiva:214»): da la idempotencia de la reimportación. */
  sourceRowId: string
  /** «Marca temporal» del formulario (cuándo se envió), tal cual la exporta Google. */
  submittedAt: string
  responderName: string
  responderEmail?: string | null
  /** Código o patente como lo escribió la persona («KA-135», «ka 135», «RBYD-98»). */
  equipmentText: string
  /** Lectura de odómetro u horómetro; las planillas viejas a veces la dejaban vacía. */
  reading: number | null
  /** Fecha del trabajo escrita por la persona (`dd/mm/aaaa`, `dd-mm-aaaa` o ISO). */
  workDateText: string | null
  // Preventivas
  intervalValue?: number | null
  items?: Array<{ name: string; value: MantItemValue; reason?: string | null }>
  notes?: string | null
  // Correctivas
  workTypes?: string[]
  oils?: string[]
  description?: string | null
  parts?: Array<{ quantity: number; description: string }>
  hours?: number | null
  inWorkshop?: boolean
  driverNames?: string[]
  /** Quien hizo el trabajo si no es quien respondió el formulario. */
  executorText?: string | null
  /** Enlaces a las fotos en Drive (no se descargan: ver el punto 3 del comentario de arriba). */
  photoUrls?: string[]
}

/** Las búsquedas que `mapLegacyRow` necesita; las implementa quien lo conecta a la base. */
export interface LegacyLookups {
  vehicleByCodeOrPlate(text: string): { id: string; unit: MantUnit } | null
  userByName(name: string): { id: string } | null
  workshopByName(name: string): { id: string } | null
  workTypeByName(name: string): { id: string } | null
  oilByName(name: string): { id: string } | null
  driverByName(name: string): { id: string } | null
  /** Clave de ítem de la pauta a partir del nombre de la actividad de la planilla (`actividadPlanilla → claveItem`, §19-2). */
  itemKeyByActivity(form: LegacyForm, activity: string): string | null
}

export interface LegacyOrigin {
  source: "google_forms"
  form: LegacyForm
  sourceRowId: string
  submittedAt: string
}

export interface LegacyRecordDraft {
  origin: LegacyOrigin
  kind: "P" | "C"
  vehicleId: string
  unit: MantUnit
  reading: number | null
  /** `YYYY-MM-DD` */
  workDate: string
  registeredByUserId: string | null
  /** Hora de firma NO confiable: los formularios no la registraban. */
  signedAt: null
  preventive: { intervalValue: number | null; notes: string | null; items: Array<{ itemKey: string; value: MantItemValue; reason: string | null }> } | null
  corrective: {
    workTypeIds: string[]; oilIds: string[]; description: string | null; parts: Array<{ quantity: number; description: string }>
    hours: number | null; inWorkshop: boolean; driverIds: string[]; executor: { kind: "yo" } | { kind: "otro_mecanico"; userId: string } | { kind: "externo"; workshopId: string }
  } | null
  photoUrls: string[]
  /** Lo que no calzó y el borrador igual conserva como vacío: quien importe decide si basta. */
  warnings: string[]
}

export type LegacyMapResult = { ok: true; draft: LegacyRecordDraft } | { ok: false; reasons: string[] }

/** `dd/mm/aaaa`, `dd-mm-aaaa` (con o sin hora) o ISO → `YYYY-MM-DD`; `null` si no es una fecha real. */
export function parseLegacyDate(text: string | null | undefined): string | null {
  const value = (text ?? "").trim()
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\D.*)?$/.exec(value)
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:\D.*)?$/.exec(value)
  const parts = dmy ? [dmy[3], dmy[2], dmy[1]] : iso ? [iso[1], iso[2], iso[3]] : null
  if (!parts) return null
  const [year, month, day] = parts.map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * Mapea una fila de formulario al borrador interno. Es PURA: no lee ni escribe
 * la base. Rechaza (con motivos legibles) lo que no se puede importar sin
 * inventar: equipo desconocido, fecha ilegible o preventiva sin ítems
 * reconocibles. Lo demás —un conductor que ya no existe, una foto— queda como
 * advertencia, porque el historial real es sucio y descartarlo por una celda
 * rota perdería el registro.
 */
export function mapLegacyRow(row: LegacyFormRow, lookups: LegacyLookups): LegacyMapResult {
  const reasons: string[] = []
  const warnings: string[] = []
  // «ka 135», «KA135» y «KA-135» son el mismo código: se prueba la forma con guion antes que la compacta.
  const vehicle = [normalizePlate(row.equipmentText), normalizeCode(row.equipmentText)]
    .flatMap((candidate) => (candidate ? [lookups.vehicleByCodeOrPlate(candidate)] : []))
    .find((found) => found !== null) ?? null
  if (!vehicle) reasons.push(`Equipo «${row.equipmentText}» no existe en la flota de mantención.`)
  const workDate = parseLegacyDate(row.workDateText) ?? parseLegacyDate(row.submittedAt)
  if (!workDate) reasons.push(`Fecha ilegible: «${row.workDateText ?? row.submittedAt}».`)
  const author = lookups.userByName(row.responderName)
  if (!author) warnings.push(`«${row.responderName}» no es usuario de la plataforma.`)
  if (!parseLegacyDate(row.workDateText)) warnings.push("Sin fecha de trabajo: se usó la fecha de envío del formulario.")
  if (row.reading == null) warnings.push("Sin lectura de odómetro u horómetro.")

  const origin: LegacyOrigin = { source: "google_forms", form: row.form, sourceRowId: row.sourceRowId, submittedAt: row.submittedAt }
  const resolve = (names: string[] | undefined, find: (name: string) => { id: string } | null, what: string) =>
    (names ?? []).flatMap((name) => {
      const found = find(name)
      if (!found) warnings.push(`${what} «${name}» no está en el catálogo.`)
      return found ? [found.id] : []
    })

  let preventive: LegacyRecordDraft["preventive"] = null
  let corrective: LegacyRecordDraft["corrective"] = null
  if (row.form === "correctiva") {
    const executorKey = nameKey(row.executorText ?? "")
    const workshop = executorKey ? lookups.workshopByName(row.executorText ?? "") : null
    const mechanic = executorKey && !workshop ? lookups.userByName(row.executorText ?? "") : null
    corrective = {
      workTypeIds: resolve(row.workTypes, lookups.workTypeByName, "Tipo de trabajo"),
      oilIds: resolve(row.oils, lookups.oilByName, "Aceite"),
      description: row.description?.trim() || null,
      parts: row.parts ?? [],
      hours: row.hours ?? null,
      inWorkshop: row.inWorkshop ?? false,
      driverIds: resolve(row.driverNames, lookups.driverByName, "Conductor"),
      executor: workshop ? { kind: "externo", workshopId: workshop.id } : mechanic ? { kind: "otro_mecanico", userId: mechanic.id } : { kind: "yo" },
    }
  } else {
    const items = (row.items ?? []).flatMap((item) => {
      const itemKey = lookups.itemKeyByActivity(row.form, item.name)
      if (!itemKey) warnings.push(`Actividad «${item.name}» sin ítem equivalente en la pauta.`)
      return itemKey ? [{ itemKey, value: item.value, reason: item.reason?.trim() || null }] : []
    })
    if (items.length === 0) reasons.push("Ninguna actividad de la fila calza con un ítem de la pauta.")
    preventive = { intervalValue: row.intervalValue ?? null, notes: row.notes?.trim() || null, items }
  }

  if (reasons.length > 0 || !vehicle || !workDate) return { ok: false, reasons }
  return {
    ok: true,
    draft: {
      origin,
      kind: row.form === "correctiva" ? "C" : "P",
      vehicleId: vehicle.id,
      unit: vehicle.unit,
      reading: row.reading,
      workDate,
      registeredByUserId: author?.id ?? null,
      signedAt: null,
      preventive,
      corrective,
      photoUrls: row.photoUrls ?? [],
      warnings,
    },
  }
}
