import { and, eq, isNull, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpPrograms, pdtpSheets } from "@/db/schema"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState } from "./helpers"

export type PdtpSheetCreateInput = {
  programId: string; code: string; label: string; area: string
}

// Lock + re-chequeo dentro de la transacción: un submit-a-revisión concurrente
// podía confirmar entre el SELECT plano y la mutación de hojas.
async function lockDraftProgram(tx: Tx, programId: string) {
  await tx.execute(sql`SELECT id FROM ${pdtpPrograms} WHERE id = ${programId} FOR UPDATE`)
  const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)
  return program
}

/**
 * M-19 (auditoría 2026-09-28): crear o borrar una hoja cambia la estructura del
 * programa y no dejaba rastro. Ahora queda en el control de cambios.
 */
export async function createPdtpSheet(input: PdtpSheetCreateInput, userId: string | null = null) {
  // Antes no validaba que el programa existiera ni que estuviera en draft:
  // se podían agregar hojas a un programa activo/cerrado, saltándose el
  // mismo gate que el resto del módulo (actividades, overrides) respeta.
  return db.transaction(async (tx) => {
    const program = await lockDraftProgram(tx, input.programId)

    const id = `${input.programId}-${input.code}`
    const [existing] = await tx.select().from(pdtpSheets).where(eq(pdtpSheets.id, id)).limit(1)
    if (existing) throw new Error(`Ya existe una hoja con el código "${input.code}" en este programa.`)

    const [sheet] = await tx.insert(pdtpSheets).values({
      id,
      code: input.code,
      programId: input.programId,
      label: input.label,
      area: input.area,
      defaultScopeRoles: [],
    }).returning()
    if (!sheet) throw new Error("No se pudo crear la hoja PDTP.")
    await addPdtpChangeLogEntry(
      input.programId, program.version, userId, `sheet:${input.code}`,
      null, { code: input.code, label: input.label, area: input.area },
      `Hoja "${input.label}" (${input.code}) creada.`,
      tx,
    )
    return sheet
  })
}

export async function deletePdtpSheet(sheetId: string, programId: string, userId: string | null = null) {
  await db.transaction(async (tx) => {
    const program = await lockDraftProgram(tx, programId)

    const [sheet] = await tx.select().from(pdtpSheets).where(and(
      eq(pdtpSheets.id, sheetId),
      eq(pdtpSheets.programId, programId),
    )).limit(1)
    if (!sheet) throw new Error("Hoja PDTP no encontrada o no pertenece a este programa.")
    if (!sheet.programId) throw new Error("No se pueden eliminar hojas plantilla (globales).")

    await tx.delete(pdtpSheets).where(eq(pdtpSheets.id, sheetId))
    await addPdtpChangeLogEntry(
      programId, program.version, userId, `sheet:${sheet.code}`,
      { code: sheet.code, label: sheet.label, area: sheet.area }, null,
      `Hoja "${sheet.label}" (${sheet.code}) eliminada.`,
      tx,
    )
  })
}

export async function listPdtpProgramSheets(programId: string) {
  return db.select().from(pdtpSheets)
    .where(or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, programId)))
    .orderBy(pdtpSheets.code)
}
