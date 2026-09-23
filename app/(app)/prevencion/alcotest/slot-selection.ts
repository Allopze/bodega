/**
 * Lógica pura del selector de casilla que comparten `RegisterTestDialog` y
 * `DispatchDialog` (`alcotest-workbench.tsx`): qué casillas mostrar, si el botón
 * de guardar debe habilitarse, y en qué orden subir la evidencia elegida antes
 * de invocar la acción.
 *
 * Vive fuera del componente para que la regla de negocio sea testeable sin
 * renderizar React. El gate real está en el servidor
 * (`fulfillAlcotestSlotTx`, `lib/services/prevention-alcotest-slots.ts:243-247`
 * exige al menos una evidencia activa para cumplir una casilla); esto es sólo
 * el reflejo en el cliente para no dejar enviar algo que el servidor va a
 * rechazar de todas formas.
 */

/** Centinela del selector de casilla: control/envío extraordinario, sin casilla del programa. */
export const NO_SLOT = "__no_slot__"

/**
 * Las casillas de `controlSlots`/`dispatchSlots` sólo se conocen para la faena
 * que la página tiene filtrada (`selectedWorksiteId`): `page.tsx` sólo trae
 * casillas de una faena a la vez (`listAlcotestSlotsForWorksite`). Si el
 * operador elige otra faena dentro del diálogo, no hay datos para ofrecer un
 * selector honesto — se apaga en vez de mostrar una lista que podría ser de la
 * faena equivocada.
 */
export function slotsAvailableForWorksite(
  dialogWorksiteId: string,
  selectedWorksiteId: string | null,
): boolean {
  return dialogWorksiteId === selectedWorksiteId
}

/**
 * ¿El control/envío que se está registrando cumple una casilla real (no el
 * centinela "Ninguna", y con casillas disponibles para la faena elegida)?
 */
export function resolvesToSlot(slotId: string, slotsAvailable: boolean): boolean {
  return slotsAvailable && slotId !== NO_SLOT
}

/**
 * Espejo del gate real del servicio: sin al menos una evidencia activa —ya
 * subida antes, o un archivo nuevo elegido en este envío— la casilla no se
 * puede cumplir. Sin casilla elegida no hay nada que cumplir, así que siempre
 * está lista.
 */
export function isEvidenceReady(input: {
  hasSlot: boolean
  activeEvidenceCount: number
  newFileCount: number
}): boolean {
  return !input.hasSlot || input.activeEvidenceCount + input.newFileCount > 0
}

export type UploadOneEvidence = (file: File) => Promise<{ ok: boolean; message?: string }>

/**
 * Sube los archivos elegidos, uno por uno, deteniéndose en el primer error —
 * antes de invocar la acción que registra el control/envío, porque el
 * servicio exige la evidencia ya en base antes de poder cumplir la casilla.
 *
 * Si el segundo de tres archivos falla, el primero queda subido y activo
 * (evidencia "flotante" sin control/envío que la reclame): riesgo conocido y
 * aceptado, igual que en `CompleteDrillDialog` — no lo resuelve esta función.
 */
export async function uploadSlotEvidenceSequentially(
  files: File[],
  uploadOne: UploadOneEvidence,
): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const file of files) {
    const result = await uploadOne(file)
    if (!result.ok) return { ok: false, message: result.message ?? "No se pudo subir la evidencia." }
  }
  return { ok: true }
}
