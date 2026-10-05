/**
 * Rótulos del historial (§4.9): nunca se muestra el `changeType` crudo (A6).
 *
 * Única fuente del rótulo del rol con que actuó la persona: la clave
 * persistida en el historial es `roleContext` (§4.9); la usan el servidor
 * (lib/services/miper/*) y el panel de historial del cliente. No existe un
 * `ROLE_CONTEXT_LABEL` en lib/services/miper/shared.ts que reemplazar.
 */
import { formatQty } from "@/lib/utils"

const LABELS: Record<string, string> = {
  created: "MIPER creada",
  header_updated: "Antecedentes modificados",
  entry_created: "Riesgo agregado",
  entry_updated: "Riesgo modificado",
  entry_duplicated: "Riesgo duplicado",
  entry_deleted: "Riesgo eliminado",
  control_created: "Medida agregada",
  control_updated: "Medida modificada",
  control_deleted: "Medida eliminada",
  submitted: "Enviada a revisión",
  opened: "Revisión iniciada",
  returned: "Devuelta con observaciones",
  technical_approved: "Revisión técnica aprobada",
  corrections_requested: "Legal y RRHH solicitó correcciones",
  version_sealed: "Aprobada y sellada por Legal y RRHH",
  observation_created: "Observación registrada",
  observation_answered: "Observación respondida",
  observation_resolved: "Observación resuelta",
  observation_reopened: "Observación reabierta",
  superseded: "Reemplazada por el período siguiente",
  deleted: "Borrador descartado",
  // Programa de Trabajo (F2)
  program_header_updated: "Antecedentes del programa modificados",
  action_created: "Actividad agregada al programa",
  action_updated: "Actividad del programa modificada",
  action_retired: "Actividad del programa retirada",
  controls_linked: "Medida vinculada a una actividad del programa",
  controls_unlinked: "Medida desvinculada de una actividad del programa",
  occurrence_done: "Ocurrencia registrada: se hizo",
  occurrence_not_done: "Ocurrencia registrada: no se hizo",
  occurrence_record_voided: "Registro de ocurrencia anulado",
  evidence_added: "Evidencia agregada a una ocurrencia",
  evidence_withdrawn: "Evidencia retirada de una ocurrencia",
  // Importación del RE-04 (F3): la traza de lo que entró desde el Excel real.
  import_applied: "Fila importada desde el RE-04",
}

/** Plural cuando un grupo junta varios eventos iguales: se antepone el conteo. */
const PLURALS: Record<string, string> = {
  entry_created: "riesgos agregados",
  entry_updated: "riesgos modificados",
  entry_deleted: "riesgos eliminados",
  entry_duplicated: "riesgos duplicados",
  control_created: "medidas agregadas",
  control_updated: "medidas modificadas",
  control_deleted: "medidas eliminadas",
  observation_created: "observaciones registradas",
  observation_answered: "observaciones respondidas",
  observation_resolved: "observaciones resueltas",
  action_created: "actividades agregadas al programa",
  action_updated: "actividades del programa modificadas",
  controls_linked: "medidas vinculadas a actividades del programa",
  evidence_added: "evidencias agregadas a ocurrencias",
}

/**
 * Rótulo de un evento o de un grupo de `count` eventos iguales. `object` distingue la
 * importación de una fila («entry») de la de la matriz entera («matrix»).
 */
export function historyLabel(changeType: string, options?: { object?: string | null; count?: number; atLeast?: boolean }) {
  const count = options?.count ?? 1
  /* `atLeast`: el grupo toca el borde de la página cargada y puede seguir en la
   * siguiente; decir «230» cuando sólo se cargaron 50 sería un número falso. */
  const n = options?.atLeast ? `${formatQty(count)} o más` : formatQty(count)
  if (changeType === "import_applied") {
    if (options?.object === "matrix") return "Importación del RE-04 aplicada"
    return count > 1 ? `${n} filas importadas desde el RE-04` : "Fila importada desde el RE-04"
  }
  const singular = LABELS[changeType] ?? "Cambio registrado"
  if (count <= 1) return singular
  const plural = PLURALS[changeType]
  return plural ? `${n} ${plural}` : `${singular} (${n} veces)`
}

/** Nombre del rol con que se actuó, para la columna de actor de la bitácora. */
export const ROLE_CONTEXT_TEXT: Record<string, string> = {
  "prevention:risk:edit": "Prevencionista",
  "prevention:risk:review": "Jefatura del Depto. de Prevención",
  "prevention:risk:approve_legal": "Legal y RRHH",
  "prevention:risk:catalog:manage": "Administración del catálogo",
  "prevention:risk:program:execute": "Ejecución del programa",
}
