import { and, eq, ne } from "drizzle-orm"
import { db } from "@/db"
import { pdtpPrograms } from "@/db/schema"
import { addPdtpChangeLogEntry } from "./helpers"

export async function getActivePdtpProgram(year: number) {
  const [program] = await db.select().from(pdtpPrograms).where(
    and(eq(pdtpPrograms.year, year), eq(pdtpPrograms.status, "active")),
  ).limit(1)
  return program ?? null
}

export async function approvePdtpProgramJdpr(programId: string, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden aprobar programas en estado borrador (draft).")
  if (program.approvedByJdprUserId) throw new Error("El programa ya fue aprobado por JDPR.")

  const now = new Date().toISOString()
  const [updated] = await db.update(pdtpPrograms)
    .set({ approvedByJdprUserId: userId, approvedByJdprAt: now, updatedAt: now })
    .where(eq(pdtpPrograms.id, programId)).returning()
  if (!updated) throw new Error("No se pudo registrar la aprobación JDPR.")

  await addPdtpChangeLogEntry(programId, program.version, userId, "lifecycle", { approvedByJdprUserId: null }, { approvedByJdprUserId: userId }, "Aprobado por JDPR.")
  return updated
}

export async function signPdtpProgramLegal(programId: string, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden firmar programas en estado borrador (draft).")
  if (program.approvedByLegalUserId) throw new Error("El programa ya fue firmado por Gerencia Legal.")

  const now = new Date().toISOString()
  const [updated] = await db.update(pdtpPrograms)
    .set({ approvedByLegalUserId: userId, approvedByLegalAt: now, updatedAt: now })
    .where(eq(pdtpPrograms.id, programId)).returning()
  if (!updated) throw new Error("No se pudo registrar la firma de Gerencia Legal.")

  await addPdtpChangeLogEntry(programId, program.version, userId, "lifecycle", { approvedByLegalUserId: null }, { approvedByLegalUserId: userId }, "Firmado por Gerencia Legal y RRHH.")
  return updated
}

export async function activatePdtpProgram(programId: string, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status === "active") throw new Error("El programa ya está activo.")
  if (!program.approvedByJdprUserId) throw new Error("El programa debe ser aprobado por JDPR antes de activarse.")
  if (!program.approvedByLegalUserId) throw new Error("El programa debe ser firmado por Gerencia Legal antes de activarse.")

  const now = new Date().toISOString()

  // El programa activo anterior del mismo año pasa a "closed", no "draft":
  // ya fue ejecutado (tiene ejecuciones registradas contra él), volverlo a
  // draft lo reabre para edición y bloquea el ciclo de vida (draft→closed
  // es el estado final, no draft→active de nuevo). Ambos updates en una
  // transacción: un fallo a mitad no debe dejar el año sin programa activo.
  const updated = await db.transaction(async (tx) => {
    await tx.update(pdtpPrograms).set({ status: "closed", updatedAt: now })
      .where(and(eq(pdtpPrograms.year, program.year), eq(pdtpPrograms.status, "active"), ne(pdtpPrograms.id, programId)))

    const [row] = await tx.update(pdtpPrograms)
      .set({ status: "active", updatedAt: now })
      .where(eq(pdtpPrograms.id, programId)).returning()
    if (!row) throw new Error("No se pudo activar el programa PDTP.")

    await addPdtpChangeLogEntry(programId, program.version, userId, "lifecycle", { status: "draft" }, { status: "active" }, "Programa activado.", tx)
    return row
  })
  return updated
}
