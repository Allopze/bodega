// @vitest-environment jsdom

/**
 * La captura de la ejecución de una inspección: autoguardado, espejo en el
 * dispositivo y los avisos de cada estado.
 *
 * Lo que persigue cada bloque:
 *
 * - INS-02: `isDirty` se derivaba de `revision > 0`, un contador que nunca se
 *   reiniciaba, así que después de la primera respuesta la pantalla se declaraba
 *   sucia para siempre; y el espejo local volvía a escribirse tras borrarse.
 * - P0-1: el borrador recuperado decía «Guardado» y nunca llegaba al servidor.
 * - P1-1: una fila inválida detenía el guardado de toda la inspección.
 * - P1-2: sin conexión, «Guardar» reemplazaba la pantalla por el error boundary.
 * - P1-4: un conflicto de versión se reintentaba sin fin y recargar perdía el borrador.
 * - P1-7: en el teléfono no existía el rótulo de guardado.
 *
 * Los ítems son de texto o numéricos a propósito: los puntuables se responden
 * con un `Select` de Radix, que en jsdom no abre su popover. El camino que se
 * prueba —editar sube `revision` y dispara el debounce— es el mismo.
 */

import * as React from "react"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
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
  removeAnswerEvidenceAction: otraAccion(),
  removeDeviationAction: otraAccion(),
  reopenInspectionRunAction: otraAccion(),
  reviewInspectionRunAction: otraAccion(),
  saveInspectionParticipantsAction: otraAccion(),
  stopVehicleForFindingAction: otraAccion(),
}))

const routerRefresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh, push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("@/lib/pwa/image-compress", () => ({
  compressPhoto: (file: File) => Promise.resolve(file),
}))

const { InspectionRunDetail } = await import("./inspection-run-detail")
const { readInspectionDrafts, writeInspectionDraft } = await import("@/lib/prevention/inspection-draft-storage")

type DetailProps = React.ComponentProps<typeof InspectionRunDetail>

const RUN_ID = "run-autosave-test"

const ITEM_TEXTO = { id: "item-1", label: "Observaciones", kind: "text" as const, required: false, countsForCompliance: false, danoPotencial: null }
const ITEM_NOTA = { id: "item-2", label: "Otra nota", kind: "text" as const, required: false, countsForCompliance: false, danoPotencial: null }
const ITEM_NUMERO = { id: "item-3", label: "Horómetro", kind: "number" as const, required: false, countsForCompliance: false, danoPotencial: null }

const SECCION_UN_ITEM = [{ id: "sec-1", title: "Sección única", items: [ITEM_TEXTO] }]
const SECCION_DOS_TEXTOS = [{ id: "sec-1", title: "Sección única", items: [ITEM_TEXTO, ITEM_NOTA] }]
const SECCION_TEXTO_Y_NUMERO = [{ id: "sec-1", title: "Sección única", items: [ITEM_TEXTO, ITEM_NUMERO] }]

function respuestaDelServidor(itemId: string, value: string, answerId = `ans-${itemId}`) {
  return { answerId, sectionId: "sec-1", itemId, result: "recorded", comment: null, value, evidence: [], needsConfirmation: false }
}

function filaDelEspejo(value: string) {
  return { result: "recorded", comment: "", value, needsConfirmation: false }
}

function propsDelDetalle(overrides: Partial<DetailProps> = {}): DetailProps {
  return {
    run: {
      id: RUN_ID, code: "INS-TEST-001", status: "in_progress", origin: "programada",
      subjectType: null, subjectLabel: null, subjectResourceId: null, subjectVehicleId: null,
      scheduledFor: null, executedAt: null, reviewedAt: null, reviewComment: null,
      conformingCount: 0, partialCount: 0, nonConformingCount: 0, notApplicableCount: 0,
      compliancePercent: null, officialComplianceBasisPoints: null, normalizedComplianceBasisPoints: null,
      executedByUserId: null, executorOfRecord: null, closingResult: null, closingRestrictions: null, closingSignatures: null,
      locationLatitude: null, locationLongitude: null, version: 1,
    },
    templateKind: "inspection",
    recordsDeviations: false,
    recordsPreventiveActions: false,
    deviationCatalog: [],
    pdtpActivityNumbers: [],
    pdtpReviewActivityNumbers: [],
    worksiteName: "Faena de prueba",
    assigneeName: null,
    executorName: null,
    reviewerName: null,
    sections: SECCION_UN_ITEM,
    answers: [],
    findings: [],
    isUnplannedInspection: false,
    participants: [],
    currentUserId: "user-1",
    assignees: [],
    reviewers: [],
    canExecute: true,
    canReview: false,
    canManage: false,
    canRequestRecharge: false,
    canStopVehicle: false,
    documents: [],
    canIngest: false,
    closingAct: null,
    physicalSourceRequired: false,
    ...overrides,
  }
}

/** Con la versión del run cambiada: lo que llega tras un `router.refresh()`. */
function conVersion(version: number, overrides: Partial<DetailProps> = {}): Partial<DetailProps> {
  const base = propsDelDetalle()
  return { ...overrides, run: { ...base.run, ...overrides.run, version } }
}

/**
 * Monta y deja correr los microtasks del montaje: la lectura de la cola de
 * cierres y la restauración del espejo. El autoguardado no arma su temporizador
 * hasta que ambas terminan, y con el reloj falso un temporizador armado después
 * de una ventana ya vencida no dispararía.
 */
async function montar(overrides: Partial<DetailProps> = {}, options: { strict?: boolean } = {}) {
  const tree = (extra: Partial<DetailProps> = overrides) => {
    const element = <InspectionRunDetail {...propsDelDetalle(extra)} />
    return options.strict ? <React.StrictMode>{element}</React.StrictMode> : element
  }
  const view = render(tree())
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  return {
    ...view,
    async volverAMontar(extra: Partial<DetailProps>) {
      view.rerender(tree({ ...overrides, ...extra }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    },
  }
}

/** Escribe en el campo de un ítem; hay dos árboles (tarjetas y tabla) y basta uno. */
function responder(etiqueta: string, texto: string) {
  const campo = screen.getAllByLabelText(`Respuesta de ${etiqueta}`)[0]!
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

function etiquetasDeEstado() {
  return screen.getAllByRole("status").map((nodo) => nodo.textContent)
}

function ultimoEnvio() {
  const llamadas = saveInspectionAnswersAction.mock.calls
  return llamadas[llamadas.length - 1]?.[0] as {
    expectedVersion: number
    answers: { itemId: string; result: string; value: string | null; comment: string | null }[]
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  saveInspectionAnswersAction.mockReset()
  routerRefresh.mockReset()
  // La acción responde tras un tick del reloj, no de inmediato: un mock que
  // resuelve en el mismo microtask deja que React agrupe `pending` true y false
  // en un solo render, el efecto del hook nunca se vuelve a armar y el bucle que
  // este archivo persigue no se reproduce. Una Server Action real siempre
  // atraviesa al menos un viaje de red.
  saveInspectionAnswersAction.mockImplementation(
    () => new Promise((resolve) => { setTimeout(() => resolve({ ok: true, data: { version: 2, answerRefs: [] } }), 50) }),
  )
  // El espejo vive en `localStorage` y el id de pestaña en `sessionStorage`:
  // limpiar sólo uno deja pasar el espejo de la prueba anterior.
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("autoguardado de la ejecución de una inspección", () => {
  it("guarda una vez tras editar y no vuelve a guardar sin nuevas ediciones", async () => {
    await montar()
    responder("Observaciones", "Todo en orden")

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
    await montar()
    responder("Observaciones", "Todo en orden")

    const conCambios = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(conCambios)
    expect(conCambios.defaultPrevented).toBe(true)

    await dejarCorrerElDebounce()

    const yaGuardado = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(yaGuardado)
    expect(yaGuardado.defaultPrevented).toBe(false)
  })

  it("vuelve a guardar cuando hay una edición nueva", async () => {
    await montar()
    responder("Observaciones", "Primera respuesta")
    await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)

    responder("Observaciones", "Respuesta corregida")
    await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(2)
  })

  it("el rótulo vuelve a 'Guardado' en vez de quedarse en 'Cambios sin guardar'", async () => {
    await montar()
    responder("Observaciones", "Todo en orden")
    await dejarCorrerElDebounce()

    expect(etiquetasDeEstado()).toContain("Guardado")
    expect(screen.queryByText("Cambios sin guardar")).toBeNull()
  })

  it("un guardado exitoso deja el espejo del dispositivo vacío", async () => {
    await montar()
    responder("Observaciones", "Todo en orden")
    // Editar escribe el espejo antes de intentar el envío: en terreno es lo
    // único que sobrevive a cerrar la pestaña sin señal.
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(1)

    await dejarCorrerElDebounce()
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
  })

  it("el botón Guardar guarda ya, sin esperar el debounce, y limpia el espejo", async () => {
    await montar()
    responder("Observaciones", "Todo en orden")
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(1)

    // Se guarda a mano antes de que venza el debounce, que es el caso real:
    // la persona no espera 1200 ms, aprieta el botón.
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Guardar respuestas" })[0]!)
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
    expect(etiquetasDeEstado()).toContain("Guardado")
  })
})

/**
 * P0-1: el borrador recuperado se pintaba y el rótulo decía «Guardado» sin que
 * nada lo enviara. Quien recargaba antes de que venciera el debounce, y se iba,
 * perdía la respuesta: el espejo vivía en `sessionStorage` y un contexto nuevo
 * veía el ítem «Sin responder».
 */
describe("restauración del borrador del dispositivo (P0-1)", () => {
  it("misma versión y con diferencias: se aplica, dice «Cambios sin guardar» y se envía solo", async () => {
    writeInspectionDraft(RUN_ID, { version: 1, userId: "user-1", drafts: { "sec-1::item-1": filaDelEspejo("Texto recuperado") } })

    await montar()

    expect(screen.getAllByLabelText("Respuesta de Observaciones")[0]).toHaveValue("Texto recuperado")
    // Hay un borrador sin enviar: no puede decir «Guardado».
    expect(etiquetasDeEstado()).toContain("Cambios sin guardar")
    expect(etiquetasDeEstado()).not.toContain("Guardado")
    expect(screen.getByText("Recuperamos cambios de este dispositivo que no alcanzaron a enviarse. Se están guardando.")).toBeInTheDocument()
    // El espejo sigue ahí mientras no se envíe.
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(1)

    await dejarCorrerElDebounce()

    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    expect(ultimoEnvio()).toMatchObject({
      expectedVersion: 1,
      answers: [{ itemId: "item-1", result: "recorded", value: "Texto recuperado" }],
    })
    expect(etiquetasDeEstado()).toContain("Guardado")
    // Ya no hay nada que rescatar, y el aviso de «se están guardando» tampoco aplica.
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
    expect(screen.queryByText(/Recuperamos cambios de este dispositivo/)).toBeNull()
  })

  it("restaura una sola vez aunque el árbol se monte dos veces (StrictMode)", async () => {
    writeInspectionDraft(RUN_ID, { version: 1, userId: "user-1", drafts: { "sec-1::item-1": filaDelEspejo("Texto recuperado") } })

    await montar({}, { strict: true })
    await dejarCorrerElDebounce()

    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    expect(screen.getAllByLabelText("Respuesta de Observaciones")[0]).toHaveValue("Texto recuperado")
  })

  it("versión distinta y con diferencias: no se aplica ni se guarda hasta «Recuperar mis cambios»", async () => {
    writeInspectionDraft(RUN_ID, { version: 1, userId: "user-1", drafts: { "sec-1::item-1": filaDelEspejo("Texto del dispositivo") } })

    await montar(conVersion(2))

    // Se apartó con otra clave y no se pisó lo que el servidor tiene.
    expect(screen.getAllByLabelText("Respuesta de Observaciones")[0]).toHaveValue("")
    expect(screen.getByText("Hay cambios de este dispositivo sin enviar")).toBeInTheDocument()
    expect(screen.getByText(/después de esos cambios \(1 respuesta\)\./)).toBeInTheDocument()
    expect(readInspectionDrafts(RUN_ID).map((entry) => entry.pending)).toEqual([true])

    for (let vuelta = 0; vuelta < 5; vuelta += 1) await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Recuperar mis cambios" }))
    expect(screen.getAllByLabelText("Respuesta de Observaciones")[0]).toHaveValue("Texto del dispositivo")
    await dejarCorrerElDebounce()

    // Se guarda sobre la versión vigente, no sobre la del espejo.
    expect(ultimoEnvio()).toMatchObject({
      expectedVersion: 2,
      answers: [{ itemId: "item-1", value: "Texto del dispositivo" }],
    })
    expect(screen.queryByText("Hay cambios de este dispositivo sin enviar")).toBeNull()
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
  })

  it("versión distinta: «Descartar» borra el espejo apartado sin guardar nada", async () => {
    writeInspectionDraft(RUN_ID, { version: 1, userId: "user-1", drafts: { "sec-1::item-1": filaDelEspejo("Texto del dispositivo") } })
    await montar(conVersion(2))

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    await dejarCorrerElDebounce()

    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
    expect(screen.queryByText("Hay cambios de este dispositivo sin enviar")).toBeNull()
  })

  it("versión distinta pero sin diferencias con el servidor: se limpia en silencio", async () => {
    writeInspectionDraft(RUN_ID, { version: 1, userId: "user-1", drafts: { "sec-1::item-1": filaDelEspejo("Igual") } })

    await montar(conVersion(2, { answers: [respuestaDelServidor("item-1", "Igual")] }))
    await dejarCorrerElDebounce()

    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
    expect(screen.queryByText("Hay cambios de este dispositivo sin enviar")).toBeNull()
    expect(screen.queryByText(/Recuperamos cambios/)).toBeNull()
    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()
  })

  it("el espejo de otro usuario se descarta en silencio", async () => {
    writeInspectionDraft(RUN_ID, { version: 1, userId: "otra-persona", drafts: { "sec-1::item-1": filaDelEspejo("Ajeno") } })

    await montar()
    await dejarCorrerElDebounce()

    expect(screen.getAllByLabelText("Respuesta de Observaciones")[0]).toHaveValue("")
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()
  })

  it("con la ejecución ya cerrada avisa que no se pueden guardar y los limpia", async () => {
    writeInspectionDraft(RUN_ID, { version: 1, userId: "user-1", drafts: { "sec-1::item-1": filaDelEspejo("Tarde") } })

    await montar({ run: { ...propsDelDetalle().run, status: "completed", version: 3 } })

    expect(screen.getByText("Había cambios de este dispositivo sin enviar que ya no se pueden guardar porque la inspección está pendiente de revisión.")).toBeInTheDocument()
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()
  })
})

/**
 * P1-1: con una fila inválida el autoguardado se apagaba y «Guardar» se
 * deshabilitaba. Un «Malo» sin motivo en el ítem 3 congelaba el envío de los
 * ítems 4 a 75, y la sesión siguiente los encontraba «Sin responder».
 */
describe("una fila inválida no frena a las demás (P1-1)", () => {
  async function responderTextoYNumeroInvalido() {
    await montar({ sections: SECCION_TEXTO_Y_NUMERO })
    responder("Observaciones", "Todo en orden")
    // «134.122» en el papel son ciento treinta y cuatro mil: se rechaza.
    responder("Horómetro", "134.122")
  }

  it("guarda sólo la fila válida, dice cuántas faltan y no entra en bucle", async () => {
    await responderTextoYNumeroInvalido()
    await dejarCorrerElDebounce()

    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    expect(ultimoEnvio().answers).toHaveLength(1)
    expect(ultimoEnvio().answers[0]).toMatchObject({ itemId: "item-1", value: "Todo en orden" })
    expect(etiquetasDeEstado()).toContain("Guardado, salvo 1 respuesta incompleta")

    for (let vuelta = 0; vuelta < 10; vuelta += 1) await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
  })

  it("avisa cuál fila no se guarda, la conserva en el dispositivo y deja «Guardar» disponible", async () => {
    await responderTextoYNumeroInvalido()
    await dejarCorrerElDebounce()

    const aviso = screen.getByText("Respuestas que todavía no se guardan").closest("[role='status']") as HTMLElement
    expect(within(aviso).getByRole("button", { name: /escribe el número sin separador de miles \(134122\)/ })).toBeInTheDocument()
    // Lo que no se envió sigue a salvo en el dispositivo.
    expect(readInspectionDrafts(RUN_ID)[0]?.snapshot.drafts["sec-1::item-3"]).toMatchObject({ value: "134.122" })
    for (const boton of screen.getAllByRole("button", { name: "Guardar respuestas" })) expect(boton).toBeEnabled()
  })

  it("al corregir la fila se guarda también, y el aviso desaparece", async () => {
    await responderTextoYNumeroInvalido()
    await dejarCorrerElDebounce()

    responder("Horómetro", "134122")
    await dejarCorrerElDebounce()

    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(2)
    expect(ultimoEnvio().answers.map((answer) => answer.itemId).sort()).toEqual(["item-1", "item-3"])
    expect(etiquetasDeEstado()).toContain("Guardado")
    expect(screen.queryByText("Respuestas que todavía no se guardan")).toBeNull()
  })
})

/**
 * P1-2: `useOperation` no atrapaba la excepción de la Server Action. Sin
 * señal, `fetch` rechazaba y el error subía hasta el boundary de la ruta, que
 * descartaba la pantalla entera con todo lo que la persona había escrito.
 */
describe("sin conexión (P1-2)", () => {
  it("«Guardar» con una acción que rechaza dice que no hay conexión en vez de romper la pantalla", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false)
    saveInspectionAnswersAction.mockRejectedValue(new TypeError("Failed to fetch"))
    await montar()
    responder("Observaciones", "Todo en orden")

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Guardar respuestas" })[0]!)
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(etiquetasDeEstado()).toContain("Sin conexión · se enviará al volver la señal")
    expect(screen.getByText(/Tus respuestas quedan guardadas en este dispositivo y se enviarán solas al volver la señal/)).toBeInTheDocument()
    // La pantalla sigue en pie, con lo escrito.
    expect(screen.getAllByLabelText("Respuesta de Observaciones")[0]).toHaveValue("Todo en orden")
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(1)
  })

  it("con señal, un fallo de la red se dice «reintentando» y se reintenta con espera", async () => {
    saveInspectionAnswersAction.mockRejectedValue(new TypeError("Failed to fetch"))
    await montar()
    responder("Observaciones", "Todo en orden")

    await dejarCorrerElDebounce()
    expect(etiquetasDeEstado()).toContain("No se pudo guardar · reintentando")
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)

    // Reintenta solo, a 1,2 s y luego a 2,4 s: no en cada ciclo.
    await dejarCorrerElDebounce(1_300)
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(2)
  })

  it("al volver la señal envía lo pendiente sin esperar el resto de la espera", async () => {
    const enLinea = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false)
    saveInspectionAnswersAction.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await montar()
    responder("Observaciones", "Todo en orden")
    await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)

    enLinea.mockReturnValue(true)
    await act(async () => {
      window.dispatchEvent(new Event("online"))
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(2)
    expect(etiquetasDeEstado()).toContain("Guardado")
  })
})

/**
 * P1-4: tras un rechazo permanente (conflicto de versión) el hook rearmaba el
 * temporizador cada ~1,2 s para siempre, y el mensaje pedía «Recarga y
 * reintenta» cuando recargar perdía el borrador.
 */
describe("conflicto de versión (P1-4)", () => {
  const CONFLICTO = {
    ok: false,
    message: "La inspección cambió en otra sesión. Recarga y reintenta.",
    data: { code: "version_conflict" },
  }

  async function provocarConflicto() {
    saveInspectionAnswersAction.mockResolvedValue(CONFLICTO)
    const vista = await montar({ sections: SECCION_DOS_TEXTOS })
    responder("Observaciones", "Lo mío")
    await dejarCorrerElDebounce()
    return vista
  }

  it("hace una sola llamada, avisa con las dos salidas y conserva el espejo", async () => {
    await provocarConflicto()

    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    for (let vuelta = 0; vuelta < 10; vuelta += 1) await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)

    const alerta = screen.getByRole("alert")
    expect(alerta).toHaveTextContent("La inspección cambió en otra sesión")
    expect(alerta).toHaveTextContent("Tus cambios sin guardar siguen en este dispositivo.")
    expect(within(alerta).getByRole("button", { name: "Recuperar mis cambios" })).toBeInTheDocument()
    expect(within(alerta).getByRole("button", { name: "Descartar mis cambios" })).toBeInTheDocument()
    expect(etiquetasDeEstado()).toContain("Cambió en otra sesión")
    // Pide al servidor su versión de una vez, sin recargar la página.
    expect(routerRefresh).toHaveBeenCalled()
    // Lo escrito sigue en el dispositivo.
    expect(readInspectionDrafts(RUN_ID)[0]?.snapshot.drafts["sec-1::item-1"]).toMatchObject({ value: "Lo mío" })
    // Y la pestaña sigue avisando antes de cerrarse.
    const salida = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(salida)
    expect(salida.defaultPrevented).toBe(true)
  })

  it("«Recuperar» tras recibir la versión nueva envía lo del servidor más lo propio", async () => {
    const vista = await provocarConflicto()
    saveInspectionAnswersAction.mockClear()
    saveInspectionAnswersAction.mockImplementation(
      () => new Promise((resolve) => { setTimeout(() => resolve({ ok: true, data: { version: 4, answerRefs: [] } }), 50) }),
    )

    // Llega el refresco: otra sesión guardó la v3 con «Otra nota».
    await vista.volverAMontar(conVersion(3, { sections: SECCION_DOS_TEXTOS, answers: [respuestaDelServidor("item-2", "Del otro inspector")] }))
    // Todavía no se envía nada: la persona decide.
    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("La inspección cambió en otra sesión")

    fireEvent.click(screen.getByRole("button", { name: "Recuperar mis cambios" }))
    expect(screen.getAllByLabelText("Respuesta de Otra nota")[0]).toHaveValue("Del otro inspector")
    expect(screen.getAllByLabelText("Respuesta de Observaciones")[0]).toHaveValue("Lo mío")
    await dejarCorrerElDebounce()

    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    const envio = ultimoEnvio()
    expect(envio.expectedVersion).toBe(3)
    expect(envio.answers.map((answer) => [answer.itemId, answer.value]).sort()).toEqual([
      ["item-1", "Lo mío"],
      ["item-2", "Del otro inspector"],
    ])
    expect(screen.queryByRole("alert")).toBeNull()
    expect(etiquetasDeEstado()).toContain("Guardado")
  })

  it("«Descartar» se queda con lo del servidor y limpia el espejo", async () => {
    const vista = await provocarConflicto()
    saveInspectionAnswersAction.mockClear()

    await vista.volverAMontar(conVersion(3, { sections: SECCION_DOS_TEXTOS, answers: [respuestaDelServidor("item-2", "Del otro inspector")] }))
    fireEvent.click(screen.getByRole("button", { name: "Descartar mis cambios" }))
    await dejarCorrerElDebounce()

    expect(screen.getAllByLabelText("Respuesta de Observaciones")[0]).toHaveValue("")
    expect(screen.getAllByLabelText("Respuesta de Otra nota")[0]).toHaveValue("Del otro inspector")
    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("si el servidor devuelve exactamente lo que se envió, no hay conflicto y se adopta la versión", async () => {
    // El envío llegó pero la respuesta se perdió: el reintento choca con su propio guardado.
    const vista = await provocarConflicto()
    saveInspectionAnswersAction.mockClear()

    await vista.volverAMontar(conVersion(2, { sections: SECCION_DOS_TEXTOS, answers: [respuestaDelServidor("item-1", "Lo mío")] }))

    expect(screen.queryByRole("alert")).toBeNull()
    expect(etiquetasDeEstado()).toContain("Guardado")
    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()
  })

  it("una inspección que ya no se puede editar lo dice y no reintenta", async () => {
    saveInspectionAnswersAction.mockResolvedValue({
      ok: false,
      message: "No se pueden modificar respuestas de una inspección completada, cerrada o cancelada.",
      data: { code: "not_editable" },
    })
    await montar()
    responder("Observaciones", "Tarde")
    await dejarCorrerElDebounce()

    for (let vuelta = 0; vuelta < 5; vuelta += 1) await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("alert")).toHaveTextContent("Esta inspección ya no se puede editar")
    expect(screen.getByRole("button", { name: "Ver la versión actual" })).toBeInTheDocument()
    expect(etiquetasDeEstado()).toContain("Ya no se puede editar")
  })

  it("un rechazo del servidor sin código se dice con su mensaje y «Reintentar», sin bucle", async () => {
    saveInspectionAnswersAction.mockResolvedValue({ ok: false, message: "Para dejar «X» sin responder, quita primero sus fotos." })
    await montar()
    responder("Observaciones", "Algo")
    await dejarCorrerElDebounce()

    for (let vuelta = 0; vuelta < 5; vuelta += 1) await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("alert")).toHaveTextContent("Para dejar «X» sin responder, quita primero sus fotos.")
    expect(etiquetasDeEstado()).toContain("No se pudo guardar")

    saveInspectionAnswersAction.mockResolvedValue({ ok: true, data: { version: 2, answerRefs: [] } })
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Reintentar" }))
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(2)
    expect(etiquetasDeEstado()).toContain("Guardado")
  })
})

/**
 * P1-7: el rótulo de guardado era `hidden md:inline` y la barra fija del
 * teléfono sólo traía los botones: quien trabaja de pie, con el aparato en la
 * mano, no veía si podía irse de la pantalla.
 */
describe("barra de acciones del teléfono (P1-7)", () => {
  function barraMovil() {
    return screen.getByRole("group", { name: "Acciones de la inspección en el teléfono" })
  }

  it("muestra el mismo estado de guardado que el escritorio", async () => {
    await montar()
    expect(within(barraMovil()).getByText("Guardado")).toBeInTheDocument()

    responder("Observaciones", "Todo en orden")
    expect(within(barraMovil()).getByText("Cambios sin guardar")).toBeInTheDocument()

    await dejarCorrerElDebounce()
    expect(within(barraMovil()).getByText("Guardado")).toBeInTheDocument()
  })

  it("«Guardar» de la barra nunca queda deshabilitado por una fila con problemas", async () => {
    await montar({ sections: SECCION_TEXTO_Y_NUMERO })
    responder("Horómetro", "134.122")
    await dejarCorrerElDebounce()

    expect(within(barraMovil()).getByRole("button", { name: "Guardar" })).toBeEnabled()
    expect(within(barraMovil()).getByText("Guardado, salvo 1 respuesta incompleta")).toBeInTheDocument()
    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()
  })
})

/**
 * P2-9: el espejo cubría sólo las respuestas. El acta, la ubicación y los
 * participantes tecleados y no enviados se perdían al recargar.
 */
describe("lo que no son respuestas también se conserva (P2-9)", () => {
  const ACTA = {
    title: "Acta de cierre",
    resultOptions: [{ value: "apto", label: "Apto" }],
    hasRestrictions: true,
    signatureRoles: [],
  }

  it("el acta sin enviar entra al espejo y se restaura al volver a abrir la pantalla", async () => {
    const primera = await montar({ closingAct: ACTA })
    fireEvent.change(screen.getByLabelText("Restricciones del acta"), { target: { value: "Sin andamio certificado" } })

    expect(readInspectionDrafts(RUN_ID)[0]?.snapshot.closing).toMatchObject({ restrictions: "Sin andamio certificado" })
    primera.unmount()

    await montar({ closingAct: ACTA })
    expect(screen.getByLabelText("Restricciones del acta")).toHaveValue("Sin andamio certificado")
  })

  it("la ubicación capturada sube la revisión y viaja en el guardado", async () => {
    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok: (position: unknown) => void) => ok({ coords: { latitude: -33.4489, longitude: -70.6693 } }) },
    })
    await montar()

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Capturar ubicación" })) })
    expect(etiquetasDeEstado()).toContain("Cambios sin guardar")
    expect(readInspectionDrafts(RUN_ID)[0]?.snapshot.coords).toEqual({ lat: "-33.448900", lon: "-70.669300" })

    await dejarCorrerElDebounce()

    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    expect(saveInspectionAnswersAction.mock.calls[0]?.[0]).toMatchObject({ locationLatitude: "-33.448900", locationLongitude: "-70.669300" })
    expect(etiquetasDeEstado()).toContain("Guardado")
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
  })

  it("los participantes sin guardar entran al espejo", async () => {
    await montar({ recordsDeviations: true, isUnplannedInspection: true })

    fireEvent.click(screen.getByRole("button", { name: "Agregar participante" }))
    fireEvent.change(screen.getByLabelText(/Nombre 1/), { target: { value: "Ana Pérez" } })
    fireEvent.change(screen.getByLabelText(/Cargo/), { target: { value: "Supervisora" } })

    expect(readInspectionDrafts(RUN_ID)[0]?.snapshot.participants).toMatchObject([{ name: "Ana Pérez", position: "Supervisora" }])
  })
})

describe("rótulos de la pantalla", () => {
  it("«Obligatorio» sale de los ítems que el cierre exige, no sólo de `required` (L4)", async () => {
    await montar({
      sections: [{
        id: "sec-1",
        title: "EPP",
        items: [{ id: "item-1", label: "Casco", required: false, countsForCompliance: true, danoPotencial: null }],
      }],
    })

    expect(screen.getAllByText("Obligatorio").length).toBeGreaterThan(0)
    expect(screen.queryByText("Opcional")).toBeNull()
  })

  it("quien ejecutó y no puede revisarse a sí mismo lo lee con el texto de autorrevisión", async () => {
    await montar({
      canReview: true,
      run: { ...propsDelDetalle().run, status: "completed", executedByUserId: "user-1", executedAt: "2026-10-19T12:00:00Z" },
      executorName: "Inspector Uno",
    })

    expect(screen.getByText("Tú ejecutaste esta inspección: debe revisarla y cerrarla otra persona con permiso de revisión.", { exact: false })).toBeInTheDocument()
  })

  it("en modo lectura una opción se lee por su etiqueta y no por el valor almacenado (P2-2)", async () => {
    await montar({
      canExecute: false,
      run: { ...propsDelDetalle().run, status: "completed" },
      sections: [{
        id: "sec-1",
        title: "Extintores",
        items: [{
          id: "item-1", label: "Tipo de agente", kind: "select", required: false, countsForCompliance: false, danoPotencial: null,
          options: [{ value: "pqs", label: "PQS (Polvo Químico Seco)" }],
        }],
      }],
      answers: [respuestaDelServidor("item-1", "pqs")],
    })

    expect(screen.getAllByText("PQS (Polvo Químico Seco)").length).toBeGreaterThan(0)
    expect(screen.queryByText("pqs")).toBeNull()
  })
})
