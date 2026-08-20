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
  /** `n` de la actividad PDTP que esta plantilla acredita. */
  n: number
  /** Clave en `CHECKLIST_DEFINITIONS`. */
  definitionCode: string
  /** Nombre visible. Distingue las dos plantillas que comparten definición. */
  name: string
  kind: "inspection" | "observation"
  /**
   * Sufijo del `versionLabel`. Sólo lo necesitan las plantillas que comparten
   * `code` con otra: (code, versionLabel) es único, y las actividades 64 y 65
   * son la misma definición de EPP ejecutada por dos responsables distintos.
   * Se mantienen separadas a propósito — ver D3: cada responsable tiene su
   * propia ocurrencia, así que un run del JT no puede cerrar la del PRF.
   */
  versionSuffix?: string
}

export const PDTP_2026_INSPECTION_SPECS: readonly InspectionTemplateSpec[] = [
  { n: 24, definitionCode: "inspeccion_extintores",     name: "Inspección de Estado de Extintores",              kind: "inspection" },
  // n=25 "Realizar report de uso diario de equipos". Las hermanas del grupo NO
  // se cablean: la n=26 ("Revisión y firma del report") y la n=28 ("Revisar y
  // cierra las inspecciones de estado de equipos") son actividades de revisión,
  // y `onInspectionCompleted` dispara al **completar**, no al revisar. Darlas
  // por acreditadas cuando alguien digita el papel falsificaría la evidencia de
  // que el supervisor y el jefe de mantención las revisaron. Quedan manuales
  // hasta que el conector sepa disparar también en `reviewed`.
  { n: 25, definitionCode: "reporte_equipos",           name: "Reporte de Uso Diario de Equipos",                kind: "inspection" },
  { n: 27, definitionCode: "inspeccion_taller",         name: "Inspección Taller de Mantención y Bodega RESPEL", kind: "inspection" },
  { n: 29, definitionCode: "inspeccion_contenedores",   name: "Inspección de Contenedores",                      kind: "inspection" },
  { n: 33, definitionCode: "inspeccion_equipos_moviles", name: "Inspección de Equipos Móviles",                  kind: "inspection" },
  { n: 34, definitionCode: "inspeccion_carros",         name: "Inspección de Carros",                            kind: "inspection" },
  // n=39 (Observación Planeada, Anexo 7) sale del motor de inspecciones: es un
  // relato libre sin ítems puntuables, así que no calcula cumplimiento ni puede
  // derivar hallazgos. La definición se conserva en el catálogo; la actividad
  // pasa a acreditarse a mano — ver NON_INSPECTION_DEFINITION_CODES.
  { n: 40, definitionCode: "observacion_ampliroll",     name: "Observación de Seguridad: Camión Ampliroll",      kind: "observation" },
  { n: 41, definitionCode: "observacion_maquinaria",    name: "Observación de Seguridad: Maquinaria Pesada",     kind: "observation" },
  { n: 64, definitionCode: "inspeccion_epp",            name: "Inspección de Uso y Estado de EPP (JT)",          kind: "inspection", versionSuffix: "jt" },
  { n: 65, definitionCode: "inspeccion_epp",            name: "Inspección de Uso y Estado de EPP (PRF)",         kind: "inspection", versionSuffix: "prf" },
]

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
  created: Array<{ n: number; templateId: string; code: string; versionLabel: string }>
  /** Ya existía una plantilla con ese (code, versionLabel). */
  skipped: Array<{ n: number; templateId: string; reason: "already_installed" }>
  /** Existía pero declaraba otras actividades PDTP; se corrigió. */
  relinked: Array<{ n: number; templateId: string; from: number[] | null; to: number[] }>
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
      if (current?.length === 1 && current[0] === spec.n) {
        result.skipped.push({ n: spec.n, templateId: existing.id, reason: "already_installed" })
        continue
      }
      if (!input.dryRun) {
        await db.update(preventionInspectionTemplates)
          .set({ pdtpActivityNumbers: [spec.n], version: existing.version + 1, updatedAt: now })
          .where(eq(preventionInspectionTemplates.id, existing.id))
      }
      result.relinked.push({ n: spec.n, templateId: existing.id, from: current, to: [spec.n] })
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
        status: "approved",
        legalFramework: definition.legalFramework?.join(" · ") ?? null,
        pdtpActivityNumbers: [spec.n],
        authorUserId: input.actorUserId,
        approvedByUserId: input.actorUserId,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      })
    }
    result.created.push({ n: spec.n, templateId: id, code: definition.code, versionLabel })
  }

  return result
}
