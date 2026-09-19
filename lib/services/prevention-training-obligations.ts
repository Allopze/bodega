/**
 * lib/services/prevention-training-obligations.ts
 *
 * Job diario de capacitación.
 *
 * Reemplaza a `prevention-training-reminders.ts`, que avisaba competencias por
 * vencer y escalaba brechas bloqueantes por persona. Ese modelo se retiró el
 * 2026-09-19: capacitación se mide por actividad realizada y su evidencia, no
 * por competencia individual vigente, así que no queda vencimiento que avisar.
 *
 * Lo que sí sobrevive es el barrido de obligaciones del PDTP, porque la
 * actividad medida por plazo necesita que alguien declare el hecho que la abre
 * y ese alguien no puede ser el mismo que responde por cumplirla.
 */

import { sweepTrainingOccurrenceObligations } from "@/lib/services/pdtp-adapters/occurrence-gap-connector"

export interface TrainingObligationSweepResult {
  /** Ocurrencias incumplidas detectadas: vencidas sin hacer, o declaradas no hechas. */
  gaps: number
  opened: number
  alreadyOpen: number
  skipped: number
  errors: number
}

export async function runPreventionTrainingObligations(): Promise<TrainingObligationSweepResult> {
  const { gaps, opened, alreadyOpen, skipped, errors } = await sweepTrainingOccurrenceObligations()
  return { gaps, opened, alreadyOpen, skipped, errors }
}
