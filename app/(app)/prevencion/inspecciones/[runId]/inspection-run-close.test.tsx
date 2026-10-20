// @vitest-environment jsdom
import "fake-indexeddb/auto"

/**
 * El cierre de una inspección: declarar ejecutada con conexión y el cierre
 * guardado en el dispositivo cuando no la hay (P1-5).
 *
 * Va aparte de `inspection-run-autosave.test.tsx` porque necesita IndexedDB
 * (la cola del cierre) y esa librería programa con temporizadores reales, que
 * el reloj falso del otro archivo dejaría colgados.
 *
 * Qué persigue:
 * - un cierre guardado en una sesión anterior se envía al abrir la pantalla, sin
 *   esperar un evento `online` que con señal nunca llega;
 * - un cierre que el servidor rechaza se dice con su motivo y se puede recuperar;
 * - mientras hay un cierre guardado la edición queda bloqueada y el autoguardado
 *   no compite por la misma versión;
 * - declarar ejecutada deja guardado lo último antes de cerrar.
 */

import * as React from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const saveInspectionAnswersAction = vi.fn()
const completeInspectionRunAction = vi.fn()
const saveInspectionParticipantsAction = vi.fn()
const toastSuccess = vi.fn()

const otraAccion = () => vi.fn().mockResolvedValue({ ok: true })

vi.mock("../actions", () => ({
  saveInspectionAnswersAction,
  completeInspectionRunAction,
  cancelInspectionRunAction: otraAccion(),
  closeInspectionFindingAction: otraAccion(),
  createFindingCapaAction: otraAccion(),
  registerDeviationAction: otraAccion(),
  registerInspectionPreventiveActionAction: otraAccion(),
  remindInspectionReviewAction: otraAccion(),
  removeAnswerEvidenceAction: otraAccion(),
  removeDeviationAction: otraAccion(),
  reopenInspectionRunAction: otraAccion(),
  reviewInspectionRunAction: otraAccion(),
  saveInspectionParticipantsAction,
  stopVehicleForFindingAction: otraAccion(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}))

vi.mock("@/lib/pwa/image-compress", () => ({
  compressPhoto: (file: File) => Promise.resolve(file),
}))

const { InspectionRunDetail } = await import("./inspection-run-detail")
const { clearInspectionSubmissionQueue, getQueuedInspectionSubmission, queueInspectionSubmission } = await import("./offline-inspection-queue")
const { readInspectionDrafts } = await import("@/lib/prevention/inspection-draft-storage")

type DetailProps = React.ComponentProps<typeof InspectionRunDetail>

const RUN_ID = "run-close-test"
const USER = "user-1"

const ITEM_TEXTO = { id: "item-1", label: "Observaciones", kind: "text" as const, required: false, countsForCompliance: false, danoPotencial: null }
const ITEM_NUMERO = { id: "item-3", label: "Horómetro", kind: "number" as const, required: false, countsForCompliance: false, danoPotencial: null }

function propsDelDetalle(overrides: Partial<DetailProps> = {}): DetailProps {
  return {
    run: {
      id: RUN_ID, code: "INS-CIERRE-001", status: "in_progress", origin: "programada",
      subjectType: null, subjectLabel: null, subjectResourceId: null, subjectVehicleId: null,
      scheduledFor: null, executedAt: null, reviewedAt: null, reviewComment: null,
      conformingCount: 0, partialCount: 0, nonConformingCount: 0, notApplicableCount: 0,
      compliancePercent: null, officialComplianceBasisPoints: null, normalizedComplianceBasisPoints: null,
      executedByUserId: null, executorOfRecord: null, closingResult: null, closingRestrictions: null, closingSignatures: null,
      locationLatitude: null, locationLongitude: null, version: 4,
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
    sections: [{ id: "sec-1", title: "Sección única", items: [ITEM_TEXTO, ITEM_NUMERO] }],
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

function montar(overrides: Partial<DetailProps> = {}) {
  return render(<InspectionRunDetail {...propsDelDetalle(overrides)} />)
}

function campo(etiqueta: string) {
  return screen.getAllByLabelText(`Respuesta de ${etiqueta}`)[0] as HTMLInputElement
}

function etiquetasDeEstado() {
  return screen.getAllByRole("status", { hidden: true }).map((nodo) => nodo.textContent)
}

const CIERRE_GUARDADO = {
  runId: RUN_ID,
  expectedVersion: 7,
  answers: [{ sectionId: "sec-1", itemId: "item-1", result: "recorded", value: "Del cierre guardado", comment: null, needsConfirmation: false }],
}

function sinConexion() {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false)
}

function volverLaSenal() {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true)
  act(() => { window.dispatchEvent(new Event("online")) })
}

function abrirElCierre() {
  fireEvent.click(screen.getAllByRole("button", { name: "Declarar ejecutada" })[0]!)
  return screen.getByRole("dialog", { name: /Declarar ejecutada INS-CIERRE-001/ })
}

beforeEach(async () => {
  saveInspectionAnswersAction.mockReset()
  completeInspectionRunAction.mockReset()
  toastSuccess.mockReset()
  saveInspectionAnswersAction.mockResolvedValue({ ok: true, data: { version: 5, answerRefs: [] } })
  completeInspectionRunAction.mockResolvedValue({ ok: true, data: { version: 6 } })
  saveInspectionParticipantsAction.mockReset()
  saveInspectionParticipantsAction.mockResolvedValue({ ok: true })
  window.localStorage.clear()
  window.sessionStorage.clear()
  await clearInspectionSubmissionQueue()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("cierre guardado en el dispositivo (P1-5)", () => {
  it("un cierre guardado antes se envía al abrir la pantalla, con señal y sin esperar el evento «online»", async () => {
    await queueInspectionSubmission(CIERRE_GUARDADO, USER)

    montar()

    await waitFor(() => expect(completeInspectionRunAction).toHaveBeenCalledTimes(1))
    expect(completeInspectionRunAction).toHaveBeenCalledWith(expect.objectContaining({ runId: RUN_ID, expectedVersion: 7 }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Cierre enviado: la inspección quedó declarada ejecutada."))
    expect(await getQueuedInspectionSubmission(RUN_ID, USER)).toBeNull()
    expect(screen.queryByText("Cierre guardado en este dispositivo")).toBeNull()
  })

  it("un cierre que el servidor rechaza se dice con su motivo y se puede recuperar", async () => {
    completeInspectionRunAction.mockResolvedValue({
      ok: false,
      message: "La inspección cambió en otra sesión. Recarga y reintenta.",
      data: { code: "version_conflict" },
    })
    await queueInspectionSubmission(CIERRE_GUARDADO, USER)

    montar()

    const alerta = await screen.findByText("No se pudo enviar el cierre guardado en este dispositivo")
    const panel = alerta.closest("[role='alert']") as HTMLElement
    expect(panel).toHaveTextContent("La inspección cambió en otra sesión.")
    // Se rechazó de una vez, sin reintentos en balde.
    expect(completeInspectionRunAction).toHaveBeenCalledTimes(1)
    expect(etiquetasDeEstado()).toContain("No se pudo guardar")

    fireEvent.click(within(panel).getByRole("button", { name: "Recuperar el cierre" }))

    // Lo guardado vuelve a ser trabajo en pantalla, listo para corregir y volver a declarar.
    await waitFor(() => expect(screen.queryByText("No se pudo enviar el cierre guardado en este dispositivo")).toBeNull())
    expect(campo("Observaciones").value).toBe("Del cierre guardado")
    expect(await getQueuedInspectionSubmission(RUN_ID, USER)).toBeNull()
  })

  it("«Descartar» borra el cierre rechazado sin tocar lo que hay en pantalla", async () => {
    completeInspectionRunAction.mockResolvedValue({ ok: false, message: "No se puede.", data: { code: "not_ready" } })
    await queueInspectionSubmission(CIERRE_GUARDADO, USER)

    montar()
    const alerta = await screen.findByText("No se pudo enviar el cierre guardado en este dispositivo")
    fireEvent.click(within(alerta.closest("[role='alert']") as HTMLElement).getByRole("button", { name: "Descartar" }))

    await waitFor(() => expect(screen.queryByText("No se pudo enviar el cierre guardado en este dispositivo")).toBeNull())
    expect(await getQueuedInspectionSubmission(RUN_ID, USER)).toBeNull()
  })

  it("sin conexión, el diálogo de cierre ofrece guardarlo en el dispositivo y bloquea la edición", async () => {
    sinConexion()
    montar()
    campo("Observaciones")
    fireEvent.change(campo("Observaciones"), { target: { value: "Todo en orden" } })

    const dialogo = abrirElCierre()
    expect(within(dialogo).getByText("Sin conexión. Puedes guardar el cierre en este dispositivo y se enviará solo al volver la señal.")).toBeInTheDocument()
    // Con el aparato sin señal no se intenta enviar: se ofrece sólo guardar.
    expect(within(dialogo).getByRole("button", { name: "Declarar ejecutada" })).toBeDisabled()

    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cierre en este dispositivo" }))

    expect(await screen.findByText("Cierre guardado en este dispositivo")).toBeInTheDocument()
    const guardado = await getQueuedInspectionSubmission(RUN_ID, USER)
    expect(guardado?.payload).toMatchObject({
      runId: RUN_ID,
      expectedVersion: 4,
      answers: [{ itemId: "item-1", result: "recorded", value: "Todo en orden" }],
    })
    expect(etiquetasDeEstado()).toContain("Cierre pendiente de enviar")
    // La edición queda bloqueada y el autoguardado no compite por la versión.
    expect(campo("Observaciones")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Enviar ahora" })).toBeDisabled()
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()
    // Lo escrito sigue a salvo en el dispositivo hasta que el cierre llegue.
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(1)
  })

  it("al volver la señal el cierre guardado se envía solo y limpia el dispositivo", async () => {
    sinConexion()
    montar()
    fireEvent.change(campo("Observaciones"), { target: { value: "Todo en orden" } })
    fireEvent.click(within(abrirElCierre()).getByRole("button", { name: "Guardar cierre en este dispositivo" }))
    await screen.findByText("Cierre guardado en este dispositivo")

    volverLaSenal()

    await waitFor(() => expect(completeInspectionRunAction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText("Cierre guardado en este dispositivo")).toBeNull())
    expect(toastSuccess).toHaveBeenCalledWith("Cierre enviado: la inspección quedó declarada ejecutada.")
    expect(await getQueuedInspectionSubmission(RUN_ID, USER)).toBeNull()
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
  })

  it("«Seguir editando» desbloquea la pantalla y descarta el cierre guardado", async () => {
    sinConexion()
    montar()
    fireEvent.change(campo("Observaciones"), { target: { value: "Todo en orden" } })
    fireEvent.click(within(abrirElCierre()).getByRole("button", { name: "Guardar cierre en este dispositivo" }))
    await screen.findByText("Cierre guardado en este dispositivo")

    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }))

    await waitFor(() => expect(screen.queryByText("Cierre guardado en este dispositivo")).toBeNull())
    expect(campo("Observaciones")).toBeEnabled()
    expect(campo("Observaciones").value).toBe("Todo en orden")
    expect(await getQueuedInspectionSubmission(RUN_ID, USER)).toBeNull()
  })
})

/*
 * Un cierre guardado antes de que el servidor registrara quién lo dejó se enviaba
 * con la sesión de quien abriera cualquier inspección: `executedByUserId` y las
 * firmas quedaban a nombre de otra persona en un registro legal.
 */
describe("cierre guardado por otra persona en este dispositivo", () => {
  it("no se envía al abrir la pantalla, no se muestra y se borra", async () => {
    await queueInspectionSubmission(CIERRE_GUARDADO, "user-2")

    montar()

    await waitFor(async () => expect(await getQueuedInspectionSubmission(RUN_ID, "user-2")).toBeNull())
    expect(completeInspectionRunAction).not.toHaveBeenCalled()
    expect(screen.queryByText("Cierre guardado en este dispositivo")).toBeNull()
    expect(screen.queryByText("No se pudo enviar el cierre guardado en este dispositivo")).toBeNull()
  })

  it("lo de la propia persona sí se sigue enviando aunque haya uno ajeno de otra inspección", async () => {
    await queueInspectionSubmission({ ...CIERRE_GUARDADO, runId: "otra-ejecucion" }, "user-2")
    await queueInspectionSubmission(CIERRE_GUARDADO, USER)

    montar()

    await waitFor(() => expect(completeInspectionRunAction).toHaveBeenCalledTimes(1))
    expect(completeInspectionRunAction).toHaveBeenCalledWith(expect.objectContaining({ runId: RUN_ID }))
  })
})

/*
 * Reabrir una ejecución declarada (rectificar un error) sin salir de la pantalla
 * dejaba el autoguardado y el espejo apagados para siempre, con la etiqueta en
 * «Declarando ejecutada…»: se podía seguir editando sin que nada se guardara.
 */
describe("reabrir sin salir de la pantalla", () => {
  const RESPUESTA = { answerId: "a1", sectionId: "sec-1", itemId: "item-1", itemLabel: "Observaciones", result: "recorded", value: "Primera", comment: null, needsConfirmation: false, evidence: [], danoPotencial: null }

  function conEstado(status: string, version: number, extra: Partial<DetailProps> = {}) {
    const base = propsDelDetalle()
    return propsDelDetalle({ run: { ...base.run, status, version }, answers: [RESPUESTA] as never, ...extra })
  }

  it("declarar → reabrir → editar → vuelve a autoguardar", async () => {
    const vista = montar()
    fireEvent.change(campo("Observaciones"), { target: { value: "Primera" } })
    fireEvent.click(within(abrirElCierre()).getByRole("button", { name: "Declarar ejecutada" }))
    await waitFor(() => expect(completeInspectionRunAction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    // El servidor la deja ejecutada (v6) y alguien la reabre (v7).
    vista.rerender(<InspectionRunDetail {...conEstado("completed", 6)} />)
    vista.rerender(<InspectionRunDetail {...conEstado("in_progress", 7)} />)
    await waitFor(() => expect(etiquetasDeEstado()).not.toContain("Declarando ejecutada…"))
    saveInspectionAnswersAction.mockClear()

    fireEvent.change(campo("Horómetro"), { target: { value: "1250" } })
    expect(etiquetasDeEstado()).toContain("Cambios sin guardar")
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(1)

    await waitFor(() => expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1), { timeout: 4_000 })
    expect(saveInspectionAnswersAction).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      expectedVersion: 7,
      answers: expect.arrayContaining([expect.objectContaining({ itemId: "item-3", value: "1250" })]),
    }))
    await waitFor(() => expect(etiquetasDeEstado()).toContain("Guardado"))
  })

  it("un «ya no se puede editar» seguido de reabrir también devuelve el autoguardado", async () => {
    saveInspectionAnswersAction.mockResolvedValueOnce({
      ok: false,
      message: "No se pueden modificar respuestas de una inspección completada, cerrada o cancelada.",
      data: { code: "not_editable" },
    })
    const vista = montar()
    fireEvent.change(campo("Observaciones"), { target: { value: "Primera" } })
    await waitFor(() => expect(etiquetasDeEstado()).toContain("Ya no se puede editar"), { timeout: 4_000 })

    vista.rerender(<InspectionRunDetail {...conEstado("completed", 6)} />)
    vista.rerender(<InspectionRunDetail {...conEstado("in_progress", 7)} />)
    await waitFor(() => expect(etiquetasDeEstado()).not.toContain("Ya no se puede editar"))
    saveInspectionAnswersAction.mockClear()

    fireEvent.change(campo("Horómetro"), { target: { value: "1250" } })

    await waitFor(() => expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1), { timeout: 4_000 })
    expect(saveInspectionAnswersAction).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7 }))
  })
})

describe("declarar ejecutada con conexión", () => {
  it("deja guardado lo último antes de cerrar y manda las respuestas en pantalla", async () => {
    montar()
    // No se espera el debounce: quien corrige y declara de inmediato no pierde nada.
    fireEvent.change(campo("Observaciones"), { target: { value: "Todo en orden" } })

    const dialogo = abrirElCierre()
    fireEvent.click(within(dialogo).getByRole("button", { name: "Declarar ejecutada" }))

    await waitFor(() => expect(completeInspectionRunAction).toHaveBeenCalledTimes(1))
    // Primero guardó; el cierre usa la versión que devolvió ese guardado.
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    expect(saveInspectionAnswersAction.mock.invocationCallOrder[0]).toBeLessThan(completeInspectionRunAction.mock.invocationCallOrder[0]!)
    expect(completeInspectionRunAction).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      expectedVersion: 5,
      answers: [expect.objectContaining({ itemId: "item-1", value: "Todo en orden" })],
    }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // Declarada ejecutada: nada que rescatar en el dispositivo.
    expect(readInspectionDrafts(RUN_ID)).toHaveLength(0)
  })

  it("guarda los participantes que quedaron sin guardar antes de declarar", async () => {
    montar({ recordsDeviations: true, isUnplannedInspection: true })
    fireEvent.click(screen.getByRole("button", { name: "Agregar participante" }))
    fireEvent.change(screen.getByLabelText(/Nombre 1/), { target: { value: "Ana Pérez" } })
    fireEvent.change(screen.getByLabelText(/Cargo/), { target: { value: "Supervisora" } })

    fireEvent.click(within(abrirElCierre()).getByRole("button", { name: "Declarar ejecutada" }))

    await waitFor(() => expect(completeInspectionRunAction).toHaveBeenCalledTimes(1))
    expect(saveInspectionParticipantsAction).toHaveBeenCalledWith({
      runId: RUN_ID,
      participants: [expect.objectContaining({ name: "Ana Pérez", position: "Supervisora" })],
    })
    expect(saveInspectionParticipantsAction.mock.invocationCallOrder[0]).toBeLessThan(completeInspectionRunAction.mock.invocationCallOrder[0]!)
  })

  it("un rechazo del cierre se dice dentro del diálogo y no lo cierra", async () => {
    completeInspectionRunAction.mockResolvedValue({
      ok: false,
      message: "Faltan firmas del acta: Jefe area.",
      data: { code: "not_ready" },
    })
    montar()

    const dialogo = abrirElCierre()
    fireEvent.click(within(dialogo).getByRole("button", { name: "Declarar ejecutada" }))

    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("Faltan firmas del acta: Jefe area.")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    // El autoguardado se reanuda: el rechazo no dejó la pantalla pausada.
    expect(etiquetasDeEstado()).not.toContain("Declarando ejecutada…")
  })

  it("con una respuesta retenida no deja declarar y lleva al primero", async () => {
    montar()
    fireEvent.change(campo("Horómetro"), { target: { value: "134.122" } })

    const dialogo = abrirElCierre()
    expect(within(dialogo).getByText("Para declarar ejecutada falta:")).toBeInTheDocument()
    expect(within(dialogo).getByText(/escribe el número sin separador de miles \(134122\)/)).toBeInTheDocument()
    expect(within(dialogo).getByRole("button", { name: "Declarar ejecutada" })).toBeDisabled()
    expect(within(dialogo).getByRole("button", { name: "Ir al primero" })).toBeInTheDocument()
    expect(completeInspectionRunAction).not.toHaveBeenCalled()
  })

  it("mientras guarda no se bloquea: lo avisa y el cierre espera el guardado", async () => {
    let terminarGuardado: (resultado: unknown) => void = () => {}
    saveInspectionAnswersAction.mockImplementation(() => new Promise((resolve) => { terminarGuardado = resolve }))
    montar()
    fireEvent.change(campo("Observaciones"), { target: { value: "Todo en orden" } })

    const dialogo = abrirElCierre()
    fireEvent.click(within(dialogo).getByRole("button", { name: "Declarar ejecutada" }))

    expect(await within(dialogo).findByText("Guardando las últimas respuestas…")).toBeInTheDocument()
    // Todavía no cierra: espera a que el guardado en vuelo termine.
    expect(completeInspectionRunAction).not.toHaveBeenCalled()

    await act(async () => { terminarGuardado({ ok: true, data: { version: 5, answerRefs: [] } }) })

    await waitFor(() => expect(completeInspectionRunAction).toHaveBeenCalledTimes(1))
    expect(completeInspectionRunAction).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 5 }))
  })
})
