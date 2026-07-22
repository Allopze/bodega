import { and, eq, isNull, or } from "drizzle-orm"
import { db } from "@/db"
import { pdtpPrograms, pdtpSheets } from "@/db/schema"
import { assertPdtpProgramEditableState } from "./helpers"

export type PdtpSheetCreateInput = {
  programId: string; code: string; label: string; area: string
}

async function assertDraftProgram(programId: string): Promise<void> {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)
}

export async function createPdtpSheet(input: PdtpSheetCreateInput) {
  // Antes no validaba que el programa existiera ni que estuviera en draft:
  // se podían agregar hojas a un programa activo/cerrado, saltándose el
  // mismo gate que el resto del módulo (actividades, overrides) respeta.
  await assertDraftProgram(input.programId)

  const id = `${input.programId}-${input.code}`
  const [existing] = await db.select().from(pdtpSheets).where(eq(pdtpSheets.id, id)).limit(1)
  if (existing) throw new Error(`Ya existe una hoja con el código "${input.code}" en este programa.`)

  const [sheet] = await db.insert(pdtpSheets).values({
    id,
    code: input.code,
    programId: input.programId,
    label: input.label,
    area: input.area,
    defaultScopeRoles: [],
  }).returning()
  if (!sheet) throw new Error("No se pudo crear la hoja PDTP.")
  return sheet
}

export async function deletePdtpSheet(sheetId: string, programId: string) {
  await assertDraftProgram(programId)

  const [sheet] = await db.select().from(pdtpSheets).where(and(
    eq(pdtpSheets.id, sheetId),
    eq(pdtpSheets.programId, programId),
  )).limit(1)
  if (!sheet) throw new Error("Hoja PDTP no encontrada o no pertenece a este programa.")
  if (!sheet.programId) throw new Error("No se pueden eliminar hojas plantilla (globales).")

  await db.delete(pdtpSheets).where(eq(pdtpSheets.id, sheetId))
}

export async function listPdtpProgramSheets(programId: string) {
  return db.select().from(pdtpSheets)
    .where(or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, programId)))
    .orderBy(pdtpSheets.code)
}
