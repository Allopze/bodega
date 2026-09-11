import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionDeviationCatalog,
  preventionInspectionTemplates,
  preventionTemplateDeviations,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { criticalityFromDanoPotencial } from "@/lib/prevention/inspections"
import {
  history,
  isUniqueViolation,
  nowIso,
  requireAccess,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections-access"

/* ── Catálogo maestro de desviaciones ─────────────────────────────────────
 * Dos actos distintos, y por eso dos permisos:
 *
 *   `admin:deviation_catalog`        declarar qué desviaciones existen en la
 *                                    organización y con qué gravedad.
 *   `prevention:inspections:manage`  elegir cuáles ofrece cada instrumento.
 *
 * El catálogo era antes por fila de plantilla, y eso tenía dos costos que este
 * módulo cierra: versionar un instrumento creaba una fila nueva y dejaba el
 * catálogo colgando de la retirada, y dos instrumentos que levantan las mismas
 * condiciones mantenían listas gemelas que se separaban con el tiempo.
 */

const DANO_VALUES = ["leve", "moderado", "grave", "fatal"] as const

const NOT_FOUND = "Desviación no encontrada."
const DUPLICATE = "Esa desviación ya está en el catálogo maestro."

export interface MasterDeviation {
  id: string
  label: string
  danoPotencial: string
  isActive: boolean
  /** La criticidad que produciría un hallazgo con la gravedad del maestro. */
  criticality: string
}

export interface TemplateDeviationRow extends MasterDeviation {
  /** Si este instrumento la ofrece a quien registra en terreno. */
  selected: boolean
  /** Gravedad propia del instrumento; `null` = hereda la del maestro. */
  danoPotencialOverride: string | null
  /** La que se aplica realmente al registrar. */
  effectiveDano: string
  effectiveCriticality: string
}

/**
 * La gravedad que rige: la del instrumento si la ajustó, la del maestro si no.
 *
 * Única implementación del `COALESCE` a propósito. La UI muestra un plazo y
 * `registerDeviation` escribe otro si las dos puntas lo calculan por su cuenta,
 * y ese desacuerdo sólo se nota cuando alguien audita el plazo de una CAPA.
 */
export function effectiveDano(masterDano: string, override: string | null | undefined): string {
  return override ?? masterDano
}

/* ── Maestro ──────────────────────────────────────────────────────────────── */

/** El maestro completo, con en cuántos instrumentos se ofrece cada entrada. */
export async function listMasterDeviations(access: InspectionAccess): Promise<(MasterDeviation & { offeredBy: number })[]> {
  requireAccess(access, "admin:deviation_catalog")
  const rows = await db.select({
    id: preventionDeviationCatalog.id,
    label: preventionDeviationCatalog.label,
    danoPotencial: preventionDeviationCatalog.danoPotencial,
    isActive: preventionDeviationCatalog.isActive,
    offeredBy: sql<number>`(
      SELECT COUNT(*)::int FROM ${preventionTemplateDeviations}
      WHERE ${preventionTemplateDeviations.entryId} = ${preventionDeviationCatalog.id}
        AND ${preventionTemplateDeviations.isActive}
    )`,
  })
    .from(preventionDeviationCatalog)
    .orderBy(asc(preventionDeviationCatalog.label))
  return rows.map((row) => ({ ...row, criticality: criticalityFromDanoPotencial(row.danoPotencial) }))
}

export async function createMasterDeviation(input: unknown, access: InspectionAccess) {
  requireAccess(access, "admin:deviation_catalog")
  const data = z.object({
    label: z.string().trim().min(3).max(300),
    danoPotencial: z.enum(DANO_VALUES),
  }).parse(input)

  try {
    const [created] = await db.insert(preventionDeviationCatalog).values({
      id: `devcat-${nanoid()}`,
      label: data.label,
      danoPotencial: data.danoPotencial,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear la desviación.")
    return created
  } catch (error) {
    if (isUniqueViolation(error, "prevention_deviation_label_unique")) throw new Error(DUPLICATE)
    throw error
  }
}

/**
 * Recalibra o retira una desviación del maestro.
 *
 * NO reescribe los hallazgos ya levantados: su criticidad —y el plazo de la
 * CAPA que salió de ella— es evidencia de lo que la regla decía cuando se
 * registraron. Recalibrar rige desde ahora.
 *
 * Retirar acá la apaga en todos los instrumentos de una vez, que es el punto
 * de tener un maestro: sacar de circulación una desviación no debería exigir
 * recordar en cuántas plantillas estaba.
 */
export async function updateMasterDeviation(input: unknown, access: InspectionAccess) {
  requireAccess(access, "admin:deviation_catalog")
  const data = z.object({
    id: z.string().min(1),
    label: z.string().trim().min(3).max(300).optional(),
    danoPotencial: z.enum(DANO_VALUES).optional(),
    isActive: z.boolean().optional(),
  }).parse(input)

  const [entry] = await db.select().from(preventionDeviationCatalog)
    .where(eq(preventionDeviationCatalog.id, data.id)).limit(1)
  if (!entry) throw new Error(NOT_FOUND)

  try {
    const [updated] = await db.update(preventionDeviationCatalog).set({
      label: data.label ?? entry.label,
      danoPotencial: data.danoPotencial ?? entry.danoPotencial,
      isActive: data.isActive ?? entry.isActive,
      updatedAt: nowIso(),
    }).where(eq(preventionDeviationCatalog.id, entry.id)).returning()
    if (!updated) throw new Error("No se pudo actualizar la desviación.")
    return { before: entry, after: updated }
  } catch (error) {
    if (isUniqueViolation(error, "prevention_deviation_label_unique")) throw new Error(DUPLICATE)
    throw error
  }
}

/* ── Selección por instrumento ────────────────────────────────────────────── */

/**
 * Para cada código de instrumento, el maestro completo marcado con lo que ese
 * instrumento ofrece.
 *
 * Dos consultas en total, no dos por plantilla: la pantalla de plantillas
 * pintaba 32 consultas para una tabla antes de INS-12 y no conviene reponerlas.
 */
export async function listTemplateDeviationSelections(
  templateCodes: string[],
  access: InspectionAccess,
): Promise<Map<string, TemplateDeviationRow[]>> {
  requireAccess(access, "prevention:inspections:manage")
  const byCode = new Map<string, TemplateDeviationRow[]>()
  if (templateCodes.length === 0) return byCode

  const [master, selections] = await Promise.all([
    db.select().from(preventionDeviationCatalog).orderBy(asc(preventionDeviationCatalog.label)),
    db.select().from(preventionTemplateDeviations)
      .where(inArray(preventionTemplateDeviations.templateCode, templateCodes)),
  ])

  const selectionByCode = new Map<string, Map<string, typeof selections[number]>>()
  for (const row of selections) {
    const forCode = selectionByCode.get(row.templateCode) ?? new Map()
    forCode.set(row.entryId, row)
    selectionByCode.set(row.templateCode, forCode)
  }

  for (const code of templateCodes) {
    const forCode = selectionByCode.get(code)
    byCode.set(code, master.map((entry) => {
      const selection = forCode?.get(entry.id)
      const dano = effectiveDano(entry.danoPotencial, selection?.danoPotencialOverride)
      return {
        id: entry.id,
        label: entry.label,
        danoPotencial: entry.danoPotencial,
        isActive: entry.isActive,
        criticality: criticalityFromDanoPotencial(entry.danoPotencial),
        selected: Boolean(selection?.isActive),
        danoPotencialOverride: selection?.danoPotencialOverride ?? null,
        effectiveDano: dano,
        effectiveCriticality: criticalityFromDanoPotencial(dano),
      }
    }))
  }
  return byCode
}

/** La versión vigente de un código, para anclar el historial a una plantilla. */
async function currentTemplateFor(templateCode: string) {
  const [row] = await db.select({
    id: preventionInspectionTemplates.id,
    name: preventionInspectionTemplates.name,
    status: preventionInspectionTemplates.status,
  })
    .from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.code, templateCode))
    .orderBy(sql`CASE ${preventionInspectionTemplates.status} WHEN 'approved' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END`)
    .limit(1)
  return row ?? null
}

/**
 * Marca, desmarca o recalibra una desviación en un instrumento.
 *
 * La fila de selección no se borra al desmarcar: se desactiva. Volver a
 * ofrecerla no debería perder el ajuste de gravedad que alguien ya pensó.
 */
export async function setTemplateDeviation(input: unknown, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:manage")
  const data = z.object({
    templateCode: z.string().min(1),
    entryId: z.string().min(1),
    selected: z.boolean(),
    danoPotencialOverride: z.enum(DANO_VALUES).nullish(),
  }).parse(input)

  const template = await currentTemplateFor(data.templateCode)
  if (!template) throw new Error("Instrumento no encontrado.")

  const [entry] = await db.select().from(preventionDeviationCatalog)
    .where(eq(preventionDeviationCatalog.id, data.entryId)).limit(1)
  if (!entry) throw new Error(NOT_FOUND)

  const override = data.danoPotencialOverride ?? null
  const [saved] = await db.insert(preventionTemplateDeviations).values({
    id: `devsel-${nanoid()}`,
    templateCode: data.templateCode,
    entryId: data.entryId,
    danoPotencialOverride: override,
    isActive: data.selected,
    createdByUserId: access.userId,
  }).onConflictDoUpdate({
    target: [preventionTemplateDeviations.templateCode, preventionTemplateDeviations.entryId],
    set: { danoPotencialOverride: override, isActive: data.selected, updatedAt: nowIso() },
  }).returning()
  if (!saved) throw new Error("No se pudo guardar la desviación del instrumento.")

  const dano = effectiveDano(entry.danoPotencial, override)
  await history(db, {
    entityType: "template",
    entityId: template.id,
    changeType: data.selected ? "deviation_offered" : "deviation_withdrawn",
    reason: `${entry.label} (${dano}${override ? " · ajustada" : ""})`,
    afterState: saved,
    actorUserId: access.userId,
  })
  return saved
}

/**
 * Incorpora al maestro una desviación que se registró como "Otra" y la ofrece
 * en el instrumento donde apareció.
 *
 * Es la salida de la cola de `listUnclassifiedDeviationsFor`: son las únicas
 * cuya gravedad la eligió una persona, y dejarlas ahí es dejar el plazo de la
 * CAPA dependiendo de un criterio individual. Exige los dos permisos porque
 * hace las dos cosas —declarar y ofrecer— en un paso.
 */
export async function promoteUnclassifiedDeviation(input: unknown, access: InspectionAccess) {
  requireAccess(access, "admin:deviation_catalog")
  requireAccess(access, "prevention:inspections:manage")
  const data = z.object({
    templateCode: z.string().min(1),
    label: z.string().trim().min(3).max(300),
    danoPotencial: z.enum(DANO_VALUES),
  }).parse(input)

  // Puede que otro instrumento ya la haya incorporado: en ese caso se reutiliza
  // la entrada del maestro en vez de fallar contra el índice único.
  const [existing] = await db.select().from(preventionDeviationCatalog)
    .where(eq(preventionDeviationCatalog.label, data.label)).limit(1)
  const entry = existing ?? await createMasterDeviation(
    { label: data.label, danoPotencial: data.danoPotencial },
    access,
  )

  // Si el maestro ya la tenía con otra gravedad, la del instrumento se respeta
  // como ajuste en vez de recalibrar el maestro por la espalda.
  const override = entry.danoPotencial === data.danoPotencial ? null : data.danoPotencial
  await setTemplateDeviation(
    { templateCode: data.templateCode, entryId: entry.id, selected: true, danoPotencialOverride: override },
    access,
  )
  return entry
}

/* ── Lo que se ofrece en terreno ──────────────────────────────────────────── */

/**
 * Las desviaciones que este instrumento ofrece, con la gravedad que rige.
 *
 * Se ofrece sólo si el instrumento la marcó Y el maestro no la retiró: retirar
 * en el maestro apaga en todos lados, desmarcar apaga en uno.
 */
export async function listOfferedDeviations(templateCode: string): Promise<
  { id: string; label: string; danoPotencial: string; criticality: string }[]
> {
  const rows = await db.select({
    id: preventionDeviationCatalog.id,
    label: preventionDeviationCatalog.label,
    masterDano: preventionDeviationCatalog.danoPotencial,
    override: preventionTemplateDeviations.danoPotencialOverride,
  })
    .from(preventionTemplateDeviations)
    .innerJoin(preventionDeviationCatalog, eq(preventionDeviationCatalog.id, preventionTemplateDeviations.entryId))
    .where(and(
      eq(preventionTemplateDeviations.templateCode, templateCode),
      eq(preventionTemplateDeviations.isActive, true),
      eq(preventionDeviationCatalog.isActive, true),
    ))
    .orderBy(asc(preventionDeviationCatalog.label))

  return rows.map((row) => {
    const dano = effectiveDano(row.masterDano, row.override)
    return { id: row.id, label: row.label, danoPotencial: dano, criticality: criticalityFromDanoPotencial(dano) }
  })
}

/**
 * La entrada tal como la ofrece un instrumento, o `null` si no la ofrece.
 *
 * La usa `registerDeviation` para resolver texto y gravedad desde el id que
 * manda el cliente: es lo que garantiza que quien registra en terreno no elija
 * el plazo de la acción correctiva.
 */
export async function findOfferedDeviation(templateCode: string, entryId: string) {
  const [row] = await db.select({
    id: preventionDeviationCatalog.id,
    label: preventionDeviationCatalog.label,
    masterDano: preventionDeviationCatalog.danoPotencial,
    masterActive: preventionDeviationCatalog.isActive,
    override: preventionTemplateDeviations.danoPotencialOverride,
    selectionActive: preventionTemplateDeviations.isActive,
  })
    .from(preventionDeviationCatalog)
    .leftJoin(preventionTemplateDeviations, and(
      eq(preventionTemplateDeviations.entryId, preventionDeviationCatalog.id),
      eq(preventionTemplateDeviations.templateCode, templateCode),
    ))
    .where(eq(preventionDeviationCatalog.id, entryId))
    .limit(1)

  if (!row) return null
  if (!row.selectionActive) return { offered: false as const, label: row.label }
  if (!row.masterActive) return { offered: false as const, retired: true as const, label: row.label }
  const dano = effectiveDano(row.masterDano, row.override)
  return {
    offered: true as const,
    id: row.id,
    label: row.label,
    danoPotencial: dano,
    criticality: criticalityFromDanoPotencial(dano),
  }
}
