/**
 * Servicio de plantillas de checklist por actividad PDTP.
 *
 * Una actividad puede tener una plantilla de checklist activa (y un historial
 * de versiones inactivas). La plantilla almacena una `ChecklistDefinition`
 * (reutilizada de lib/sst/types.ts) en `definitionJson`.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivityChecklists } from "@/db/schema"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { nanoid } from "@/lib/id"
import { assertPdtpProgramEditable, isUniqueViolation } from "./helpers"
import { todayInChile } from "@/lib/utils"

export type PdtpChecklistTemplateInput = {
  activityId: string
  label: string
  definition: ChecklistDefinition
  version?: string
}

export type PdtpChecklistTemplate = typeof pdtpActivityChecklists.$inferSelect & {
  definition: ChecklistDefinition
}

function parseDefinition(row: typeof pdtpActivityChecklists.$inferSelect): PdtpChecklistTemplate {
  return { ...row, definition: row.definitionJson as unknown as ChecklistDefinition }
}

/** Obtiene el programaId de una actividad (validación). */
async function getActivityProgramId(activityId: string): Promise<string> {
  const [row] = await db.select({ programId: pdtpActivities.programId }).from(pdtpActivities)
    .where(eq(pdtpActivities.id, activityId)).limit(1)
  if (!row) throw new Error("Actividad PDTP no encontrada.")
  return row.programId
}

/**
 * Crea o reemplaza la plantilla de checklist activa de una actividad.
 * Si ya existe una activa, la desactiva (pasa a historial) y crea una nueva
 * versión con version incrementado.
 */
export async function savePdtpActivityChecklist(
  input: PdtpChecklistTemplateInput,
): Promise<PdtpChecklistTemplate> {
  const programId = await getActivityProgramId(input.activityId)
  await assertPdtpProgramEditable(programId)
  const now = new Date().toISOString()

  return db.transaction(async (tx) => {
    // Desactivar la plantilla activa actual (si existe)
    await tx.update(pdtpActivityChecklists)
      .set({ isActive: false, updatedAt: now })
      .where(and(
        eq(pdtpActivityChecklists.activityId, input.activityId),
        eq(pdtpActivityChecklists.isActive, true),
      ))

    // Calcular siguiente versión
    let version = input.version ?? "01"
    if (!input.version) {
      const existing = await tx.select({ version: pdtpActivityChecklists.version })
        .from(pdtpActivityChecklists)
        .where(eq(pdtpActivityChecklists.activityId, input.activityId))
      const maxNum = existing.reduce((max, r) => {
        const n = parseInt(r.version, 10)
        return Number.isNaN(n) ? max : Math.max(max, n)
      }, 0)
      version = String(maxNum + 1).padStart(2, "0")
    }

    const id = nanoid()
    const [row] = await tx.insert(pdtpActivityChecklists).values({
      id,
      activityId: input.activityId,
      programId,
      version,
      label: input.label,
      definitionJson: input.definition as unknown as Record<string, unknown>,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }).returning()

    return parseDefinition(row!)
  })
}

/** Obtiene la plantilla activa de una actividad (o null si no tiene). */
export async function getActivePdtpActivityChecklist(activityId: string): Promise<PdtpChecklistTemplate | null> {
  const [row] = await db.select().from(pdtpActivityChecklists)
    .where(and(
      eq(pdtpActivityChecklists.activityId, activityId),
      eq(pdtpActivityChecklists.isActive, true),
    ))
    .limit(1)
  return row ? parseDefinition(row) : null
}

/** Obtiene todas las plantillas (activas e históricas) de una actividad. */
export async function listPdtpActivityChecklists(activityId: string): Promise<PdtpChecklistTemplate[]> {
  const rows = await db.select().from(pdtpActivityChecklists)
    .where(eq(pdtpActivityChecklists.activityId, activityId))
  return rows.map(parseDefinition)
}

/** Obtiene las plantillas activas de todas las actividades de un programa. */
export async function listProgramActiveChecklists(programId: string): Promise<PdtpChecklistTemplate[]> {
  const rows = await db.select().from(pdtpActivityChecklists)
    .where(and(
      eq(pdtpActivityChecklists.programId, programId),
      eq(pdtpActivityChecklists.isActive, true),
    ))
  return rows.map(parseDefinition)
}

/** Elimina una plantilla (solo si no tiene instancias de ejecución asociadas). */
export async function deletePdtpActivityChecklist(checklistId: string): Promise<void> {
  const [checklist] = await db.select({ programId: pdtpActivityChecklists.programId })
    .from(pdtpActivityChecklists)
    .where(eq(pdtpActivityChecklists.id, checklistId))
    .limit(1)
  if (!checklist) throw new Error("Plantilla de checklist PDTP no encontrada.")
  await assertPdtpProgramEditable(checklist.programId)
  await db.delete(pdtpActivityChecklists).where(eq(pdtpActivityChecklists.id, checklistId))
}

/**
 * Crea un checklist por defecto mínimo para una actividad que no lo tiene.
 * Útil para migrar actividades existentes con un ítem genérico.
 */
export async function ensureDefaultChecklist(
  activityId: string,
  label: string,
): Promise<PdtpChecklistTemplate> {
  const existing = await getActivePdtpActivityChecklist(activityId)
  if (existing) return existing

  const defaultDefinition: ChecklistDefinition = {
    code: `pdtp_${activityId}`,
    version: "01",
    revisionDate: todayInChile(),
    title: label,
    tipo: "nuevo",
    legalFramework: [],
    applicableTo: "prevencionista_faena, admin_contrato",
    sections: [
      {
        id: "verificacion",
        title: "Verificación de ejecución",
        items: [
          {
            id: "ejecutada_conforme",
            label: "Actividad ejecutada conforme a procedimiento establecido",
            kind: "cumple_nocumple_obs",
            required: true,
          },
        ],
        countsForCompliance: true,
        hasActionCorrectiva: true,
      },
    ],
    closingAct: {
      title: "Cierre de verificación",
      resultOptions: [
        { value: "conforme", label: "Conforme" },
        { value: "observacion", label: "Con observaciones" },
        { value: "no_conforme", label: "No conforme" },
      ],
      signatureRoles: ["prevencionista_faena"],
    },
  }

  try {
    return await savePdtpActivityChecklist({ activityId, label, definition: defaultDefinition })
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Otra transacción creó la plantilla concurrentemente; devolver la existente
      const existing = await getActivePdtpActivityChecklist(activityId)
      if (existing) return existing
    }
    throw e
  }
}
