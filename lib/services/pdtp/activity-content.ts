/**
 * Lenguaje canónico del constructor. Las columnas físicas `activity` y
 * `program` se mantienen temporalmente por compatibilidad con datos y código
 * histórico; ningún adaptador ni UI debe inferir su significado por el nombre
 * de esas columnas.
 */
export type PdtpActivityContent = {
  activityDescription: string
  executionGuidance: string
}

export function readPdtpActivityContent(row: { activity: string; program: string }): PdtpActivityContent {
  return {
    activityDescription: row.activity,
    executionGuidance: row.program,
  }
}

export function writePdtpActivityContent(content: PdtpActivityContent): { activity: string; program: string } {
  return {
    activity: content.activityDescription,
    program: content.executionGuidance,
  }
}
