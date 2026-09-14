// @vitest-environment jsdom

/**
 * INS-02: el autoguardado de la pantalla de ejecución quedaba sucio para
 * siempre.
 *
 * `isDirty` se derivaba de `revision > 0` —un contador que sube en cada edición
 * y que nunca se reiniciaba—, así que después de la primera respuesta la
 * pantalla se declaraba sucia por el resto de la sesión: el rótulo decía
 * "Cambios sin guardar" justo después de guardar y el `beforeunload` del hook
 * retenía cada salida del navegador con todo ya persistido.
 *
 * El segundo bug es el espejo local: `clearInspectionDraft` sólo se llamaba
 * desde el autoguardado, y el efecto que escribe el espejo depende de `version`
 * —que un guardado exitoso sube—, así que volvía a escribir lo que se acababa
 * de borrar. Al remontar, la pantalla avisaba "Se recuperaron respuestas sin
 * enviar de este dispositivo" sobre respuestas ya persistidas.
 */

import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const saveInspectionAnswersAction = vi.fn()

const otraAccion = () => vi.fn().mockResolvedValue({ ok: true })

vi.mock("../actions", () => ({
  saveInspectionAnswersAction,
  cancelInspectionRunAction: otraAccion(),
  closeInspectionFindingAction: otraAccion(),
  completeInspectionRunAction: otraAccion(),
  createFindingCapaAction: otraAccion(),
  registerDeviationAction: otraAccion(),
  registerInspectionPreventiveActionAction: otraAccion(),
  remindInspectionReviewAction: otraAccion(),
  removeDeviationAction: otraAccion(),
  reopenInspectionRunAction: otraAccion(),
  reviewInspectionRunAction: otraAccion(),
  saveInspectionParticipantsAction: otraAccion(),
  stopVehicleForFindingAction: otraAccion(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("@/lib/pwa/image-compress", () => ({
  compressPhoto: (file: File) => Promise.resolve(file),
}))

const { InspectionRunDetail } = await import("./inspection-run-detail")
const { readInspectionDraft } = await import("@/lib/prevention/inspection-draft-storage")

const RUN_ID = "run-autosave-test"

/**
 * Un solo ítem de texto libre, a propósito: los puntuables se responden con un
 * `Select` de Radix, que en jsdom no abre su popover. El camino que se prueba
 * —editar sube `revision` y dispara el debounce— es el mismo.
 */
function renderRun() {
  return render(
    <InspectionRunDetail
      run={{
        id: RUN_ID, code: "INS-TEST-001", status: "in_progress", origin: "programada",
        subjectType: null, subjectLabel: null, subjectResourceId: null, subjectVehicleId: null,
        scheduledFor: null, executedAt: null, reviewedAt: null, reviewComment: null,
        conformingCount: 0, partialCount: 0, nonConformingCount: 0, notApplicableCount: 0,
        compliancePercent: null, officialComplianceBasisPoints: null, normalizedComplianceBasisPoints: null,
        executedByUserId: null, closingResult: null, closingRestrictions: null, closingSignatures: null,
        locationLatitude: null, locationLongitude: null, version: 1,
      }}
      templateKind="inspection"
      recordsDeviations={false}
      recordsPreventiveActions={false}
      deviationCatalog={[]}
      pdtpActivityNumbers={[]}
      pdtpReviewActivityNumbers={[]}
      worksiteName="Faena de prueba"
      assigneeName={null}
      executorName={null}
      reviewerName={null}
      sections={[{
        id: "sec-1",
        title: "Sección única",
        items: [{
          id: "item-1", label: "Observaciones", kind: "text",
          required: false, countsForCompliance: false, danoPotencial: null,
        }],
      }]}
      answers={[]}
      findings={[]}
      isUnplannedInspection={false}
      participants={[]}
      currentUserId="user-1"
      assignees={[]}
      reviewers={[]}
      canExecute
      canReview={false}
      canManage={false}
      canRequestRecharge={false}
      canStopVehicle={false}
      documents={[]}
      canIngest={false}
      closingAct={null}
      physicalSourceRequired={false}
    />,
  )
}

/** Escribe en el campo del ítem; hay dos árboles (tarjetas y tabla) y basta uno. */
function responder(texto: string) {
  const campo = screen.getAllByLabelText("Respuesta de Observaciones")[0]!
  fireEvent.change(campo, { target: { value: texto } })
}

/**
 * Deja correr el debounce (1200 ms) y la promesa del guardado.
 *
 * `advanceTimersByTimeAsync` y no la versión síncrona: el hook vuelve a armar
 * su temporizador recién cuando `pending` cae a false, y eso ocurre en un
 * microtask posterior a que resuelva la acción. Con la variante síncrona el
 * re-armado quedaba fuera de la ventana y el bucle infinito no se reproducía.
 */
async function dejarCorrerElDebounce(ms = 1_500) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

beforeEach(() => {
  vi.useFakeTimers()
  saveInspectionAnswersAction.mockReset()
  // La acción responde tras un tick del reloj, no de inmediato: un mock que
  // resuelve en el mismo microtask deja que React agrupe `pending` true y false
  // en un solo render, el efecto del hook nunca se vuelve a armar y el bucle que
  // este archivo persigue no se reproduce. Una Server Action real siempre
  // atraviesa al menos un viaje de red.
  saveInspectionAnswersAction.mockImplementation(
    () => new Promise((resolve) => { setTimeout(() => resolve({ ok: true, data: { version: 2, answerRefs: [] } }), 50) }),
  )
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("autoguardado de la ejecución de una inspección", () => {
  it("guarda una vez tras editar y no vuelve a guardar sin nuevas ediciones", async () => {
    renderRun()
    responder("Todo en orden")

    await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)

    for (let vuelta = 0; vuelta < 10; vuelta += 1) await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
  })

  /**
   * La consecuencia visible de que `isDirty` no se apagara: el hook registra un
   * `beforeunload` que cancela la salida mientras haya algo sin guardar, así
   * que con todo persistido el navegador seguía preguntando "¿seguro que
   * quieres salir?" en cada navegación de la sesión.
   */
  it("deja de retener la salida del navegador una vez guardado", async () => {
    renderRun()
    responder("Todo en orden")

    const conCambios = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(conCambios)
    expect(conCambios.defaultPrevented).toBe(true)

    await dejarCorrerElDebounce()

    const yaGuardado = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(yaGuardado)
    expect(yaGuardado.defaultPrevented).toBe(false)
  })

  it("vuelve a guardar cuando hay una edición nueva", async () => {
    renderRun()
    responder("Primera respuesta")
    await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)

    responder("Respuesta corregida")
    await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(2)
  })

  it("el rótulo vuelve a 'Guardado' en vez de quedarse en 'Cambios sin guardar'", async () => {
    renderRun()
    responder("Todo en orden")
    await dejarCorrerElDebounce()

    expect(screen.getAllByText("Guardado").length).toBeGreaterThan(0)
    expect(screen.queryByText("Cambios sin guardar")).toBeNull()
  })

  it("un guardado exitoso deja el espejo del dispositivo vacío", async () => {
    renderRun()
    responder("Todo en orden")
    // Editar escribe el espejo antes de intentar el envío: en terreno es lo
    // único que sobrevive a cerrar la pestaña sin señal.
    expect(readInspectionDraft(RUN_ID)).not.toBeNull()

    await dejarCorrerElDebounce()
    expect(readInspectionDraft(RUN_ID)).toBeNull()
  })

  it("el botón Guardar también limpia el espejo del dispositivo", async () => {
    renderRun()
    responder("Todo en orden")
    expect(readInspectionDraft(RUN_ID)).not.toBeNull()

    // Se guarda a mano antes de que venza el debounce, que es el caso real:
    // la persona no espera 1200 ms, aprieta el botón.
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[0]!)
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    expect(readInspectionDraft(RUN_ID)).toBeNull()
  })
})
