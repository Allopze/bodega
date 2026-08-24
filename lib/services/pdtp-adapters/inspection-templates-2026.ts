/**
 * lib/services/pdtp-adapters/inspection-templates-2026.ts
 *
 * Instala las definiciones de checklist del programa 2026 como plantillas del
 * **motor de inspecciones** (`preventionInspectionTemplates`), declarando en
 * `pdtpActivityNumbers` qué actividad del PDTP acredita cada una.
 *
 * Reemplaza a `checklist-templates-2026.ts`, que instalaba las mismas
 * definiciones en el motor propio de PDTP (`pdtpActivityChecklists`). Decisión
 * D10 del diseño 2026-08-12: manda Inspecciones, porque es el motor que tiene
 * sujeto inspeccionado, hallazgos derivados, revisión y —sobre todo— el
 * conector `onInspectionCompleted` que acredita el PDTP solo.
 *
 * Ambos motores ya compartían `ChecklistDefinition` y `PARTIAL_STATUS_WEIGHT`,
 * así que la migración es de contenedor, no de contenido: la misma definición
 * cambia de tabla.
 *
 * Las plantillas se instalan **aprobadas**: sólo una plantilla aprobada puede
 * programarse o ejecutarse, y estas vienen de definiciones ya versionadas en
 * `lib/sst/definitions/`, no de un borrador que alguien esté redactando.
 */

import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { preventionInspectionTemplates } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { CHECKLIST_DEFINITIONS } from "@/lib/sst/definitions"
import type { ChecklistDefinition } from "@/lib/sst/types"

type InspectionTemplateSpec = {
  /**
   * Actividad —o actividades— que esta plantilla acredita al declararse
   * ejecutada. `null` para los instrumentos que no acreditan ninguna —la
   * auditoría del SGSST vive fuera del programa anual— pero que igual deben
   * quedar instalados: la promesa es que el catálogo llegue completo, sin que
   * nadie incorpore nada a mano.
   *
   * Admite varias porque un mismo acto puede cerrar más de una obligación del
   * programa: transcribir el reporte de equipos acredita a la vez que el
   * operador lo llenó (n=25) y que el supervisor lo revisó y firmó (n=26).
   */
  n: number | number[] | null
  /** Clave en `CHECKLIST_DEFINITIONS`. */
  definitionCode: string
  /** Nombre visible. Distingue las dos plantillas que comparten definición. */
  name: string
  kind: "inspection" | "observation" | "audit"
  /**
   * Sufijo del `versionLabel`. Sólo lo necesitan las plantillas que comparten
   * `code` con otra: (code, versionLabel) es único, y las actividades 64 y 65
   * son la misma definición de EPP ejecutada por dos responsables distintos.
   * Se mantienen separadas a propósito — ver D3: cada responsable tiene su
   * propia ocurrencia, así que un run del JT no puede cerrar la del PRF.
   */
  versionSuffix?: string
  /**
   * Actividad que acredita al REVISARSE la inspección, no al ejecutarse.
   *
   * El programa separa el acto de llenar el instrumento del de revisarlo y
   * firmarlo, y les pone responsables distintos: la n=25 la hace el operador,
   * la n=26 la firma el Sup/JT. Ambas declaran "la cantidad será de acuerdo a
   * la cantidad de equipos", así que son por reporte y el motor puede
   * acreditarlas una a una.
   */
  reviewN?: number
}

export const PDTP_2026_INSPECTION_SPECS: readonly InspectionTemplateSpec[] = [
  { n: 24, definitionCode: "inspeccion_extintores",     name: "Inspección de Estado de Extintores",              kind: "inspection" },
  /* n=25 y n=26 en el mismo acto, por decisión de Prevención (2026-08-23): el
   * operador llena el reporte en papel y el administrador de contrato o el
   * supervisor de faena lo transcribe **bajo el nombre de quien lo hizo** —el
   * formulario tiene `operador_entrante` como campo obligatorio justamente
   * porque los conductores no tienen cuenta—. Transcribirlo línea por línea ES
   * revisarlo y firmarlo, así que la n=26 acredita al declarar ejecutada y no
   * en un segundo paso.
   *
   * El mecanismo de acreditar al revisar (`reviewN`) sigue existiendo para
   * cuando una actividad sí exija a una segunda persona; acá no aplica.
   */
  // La n=28 ("Revisar y cierra las inspecciones de estado de equipos") queda
  // fuera a propósito y NO es un olvido: la planilla la describe como "revisar
  // las inspecciones una vez sean recibidas, para ver si los temas mencionados
  // se levantaron para cierre, en reunión semanal". Es un acto semanal sobre el
  // CONJUNTO recibido y sobre el cierre de los hallazgos, no sobre una
  // inspección. Acreditarla por run haría que una semana con doce inspecciones
  // reportara doce cumplimientos de una actividad planificada como uno.
  { n: [25, 26], definitionCode: "reporte_equipos",      name: "Reporte de Uso Diario de Equipos",                kind: "inspection" },
  { n: 27, definitionCode: "inspeccion_taller",         name: "Inspección Taller de Mantención y Bodega RESPEL", kind: "inspection" },
  { n: 29, definitionCode: "inspeccion_contenedores",   name: "Inspección de Contenedores",                      kind: "inspection" },
  { n: 33, definitionCode: "inspeccion_equipos_moviles", name: "Inspección de Equipos Móviles",                  kind: "inspection" },
  { n: 34, definitionCode: "inspeccion_carros",         name: "Inspección de Carros",                            kind: "inspection" },
  /* Las tres actividades que no son un checklist: se registran como "se hizo"
   * más las desviaciones encontradas, tomadas del catálogo de cada instrumento.
   * Antes se acreditaban a mano porque el motor sólo sabía derivar hallazgos de
   * un ítem marcado "no cumple".
   *
   * La n=40 y la n=41 estaban cableadas al ampliroll y a maquinaria pesada, que
   * son observaciones **conductuales por operador** — la descripción de la n=39,
   * no de ellas. Quedaron ahí porque el formulario propio de la n=39 (Anexo 7)
   * fue excluido del motor por no tener ítems puntuables, así que los dos
   * formularios que sí existían se estacionaron en los números vecinos que
   * estaban vacíos. Se sueltan: ninguna de las dos era su actividad. */
  { n: 39, definitionCode: "observacion_conductas",     name: "Observación de conductas en terreno",             kind: "observation" },
  { n: 40, definitionCode: "inspeccion_area",           name: "Inspección de área de trabajo",                   kind: "inspection" },
  { n: 41, definitionCode: "caminata_seguridad",        name: "Caminata de seguridad",                           kind: "inspection" },
  /* Los dos formularios conductuales por operador (PR-SGC-24 y PR-SGC-25) se
   * siguen instalando, pero SIN actividad: son instrumentos reales y alguien
   * puede querer ejecutarlos, sólo que ninguno de los dos era la n=40 ni la
   * n=41. Si corresponden a la n=39 —que es la observación de conductas— es una
   * decisión de Prevención, no una que se adivine acá. */
  { n: null, definitionCode: "observacion_ampliroll",   name: "Observación de Seguridad: Camión Ampliroll",      kind: "observation" },
  { n: null, definitionCode: "observacion_maquinaria",  name: "Observación de Seguridad: Maquinaria Pesada",     kind: "observation" },
  { n: 64, definitionCode: "inspeccion_epp",            name: "Inspección de Uso y Estado de EPP (JT)",          kind: "inspection", versionSuffix: "jt" },
  { n: 65, definitionCode: "inspeccion_epp",            name: "Inspección de Uso y Estado de EPP (PRF)",         kind: "inspection", versionSuffix: "prf" },
  // Sin actividad PDTP: la auditoría interna del SGSST la exige el DS 44
  // art. 22 n°4, no el programa anual. Se instala igual para que nadie tenga
  // que incorporarla desde el catálogo.
  { n: null, definitionCode: "auditoria_sgsst",         name: "Auditoría interna del Sistema de Gestión de SST",  kind: "audit" },
]

/** `n` como lista, que es la forma en que la columna lo guarda. */
function completionNumbers(spec: InspectionTemplateSpec): number[] | null {
  if (spec.n === null) return null
  return Array.isArray(spec.n) ? [...spec.n].sort((a, b) => a - b) : [spec.n]
}

function sameNumbers(actual: number[] | null, expected: number[] | null): boolean {
  if (expected === null) return actual === null
  return actual?.length === expected.length && expected.every((value, index) => actual[index] === value)
}

function resolveDefinition(code: string): ChecklistDefinition {
  const definition = CHECKLIST_DEFINITIONS[code]
  if (!definition) throw new Error(`La definición de checklist "${code}" no existe en el catálogo.`)
  return definition
}

function versionLabelFor(definition: ChecklistDefinition, spec: InspectionTemplateSpec) {
  return spec.versionSuffix ? `${definition.version}-${spec.versionSuffix}` : definition.version
}

/**
 * Plantilla aprobada que acredita esta actividad del PDTP, si existe. La usa la
 * UI de PDTP para mandar al usuario al motor de inspecciones en vez de ofrecer
 * un checklist propio.
 */
export async function findInspectionTemplateForPdtpActivity(n: number) {
  const [row] = await db.select({
    id: preventionInspectionTemplates.id,
    name: preventionInspectionTemplates.name,
    kind: preventionInspectionTemplates.kind,
  }).from(preventionInspectionTemplates).where(and(
    eq(preventionInspectionTemplates.status, "approved"),
    sql`${preventionInspectionTemplates.pdtpActivityNumbers} @> ${JSON.stringify([n])}::jsonb`,
  )).limit(1)
  return row ?? null
}

export type EnsureInspectionTemplatesResult = {
  created: Array<{ n: number | number[] | null; templateId: string; code: string; versionLabel: string }>
  /** Ya existía una plantilla con ese (code, versionLabel). */
  skipped: Array<{ n: number | number[] | null; templateId: string; reason: "already_installed" }>
  /** Existía pero declaraba otras actividades PDTP; se corrigió. */
  relinked: Array<{ n: number | number[] | null; templateId: string; from: number[] | null; to: number[] }>
}

/**
 * Idempotente: la identidad de una plantilla es (code, versionLabel), que ya
 * tiene índice único. Repetir la instalación no crea versiones nuevas; sólo
 * corrige el cableado a PDTP si alguien lo dejó vacío o apuntando a otra
 * actividad, que era el estado de `INSP-DEMO` (sin `pdtpActivityNumbers`, así
 * que sus 48 runs nunca acreditaron nada).
 */
export async function ensurePdtp2026InspectionTemplates(input: {
  actorUserId: string
  dryRun?: boolean
}): Promise<EnsureInspectionTemplatesResult> {
  const result: EnsureInspectionTemplatesResult = { created: [], skipped: [], relinked: [] }
  const now = new Date().toISOString()

  for (const spec of PDTP_2026_INSPECTION_SPECS) {
    const definition = resolveDefinition(spec.definitionCode)
    const versionLabel = versionLabelFor(definition, spec)

    const [existing] = await db.select().from(preventionInspectionTemplates).where(and(
      eq(preventionInspectionTemplates.code, definition.code),
      eq(preventionInspectionTemplates.versionLabel, versionLabel),
    )).limit(1)

    if (existing) {
      const current = Array.isArray(existing.pdtpActivityNumbers) ? existing.pdtpActivityNumbers as number[] : null
      const currentReview = Array.isArray(existing.pdtpReviewActivityNumbers) ? existing.pdtpReviewActivityNumbers as number[] : null
      const wired = sameNumbers(current, completionNumbers(spec))
        && sameNumbers(currentReview, spec.reviewN === undefined ? null : [spec.reviewN])
      if (wired) {
        result.skipped.push({ n: spec.n, templateId: existing.id, reason: "already_installed" })
        continue
      }
      if (!input.dryRun) {
        await db.update(preventionInspectionTemplates)
          .set({
            pdtpActivityNumbers: completionNumbers(spec),
            pdtpReviewActivityNumbers: spec.reviewN === undefined ? null : [spec.reviewN],
            version: existing.version + 1,
            updatedAt: now,
          })
          .where(eq(preventionInspectionTemplates.id, existing.id))
      }
      result.relinked.push({ n: spec.n, templateId: existing.id, from: current, to: completionNumbers(spec) ?? [] })
      continue
    }

    const snapshot = JSON.parse(JSON.stringify(definition)) as Record<string, unknown>
    const contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")
    const id = `instpl-${nanoid()}`

    if (!input.dryRun) {
      await db.insert(preventionInspectionTemplates).values({
        id,
        code: definition.code,
        versionLabel,
        name: spec.name,
        kind: spec.kind,
        sourceDefinitionCode: spec.definitionCode,
        definitionSnapshot: snapshot,
        contentHash,
        // Borrador, no vigente: el catálogo llega completo pero el instrumento
        // lo habilita una persona, y queda constancia de quién y cuándo.
        status: "draft",
        legalFramework: definition.legalFramework?.join(" · ") ?? null,
        pdtpActivityNumbers: completionNumbers(spec),
        pdtpReviewActivityNumbers: spec.reviewN === undefined ? null : [spec.reviewN],
        authorUserId: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      })
    }
    result.created.push({ n: spec.n, templateId: id, code: definition.code, versionLabel })
  }

  return result
}

/**
 * Actividades del PDTP que acredita una definición del catálogo, según el mismo
 * cableado que usa el sembrado. Se expone para que incorporar una plantilla a
 * mano no quede desalineado con lo que instala `ensurePdtp2026InspectionTemplates`.
 */
export function pdtpActivityCandidatesFor(definitionCode: string): { n: number; name: string }[] {
  return PDTP_2026_INSPECTION_SPECS
    .filter((spec) => spec.definitionCode === definitionCode && spec.n !== null)
    .flatMap((spec) => (completionNumbers(spec) ?? []).map((n) => ({ n, name: spec.name })))
}

/**
 * Cableado por defecto al incorporar una plantilla: el `n` que acredita, cuando
 * no hay ambigüedad.
 *
 * Vacío en dos casos, y en ninguno se adivina: la definición no acredita
 * ninguna actividad (la auditoría del SGSST la exige el DS 44, no el programa
 * anual), o declara más de una y sólo una persona puede decidir cuál — EPP es
 * la misma definición en la n=64 (JT) y la n=65 (PRF), y cablear las dos haría
 * que un run del jefe de terreno cerrara la ocurrencia del prevencionista.
 */
export function defaultPdtpActivityNumbers(definitionCode: string): number[] {
  const specs = PDTP_2026_INSPECTION_SPECS.filter((spec) => spec.definitionCode === definitionCode)
  // Una sola fila del catálogo: se aplica su cableado completo, sean una o dos
  // actividades. Dos filas (EPP: n=64 del JT y n=65 del PRF) es la ambigüedad
  // que no se adivina.
  const [only, ...rest] = specs
  return only && rest.length === 0 ? completionNumbers(only) ?? [] : []
}

/**
 * Actividades que la definición acredita al REVISARSE. Mismo criterio: no se
 * adivina cuando hay más de una candidata.
 */
export function defaultPdtpReviewActivityNumbers(definitionCode: string): number[] {
  const numbers = PDTP_2026_INSPECTION_SPECS
    .filter((spec) => spec.definitionCode === definitionCode && spec.reviewN !== undefined)
    .map((spec) => spec.reviewN as number)
  return numbers.length === 1 ? numbers : []
}
