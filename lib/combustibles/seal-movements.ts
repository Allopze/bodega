/**
 * Servicio de movimientos de sellos (sección 9).
 *
 * Cada cambio de sello se registra en `fuel_seal_movements` con actor,
 * justificación y evidencia asociada. La tabla se alimenta desde
 * `fuel_tae_submissions` (los sellos que ya vienen de la PWA se insertan
 * como movimientos automáticos al validar), y desde la UI de edición de carga
 * para excepciones y correcciones.
 */

import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelSealMovements } from "@/db/schema/fuel-tae"
import { nanoid } from "@/lib/id"

export interface CreateSealMovementInput {
  submissionId: string
  sealNumber: string
  movementType: "removed" | "installed"
  changedBy?: string
  justification?: string
  isException?: boolean
  evidenceFileName?: string
  evidenceFilePath?: string
  evidenceSha256?: string
}

export type SealMovementRecord = typeof fuelSealMovements.$inferInsert

/** Inserta un movimiento de sello, sea automático desde la PWA o manual
 *  desde la interfaz de edición. */
export async function createSealMovement(input: CreateSealMovementInput) {
  const [record] = await db.insert(fuelSealMovements).values({
    id: nanoid(),
    submissionId: input.submissionId,
    sealNumber: input.sealNumber,
    movementType: input.movementType,
    changedBy: input.changedBy ?? null,
    justification: input.justification ?? null,
    isException: input.isException ?? false,
    evidenceFileName: input.evidenceFileName ?? null,
    evidenceFilePath: input.evidenceFilePath ?? null,
    evidenceSha256: input.evidenceSha256 ?? null,
  }).returning()
  return record!
}

/** Movimientos de sello asociados a una carga, ordenados por fecha. */
export async function getSealMovementsForSubmission(submissionId: string): Promise<SealMovementRecord[]> {
  return db.select().from(fuelSealMovements)
    .where(eq(fuelSealMovements.submissionId, submissionId))
    .orderBy(desc(fuelSealMovements.createdAt))
}

/** Todos los movimientos de un número de sello específico, entre cargas. */
export async function getSealMovementsByNumber(sealNumber: string, limit = 200): Promise<SealMovementRecord[]> {
  return db.select().from(fuelSealMovements)
    .where(eq(fuelSealMovements.sealNumber, sealNumber))
    .orderBy(desc(fuelSealMovements.createdAt))
    .limit(limit)
}

/** Detectar sellos repetidos: mismo número, mismo tipo, misma carga. */
export async function detectSealDuplicate(submissionId: string, sealNumber: string, movementType: "removed" | "installed"): Promise<boolean> {
  const [existing] = await db.select({ id: fuelSealMovements.id }).from(fuelSealMovements)
    .where(and(
      eq(fuelSealMovements.submissionId, submissionId),
      eq(fuelSealMovements.sealNumber, sealNumber),
      eq(fuelSealMovements.movementType, movementType),
    ))
  return !!existing
}
