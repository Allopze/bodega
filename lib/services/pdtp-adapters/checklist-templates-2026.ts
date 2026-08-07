import { and, eq } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms } from "@/db/schema"
import { INSPECCION_TALLER } from "@/lib/sst/definitions/inspeccion-taller"
import { INSPECCION_EXTINTORES } from "@/lib/sst/definitions/inspeccion-extintores"
import { INSPECCION_CONTENEDORES } from "@/lib/sst/definitions/inspeccion-contenedores"
import { INSPECCION_CARROS } from "@/lib/sst/definitions/inspeccion-carros"
import { INSPECCION_EQUIPOS_MOVILES } from "@/lib/sst/definitions/inspeccion-equipos-moviles"
import { INSPECCION_EPP } from "@/lib/sst/definitions/inspeccion-epp"
import { OBSERVACION_AMPLIROLL } from "@/lib/sst/definitions/observacion-ampliroll"
import { OBSERVACION_MAQUINARIA } from "@/lib/sst/definitions/observacion-maquinaria"
import { OBSERVACION_PLANEADA } from "@/lib/sst/definitions/observacion-planeada"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { getActivePdtpActivityChecklist, savePdtpActivityChecklist } from "@/lib/services/pdtp/checklists"

type ChecklistSpec = { n: number; label: string; definition: ChecklistDefinition }

function jsonSnapshot(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown
}

const PDTP_2026_CHECKLIST_SPECS: ChecklistSpec[] = [
  { n: 27, label: "Inspección Taller de Mantención y Bodega RESPEL", definition: INSPECCION_TALLER },
  { n: 33, label: "Inspección de Equipos Móviles", definition: INSPECCION_EQUIPOS_MOVILES },
  { n: 34, label: "Inspección de Carros", definition: INSPECCION_CARROS },
  { n: 29, label: "Inspección de Contenedores", definition: INSPECCION_CONTENEDORES },
  { n: 24, label: "Inspección de Estado de Extintores", definition: INSPECCION_EXTINTORES },
  { n: 64, label: "Inspección de Uso y Estado de EPP (JT)", definition: INSPECCION_EPP },
  { n: 65, label: "Inspección de Uso y Estado de EPP (PRF)", definition: INSPECCION_EPP },
  { n: 40, label: "Observación de Seguridad: Camión Ampliroll", definition: OBSERVACION_AMPLIROLL },
  { n: 41, label: "Observación de Seguridad: Maquinaria Pesada", definition: OBSERVACION_MAQUINARIA },
  { n: 39, label: "Observación Planeada", definition: OBSERVACION_PLANEADA },
]

/** Instala snapshots versionados sólo después de que el importador materializó
 * las actividades. Repetir con las mismas definiciones no crea versiones. */
export async function ensurePdtp2026ChecklistTemplates(input: { programId: string; dryRun?: boolean }) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado para instalar checklists.")
  if (program.year !== 2026) throw new Error("Las plantillas de checklist 2026 sólo se aplican a un programa del año 2026.")

  let created = 0
  let skipped = 0
  const missing: number[] = []
  const createdChecklistIds: string[] = []
  const versions: Array<{ activityNumber: number; checklistId: string; version: string }> = []
  for (const spec of PDTP_2026_CHECKLIST_SPECS) {
    const [activity] = await db.select().from(pdtpActivities).where(and(
      eq(pdtpActivities.programId, input.programId),
      eq(pdtpActivities.n, spec.n),
    )).limit(1)
    if (!activity) {
      missing.push(spec.n)
      continue
    }
    const existing = await getActivePdtpActivityChecklist(activity.id)
    if (existing && existing.definition.code === spec.definition.code && existing.definition.version === spec.definition.version
      && isDeepStrictEqual(existing.definition, jsonSnapshot(spec.definition))) {
      skipped += 1
      versions.push({ activityNumber: spec.n, checklistId: existing.id, version: existing.version })
      continue
    }
    if (input.dryRun) {
      created += 1
      versions.push({ activityNumber: spec.n, checklistId: `dry-run:${activity.id}`, version: spec.definition.version })
      continue
    }
    const saved = await savePdtpActivityChecklist({
      activityId: activity.id,
      label: spec.label,
      definition: spec.definition,
      version: spec.definition.version,
    })
    created += 1
    createdChecklistIds.push(saved.id)
    versions.push({ activityNumber: spec.n, checklistId: saved.id, version: saved.version })
  }
  if (missing.length > 0) throw new Error(`No se pueden instalar checklists: faltan las actividades ${missing.join(", ")}.`)
  return { expected: PDTP_2026_CHECKLIST_SPECS.length, created, skipped, missing, createdChecklistIds, versions }
}
