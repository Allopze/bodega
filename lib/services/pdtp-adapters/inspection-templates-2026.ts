/**
 * lib/services/pdtp-adapters/inspection-templates-2026.ts
 *
 * Instala las definiciones de checklist del programa 2026 como plantillas del
 * **motor de inspecciones** (`preventionInspectionTemplates`), declarando en
 * `pdtpActivityNumbers` qué actividad del PDTP acredita cada una.
 *
 * Reemplazó a `checklist-templates-2026.ts` —ya borrado con el retiro del motor
 * viejo—, que instalaba las mismas definiciones en `pdtpActivityChecklists`. Decisión
 * D10 del diseño 2026-08-12: manda Inspecciones, porque es el motor que tiene
 * sujeto inspeccionado, hallazgos derivados, revisión y —sobre todo— el
 * conector `onInspectionCompleted` que acredita el PDTP solo.
 *
 * Ambos motores ya compartían `ChecklistDefinition` y `PARTIAL_STATUS_WEIGHT`,
 * así que la migración es de contenedor, no de contenido: la misma definición
 * cambia de tabla.
 *
 * Las plantillas se instalan en **borrador**: sólo una aprobada puede
 * programarse o ejecutarse, y poner un instrumento vigente es un acto de una
 * persona que queda registrado con su nombre y su fecha. El catálogo llega
 * completo; habilitarlo no se automatiza.
 *
 * Ese mismo diseño abre un hueco que hay que poder ver: mientras el borrador
 * espera aprobación, la versión vigente anterior puede seguir ejecutándose sin
 * declarar ninguna actividad, y entonces la inspección se hace, se cierra y el
 * PDTP no se entera. `classifyPdtp2026InspectionWiring` es el detector de esa
 * situación y de sus cuatro parientes.
 */

import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { preventionInspectionTemplates } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { CHECKLIST_DEFINITIONS } from "@/lib/sst/definitions"
import type { ChecklistDefinition } from "@/lib/sst/types"
import {
  PDTP_2026_INSPECTION_SPECS,
  classifyPdtp2026InspectionWiring,
  completionNumbers,
  sameNumbers,
  type InspectionTemplateSpec,
  type InspectionTemplateWiringRow,
  type InspectionWiringGap,
  type InspectionWiringReport,
} from "@/lib/prevention/inspection-wiring"

// El catálogo y su detector viven en `lib/prevention/inspection-wiring.ts`
// —puros, sin `@/db`— para que el catálogo de inspecciones, que es un
// componente cliente, pueda usarlos sin arrastrar la base al navegador. Se
// reexportan acá porque éste sigue siendo el módulo por el que el resto del
// código los conoce.
export {
  PDTP_2026_INSPECTION_SPECS,
  classifyPdtp2026InspectionWiring,
  type InspectionTemplateSpec,
  type InspectionTemplateWiringRow,
  type InspectionWiringGap,
  type InspectionWiringReport,
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
 * `code` de la plantilla. Dos filas del catálogo que comparten definición son
 * dos INSTRUMENTOS distintos, no dos versiones del mismo: EPP es la n=64 del
 * jefe de terreno y la n=65 del prevencionista (ver `defaultPdtpActivityNumbers`
 * más abajo). `supersedePreviousApproved` reemplaza por `code`, así que
 * compartirlo hacía que aprobar uno retirara al otro en silencio (I-03,
 * auditoría UI/UX 2026-08-25). `versionSuffix` ya distinguía `versionLabel`;
 * ahora también distingue `code`.
 */
function codeFor(definition: ChecklistDefinition, spec: InspectionTemplateSpec) {
  return spec.versionSuffix ? `${definition.code}_${spec.versionSuffix}` : definition.code
}

/**
 * `code` para una importación manual (no la del seed 2026), desempatado por la
 * actividad PDTP que la persona eligió — el diálogo de importación ya obliga a
 * elegir una cuando la definición es ambigua (`pdtpActivityCandidatesFor`
 * devuelve más de una). Sin actividad elegida cae al código base de la
 * definición: no reemplaza nada tras la migración 0218, así que es sólo una
 * limitación conocida (un tercer `code` ambiguo), no un riesgo de reemplazo.
 */
export function inspectionTemplateCodeFor(definitionCode: string, pdtpActivityNumbers: number[]): string {
  const definition = resolveDefinition(definitionCode)
  const spec = PDTP_2026_INSPECTION_SPECS.find((candidate) =>
    candidate.definitionCode === definitionCode
    && (completionNumbers(candidate) ?? []).some((n) => pdtpActivityNumbers.includes(n)))
  return spec ? codeFor(definition, spec) : definition.code
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
    const code = codeFor(definition, spec)

    const [existing] = await db.select().from(preventionInspectionTemplates).where(and(
      eq(preventionInspectionTemplates.code, code),
      eq(preventionInspectionTemplates.versionLabel, versionLabel),
    )).limit(1)

    if (existing) {
      const current = Array.isArray(existing.pdtpActivityNumbers) ? existing.pdtpActivityNumbers as number[] : null
      const currentReview = Array.isArray(existing.pdtpReviewActivityNumbers) ? existing.pdtpReviewActivityNumbers as number[] : null
      // `executorOfRecord` entra en la comparación: una plantilla ya cableada a
      // sus actividades pero con el ejecutante equivocado seguiría bloqueando la
      // firma del JT (D04), y saltarla como "ya instalada" lo dejaría así para
      // siempre.
      const wired = sameNumbers(current, completionNumbers(spec))
        && sameNumbers(currentReview, spec.reviewN === undefined ? null : [spec.reviewN])
        && existing.executorOfRecord === (spec.executorOfRecord ?? "platform_user")
      if (wired) {
        result.skipped.push({ n: spec.n, templateId: existing.id, reason: "already_installed" })
        continue
      }
      if (!input.dryRun) {
        await db.update(preventionInspectionTemplates)
          .set({
            pdtpActivityNumbers: completionNumbers(spec),
            pdtpReviewActivityNumbers: spec.reviewN === undefined ? null : [spec.reviewN],
            executorOfRecord: spec.executorOfRecord ?? "platform_user",
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
        code,
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
        executorOfRecord: spec.executorOfRecord ?? "platform_user",
        authorUserId: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      })
    }
    result.created.push({ n: spec.n, templateId: id, code, versionLabel })
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
