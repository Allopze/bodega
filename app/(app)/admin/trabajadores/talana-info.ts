import type { TalanaChip, TalanaWorkerSummary } from "@/lib/integrations/talana/worker-hr-status"

/**
 * Lo que Talana dice de un trabajador, ya resuelto en el servidor y serializable.
 * Sólo existe si la sesión tiene `admin:workers_hr`: sin ese permiso el campo
 * `talana` de la fila no viaja al cliente.
 */
export interface WorkerTalanaInfo {
  summary: TalanaWorkerSummary
  /** Como máximo dos, y sólo para lo excepcional (ausencia en curso, plazo por vencer o vencido, finiquito). */
  chips: TalanaChip[]
}
