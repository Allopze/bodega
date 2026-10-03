"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { scheduleGeneratedDocumentDrain } from "@/lib/services/generated-documents/schedule"
import { storePreventionEvidence } from "@/lib/services/prevention-evidence-upload"
import { resolveRiskReviewTrigger, verifyRiskControl } from "@/lib/services/prevention-risk-legal"
import { bulkAddMiperControl, bulkPatchMiperEntries, bulkUpdateMiperControls } from "@/lib/services/miper/bulk"
import { deleteMiperControl, deleteMiperEntry, duplicateMiperEntry, saveMiperControl, saveMiperEntry } from "@/lib/services/miper/entries"
import { commitRiskImport, previewRiskImport, type RiskImportCommitResult } from "@/lib/services/miper/import"
import { listMiperWorksiteTargets } from "@/lib/services/miper/portfolio"
import { createMiper, discardMiperDraft, updateMiperHeader } from "@/lib/services/miper/matrices"
import { addMiperObservation, reopenMiperObservation, resolveMiperObservation, respondMiperObservation } from "@/lib/services/miper/observations"
import { applyProgramGeneration, linkActionControls, proposeProgramActions, retireProgramAction, saveProgramAction, unlinkActionControl, updateProgramHeader } from "@/lib/services/miper/program"
import { addOccurrenceEvidence, recordOccurrence, voidOccurrenceRecord, withdrawOccurrenceEvidence } from "@/lib/services/miper/program-execution"
import { saveRiskFactor, setRiskFactorActive } from "@/lib/services/miper/risk-factors"
import { approveMiperFinal, approveMiperTechnicalReview, openMiperReviewRound, requestMiperCorrections, returnMiperWithObservations, submitMiperForReview } from "@/lib/services/miper/workflow"
import { countOf } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/prevention"
import { accessFrom, fail, guarded, matrixIdOf, MIPER_BASE as BASE, stringFieldOf } from "./action-guard"

// ── Matriz ──
export async function createMiperAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => createMiper(input, access), { data: (result) => ({ id: result.id }), success: "MIPER creada" })
}
export async function updateMiperHeaderAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => updateMiperHeader(input, access), { data: (result) => ({ version: result.version }), success: "Antecedentes guardados" })
}
export async function discardMiperDraftAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => discardMiperDraft(input, access), { success: "Borrador descartado" })
}

/**
 * Lista del selector «Cambiar de faena» (Fase B). Es una lectura bajo demanda:
 * el selector la pide al ABRIR el menú, nunca en cada render del espacio de
 * trabajo. El alcance sale de la sesión, nunca del input. No revalida.
 */
export async function listMiperWorksiteTargetsAction(input: unknown = {}) {
  return guarded("prevention:risk:view", input, (access) => listMiperWorksiteTargets(access), { revalidate: false, data: (targets) => ({ targets }) })
}

// ── Filas y medidas. Guardar un campo no revalida: el editor conserva su
//    estado y sólo necesita la versión nueva. Los cambios de estructura sí:
//    crear (sin `entryId`), duplicar y borrar un riesgo. ──
export async function saveMiperEntryAction(input: unknown) {
  /* Crear revalida aunque el cliente navegue después con `router.push`: la
   * navegación nativa del espacio de trabajo (`workspace-nav.tsx`) deja entradas
   * de historial que heredan la foto del último render del servidor, y Next
   * reusa esa foto al volver «atrás» salvo que una acción revalide (eso vacía su
   * caché de atrás/adelante). Sin esto, «atrás» tras «Agregar peligro» mostraba
   * la tarea sin el riesgo nuevo y con los guardados anteriores revertidos. */
  const creating = stringFieldOf(input, "entryId") === null
  return guarded("prevention:risk:edit", input, (access) => saveMiperEntry(input, access), { revalidate: creating, data: (result) => ({ ...result }) })
}
export async function duplicateMiperEntryAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => duplicateMiperEntry(input, access), { data: (result) => ({ ...result }), success: "Riesgo duplicado" })
}
export async function deleteMiperEntryAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => deleteMiperEntry(input, access), { success: "Riesgo eliminado" })
}
export async function saveMiperControlAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => saveMiperControl(input, access), { data: (result) => ({ ...result }), success: "Medida guardada" })
}
export async function deleteMiperControlAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => deleteMiperControl(input, access), { success: "Medida eliminada" })
}

// ── Acciones masivas (Fase D, spec §9). Revalidan: cambian muchos riesgos a la
//    vez y la foto nueva es la que se muestra después. `data` devuelve lo que el
//    cliente necesita sin esperar esa foto: las versiones nuevas de los riesgos
//    (para que el guardado automático no choque) o cuántas medidas cambiaron.
//    El servicio salta lo que ya estaba como se pide: con 0 escritos se avisa. ──
export async function bulkPatchMiperEntriesAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => bulkPatchMiperEntries(input, access), {
    data: (result) => ({ entries: result.entries }),
    success: (result) => result.entries.length === 0
      ? "No había nada que cambiar en los riesgos seleccionados."
      : countOf(result.entries.length, "riesgo actualizado", "riesgos actualizados"),
  })
}
export async function bulkAddMiperControlAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => bulkAddMiperControl(input, access), {
    data: (result) => ({ created: result.controls.length }),
    success: (result) => `Medida agregada a ${countOf(result.controls.length, "riesgo", "riesgos")}`,
  })
}
export async function bulkUpdateMiperControlsAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => bulkUpdateMiperControls(input, access), {
    data: (result) => ({ updated: result.controls.length }),
    success: (result) => result.controls.length === 0
      ? "No había nada que cambiar en las medidas elegidas."
      : countOf(result.controls.length, "medida actualizada", "medidas actualizadas"),
  })
}

// ── Flujo ──
export async function submitMiperAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => submitMiperForReview(input, access), { success: "MIPER enviada a revisión" })
}
/** Sólo marca la apertura; el servicio ignora a quien no revisa esa etapa. */
export async function openMiperRoundAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => openMiperReviewRound({ matrixId: matrixIdOf(input) ?? "" }, access), { revalidate: false })
}
export async function returnMiperAction(input: unknown) {
  return guarded("prevention:risk:review", input, (access) => returnMiperWithObservations(input, access), { success: "MIPER devuelta con observaciones" })
}
export async function approveMiperTechnicalAction(input: unknown) {
  return guarded("prevention:risk:review", input, (access) => approveMiperTechnicalReview(input, access), { success: "Revisión técnica aprobada" })
}
export async function requestMiperCorrectionsAction(input: unknown) {
  return guarded("prevention:risk:approve_legal", input, (access) => requestMiperCorrections(input, access), { success: "Correcciones solicitadas" })
}
export async function approveMiperFinalAction(input: unknown) {
  // La versión sellada se arma y archiva después de responder.
  return guarded("prevention:risk:approve_legal", input, (access) => approveMiperFinal(input, access), {
    data: (result) => ({ ...result }),
    success: "Versión sellada",
    after: (session) => scheduleGeneratedDocumentDrain(session.user.id),
  })
}

// ── Observaciones: el servicio exige el permiso de la etapa observada. ──
export async function addMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => addMiperObservation(input, access), { success: "Observación registrada" })
}
export async function respondMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => respondMiperObservation(input, access), { success: "Respuesta guardada" })
}
export async function resolveMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => resolveMiperObservation(input, access), { success: "Observación resuelta" })
}
export async function reopenMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => reopenMiperObservation(input, access), { success: "Observación reabierta" })
}

// ── Catálogo ──
export async function saveRiskFactorAction(input: unknown) {
  return guarded("prevention:risk:catalog:manage", input, (access) => saveRiskFactor(input, access), { success: "Factor guardado" })
}
export async function setRiskFactorActiveAction(input: unknown) {
  return guarded("prevention:risk:catalog:manage", input, (access) => setRiskFactorActive(input, access), { success: "Estado del factor actualizado" })
}

// ── Se conservan del módulo anterior ──
export async function resolveRiskReviewTriggerAction(input: unknown) {
  return guarded("prevention:risk:review", input, (access) => resolveRiskReviewTrigger(input, access), { success: "Tarea de revisión cerrada" })
}
export async function verifyRiskControlAction(input: unknown) {
  const state = await guarded("prevention:risk:edit", input, (access) => verifyRiskControl(input, access), { success: "Control verificado" })
  // La ficha del control es una ruta dinámica.
  revalidatePath(`${BASE}/controles/[id]`, "page")
  return state
}

/* ── Programa de Trabajo Preventivo RE-04.1 (F2, §7) ──────────────────────
 * Dos permisos, y la ejecución **no** se guarda con el de ejecución del
 * programa: la regla del §6.3 es «el permiso de ejecución **o** el responsable
 * nominal de la actividad con `risk:view`», y esa segunda rama la resuelve
 * `requireExecute` dentro del servicio (`program-execution.ts`), que es donde
 * el acto conoce su actividad. Guardar con `prevention:risk:program:execute`
 * dejaría fuera al responsable nominal que el modo del espacio de trabajo
 * anuncia como capaz. La lectura se guarda con `prevention:risk:view`, el mismo
 * permiso que exige `getProgramWorkspace`.
 */

/** Encabezado RE-04.1: mismo contrato de versión que los antecedentes de la matriz. */
export async function saveProgramHeaderAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => updateProgramHeader(input, access), {
    data: (result) => ({ version: result.version }),
    success: "Antecedentes del programa guardados",
  })
}

export async function saveProgramActionAction(input: unknown) {
  const editing = stringFieldOf(input, "actionId") !== null
  return guarded("prevention:risk:edit", input, (access) => saveProgramAction(input, access), {
    data: (result) => ({ ...result }),
    success: editing ? "Actividad actualizada" : "Actividad agregada",
  })
}

export async function retireProgramActionAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => retireProgramAction(input, access), { success: "Actividad retirada" })
}

export async function linkProgramControlsAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => linkActionControls(input, access), { success: "Medida vinculada a la actividad" })
}

export async function unlinkProgramControlAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => unlinkActionControl(input, access), { success: "Medida desvinculada de la actividad" })
}

/** Sólo lectura salvo el `ensureProgram` idempotente: no revalida la página. */
export async function proposeProgramActionsAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => proposeProgramActions(input, access), { revalidate: false, data: (result) => ({ ...result }) })
}

export async function applyProgramGenerationAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => applyProgramGeneration(input, access), {
    data: (result) => ({ ...result }),
    success: (result) => (result.created + result.linked === 0
      ? "Sin cambios: esas medidas ya tenían actividad"
      : `Programa generado: ${result.created} actividad(es) creada(s) y ${result.linked} medida(s) asociada(s)`),
  })
}

export async function recordOccurrenceAction(input: unknown) {
  // El mensaje nombra el acto registrado: «no se hizo» no se anuncia igual que
  // «se hizo», y el avance que se recalcula tampoco.
  const notDone = stringFieldOf(input, "outcome") === "not_done"
  return guarded("prevention:risk:view", input, (access) => recordOccurrence(input, access), {
    data: (result) => ({ ...result }),
    success: notDone ? "Ocurrencia registrada: no se hizo" : "Ocurrencia registrada: se hizo",
  })
}

export async function voidOccurrenceRecordAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => voidOccurrenceRecord(input, access), { success: "Avance actualizado: registro anulado" })
}

export async function addOccurrenceEvidenceAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => addOccurrenceEvidence(input, access), {
    data: (result) => ({ ...result }),
    success: "Evidencia agregada",
  })
}

export async function withdrawOccurrenceEvidenceAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => withdrawOccurrenceEvidence(input, access), { success: "Evidencia retirada" })
}

/**
 * Sube el archivo de la evidencia al almacenamiento con el dominio `miper`
 * (§7.6: PDF, JPEG, PNG, Word y Excel) y devuelve la ruta con la que el registro
 * la acredita. Es el paso previo de `recordOccurrenceAction` /
 * `addOccurrenceEvidenceAction`: reclamar la ruta para la faena exige que el
 * archivo lo haya subido la misma persona y que exista.
 *
 * El permiso es `risk:view` porque quien ejecuta sin el permiso del programa
 * —el responsable nominal— también adjunta evidencia; el vínculo real lo vuelve
 * a autorizar el servicio al acreditarla contra su registro.
 */
export async function uploadProgramEvidenceAction(form: FormData): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:view")
  if (guard.error) return guard.error
  try {
    const file = form.get("file")
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Adjunta el archivo de la evidencia." }
    const uploaded = await storePreventionEvidence({
      domain: "miper",
      fileName: file.name,
      fileSize: file.size,
      buffer: new Uint8Array(await file.arrayBuffer()),
      uploadedByUserId: guard.session.user.id,
    })
    return { ok: true, message: "Archivo subido", data: { ...uploaded } }
  } catch (error) {
    return fail(error)
  }
}

/* ── Importación del RE-04 real (§9.3, F3) ────────────────────────────────
 * Dos pasos: la vista previa lee el `.xlsx` en memoria —no se guarda en ningún
 * directorio— y congela el lote; la carga escribe las filas que pasaron los
 * problemas por fila. La vista previa recibe `FormData` porque el archivo viaja
 * como `File`; la carga es un objeto normal y entra por `guarded`, que aplica el
 * RBAC y traduce los errores de dominio igual que el resto del módulo.
 */

/** Campo de texto de un `FormData`: cadena vacía y archivo no cuentan. */
const formText = (value: FormDataEntryValue | null) => (typeof value === "string" && value.length > 0 ? value : null)

export async function previewRiskImportAction(form: FormData): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  try {
    const file = form.get("file")
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Adjunta el archivo del RE-04 en formato Excel (.xlsx)." }
    const period = formText(form.get("period"))
    const preview = await previewRiskImport(new Uint8Array(await file.arrayBuffer()), {
      worksiteId: formText(form.get("worksiteId")) ?? "",
      target: formText(form.get("target")) === "live" ? "live" : "draft",
      ...(period ? { period: Number(period) } : {}),
      fileName: file.name,
    }, accessFrom(guard.session))
    return {
      ok: true,
      message: `RE-04 leído: ${preview.totals.total} fila(s), ${preview.totals.ready} lista(s) para cargar`,
      data: { preview },
    }
  } catch (error) {
    return fail(error)
  }
}

export async function commitRiskImportAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => commitRiskImport(input, access), {
    data: (result) => ({ matrixId: result.matrixId, created: result.created, skipped: result.skipped, measures: result.measures }),
    success: importResultMessage,
  })
}

/** «3 riesgos cargados con 10 medidas propuestas (6 existentes y 4 por implementar); 1 fila detenida». */
function importResultMessage(result: RiskImportCommitResult): string {
  if (result.created === 0) return "No se cargó ninguna fila: revisa los problemas por fila."
  const measures = result.measures.total === 0 ? ""
    : ` con ${countOf(result.measures.total, "medida propuesta", "medidas propuestas")} (${countOf(result.measures.existing, "existente")} y ${result.measures.pending} por implementar)`
  const skipped = result.skipped > 0 ? `; ${countOf(result.skipped, "fila detenida", "filas detenidas")}` : ""
  return `${countOf(result.created, "riesgo cargado", "riesgos cargados")}${measures}${skipped}`
}
