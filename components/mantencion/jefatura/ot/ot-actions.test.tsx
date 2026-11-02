// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OtTransition } from "@/lib/mantencion/work-order-states"

// jsdom no implementa `scrollIntoView`, que Radix Select llama al abrir la lista.
Element.prototype.scrollIntoView = function scrollIntoView() {}

const refresh = vi.fn()
const actions = {
  assignWorkOrderAction: vi.fn(),
  unassignWorkOrderAction: vi.fn(),
  startWorkOrderAction: vi.fn(),
  updateWorkOrderEntryAction: vi.fn(),
  changeWorkOrderEstimateAction: vi.fn(),
  markWorkOrderItemsAction: vi.fn(),
  finishWorkOrderAction: vi.fn(),
  receiveWorkOrderAction: vi.fn(),
  conformWorkOrderAction: vi.fn(),
  rejectWorkOrderAction: vi.fn(),
  voidWorkOrderAction: vi.fn(),
  reopenWorkOrderAction: vi.fn(),
  registerWorkOrderRecordAction: vi.fn(),
}
const toastSuccess = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }))
vi.mock("@/app/(app)/mantencion/ot/[id]/actions", () => actions)
vi.mock("@/lib/toast", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn(), warning: vi.fn() } }))

const { OtActions } = await import("./ot-actions")
const { otDetail, otRecordForm } = await import("./ot-fixtures")

type Props = React.ComponentProps<typeof OtActions>

function props(overrides: Partial<Props> = {}): Props {
  const detail = otDetail()
  return {
    workOrderId: detail.id, folio: detail.folio, version: 4, status: "en_ejecucion", allowedTransitions: [], canEditExecution: false, unit: "km",
    entry: detail.entry, estimatedDeliveryDate: "2026-11-05", items: detail.items, assignedToUserId: "u-mec",
    mechanics: [{ id: "u-mec", name: "Javier Roa", worksiteNames: ["Biodiversa"] }, { id: "u-2", name: "Marta Lillo", worksiteNames: ["Santa Fe", "Mininco"] }],
    entryCatalogs: { workshops: [{ id: "w-1", name: "Taller Los Aromos" }], drivers: [] }, actorName: "Ana Pérez", pdfHref: "/api/mantencion/ot/ot-1/pdf",
    repair: true, maintenance: false, needsLinkedRecord: false, recordForm: null, actorUserId: "u-mec", ...overrides,
  }
}

const BUTTONS = ["Registrar ingreso", "Registrar trabajo", "Registrar salida", "Recepcionar", "Dar conformidad", "Asignar", "Marcar ítems", "Rechazar", "Reabrir"]
const MENU = ["Reasignar", "Desasignar", "Cambiar entrega estimada", "Corregir ingreso", "Registrar otra correctiva", "Registrar otra preventiva", "Descargar PDF", "Anular"]

function visibleButtons() {
  return BUTTONS.filter((name) => screen.queryByRole("button", { name: new RegExp(`^${name}$`) }))
}

/** Abre «Más acciones» (Radix abre con pointerdown) y devuelve sus ítems, en orden. */
function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: /^Más acciones/ }), { button: 0, ctrlKey: false })
  return MENU.filter((name) => screen.queryByRole("menuitem", { name: new RegExp(`^${name}$`) }))
}

describe("OtActions: sólo se dibuja lo que allowedTransitions permite", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  // [caso, props, botones a la vista, ítems de «Más acciones»]
  const cases: Array<[string, Partial<Props>, string[], string[]]> = [
    ["sin transiciones: sólo el PDF", { allowedTransitions: [] }, [], ["Descargar PDF"]],
    ["solicitada con jefatura: asignar a la vista, anular en el menú", { status: "solicitada", assignedToUserId: null, allowedTransitions: ["assign", "void"] }, ["Asignar"], ["Descargar PDF", "Anular"]],
    ["asignada: ingreso a la vista; reasignar, desasignar y anular en el menú", { status: "asignada", allowedTransitions: ["assign", "unassign", "start", "void"] }, ["Registrar ingreso"], ["Reasignar", "Desasignar", "Descargar PDF", "Anular"]],
    ["en taller con jefatura: salida e ítems a la vista; el resto en el menú", { allowedTransitions: ["assign", "finish", "void"], canEditExecution: true }, ["Registrar salida", "Marcar ítems"], ["Reasignar", "Cambiar entrega estimada", "Corregir ingreso", "Descargar PDF", "Anular"]],
    ["en taller sin permiso de edición: no marca ítems ni cambia la fecha", { allowedTransitions: ["finish"], canEditExecution: false }, ["Registrar salida"], ["Descargar PDF"]],
    ["por recibir: recepcionar y rechazar", { status: "trabajo_terminado", allowedTransitions: ["receive", "reject_receipt"] }, ["Recepcionar", "Rechazar"], ["Descargar PDF"]],
    ["por conformidad: conformidad y rechazar", { status: "recepcionada", allowedTransitions: ["conform", "reject_conformity"] }, ["Dar conformidad", "Rechazar"], ["Descargar PDF"]],
    ["cerrada: reabrir", { status: "cerrada", allowedTransitions: ["reopen"] }, ["Reabrir"], ["Descargar PDF"]],
  ]

  it.each(cases)("%s", (_name, overrides, buttons, menu) => {
    render(<OtActions {...props(overrides)} />)
    expect(visibleButtons()).toEqual(buttons)
    // Nunca más de tres acciones sueltas además de «Más acciones».
    expect(buttons.length).toBeLessThanOrEqual(3)
    expect(openMenu()).toEqual(menu)
    expect(screen.getByRole("menuitem", { name: /Descargar PDF/ }).getAttribute("href")).toBe("/api/mantencion/ot/ot-1/pdf")
  })

  it("en el menú, «Reasignar» dice «Asignar» si todavía no hay mecánico", () => {
    render(<OtActions {...props({ status: "en_ejecucion", allowedTransitions: ["assign"] })} />)
    expect(openMenu()).toContain("Reasignar")
    cleanup()
    render(<OtActions {...props({ status: "solicitada", assignedToUserId: null, allowedTransitions: ["assign"] })} />)
    expect(screen.getByRole("button", { name: "Asignar" })).toBeTruthy()
  })
})

describe("OtActions: diálogos y envío con expectedVersion", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it("asignar: elige mecánico de cualquier faena (muestra sus faenas) y envía workOrderId + expectedVersion", async () => {
    actions.assignWorkOrderAction.mockResolvedValue({ ok: true, message: "Mecánico asignado", data: { version: 5, status: "asignada" } })
    render(<OtActions {...props({ status: "solicitada", assignedToUserId: null, allowedTransitions: ["assign"] })} />)
    fireEvent.click(screen.getByRole("button", { name: "Asignar" }))
    const dialog = within(await screen.findByRole("dialog"))
    fireEvent.click(dialog.getByRole("combobox", { name: /Mecánico/ }))
    fireEvent.click(await screen.findByRole("option", { name: "Marta Lillo · Santa Fe, Mininco" }))
    fireEvent.click(dialog.getByRole("button", { name: "Asignar" }))
    await waitFor(() => expect(actions.assignWorkOrderAction).toHaveBeenCalledWith({ workOrderId: "ot-1", expectedVersion: 4, assignedToUserId: "u-2" }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Mecánico asignado")
  })

  it("el conflicto de versión queda dentro del diálogo, que sigue abierto, y la página se refresca", async () => {
    actions.rejectWorkOrderAction.mockResolvedValue({ ok: false, message: "La OT cambió en otra sesión. Recarga e inténtalo de nuevo." })
    render(<OtActions {...props({ status: "trabajo_terminado", allowedTransitions: ["receive", "reject_receipt"] })} />)
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }))
    const dialog = within(await screen.findByRole("dialog"))
    const submit = dialog.getByRole("button", { name: "Rechazar" })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox", { name: /¿Qué hay que corregir\?/ }), { target: { value: "Sigue la fuga de aceite" } })
    fireEvent.click(submit)
    expect((await dialog.findByRole("alert")).textContent).toContain("La OT cambió en otra sesión")
    expect(actions.rejectWorkOrderAction).toHaveBeenCalledWith({ workOrderId: "ot-1", expectedVersion: 4, reason: "Sigue la fuga de aceite" })
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("rechazar exige un motivo de al menos 10 caracteres", async () => {
    render(<OtActions {...props({ status: "recepcionada", allowedTransitions: ["conform", "reject_conformity"] })} />)
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }))
    const dialog = within(await screen.findByRole("dialog"))
    const submit = dialog.getByRole("button", { name: "Rechazar" }) as HTMLButtonElement
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "corto" } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "No coincide con lo pedido" } })
    expect(submit.disabled).toBe(false)
  })

  it("dar conformidad pide fecha, hora y «Sr.» (por defecto, quien actúa) y envía la hora como instante UTC", async () => {
    actions.conformWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 8, status: "cerrada" } })
    render(<OtActions {...props({ status: "recepcionada", allowedTransitions: ["conform"] })} />)
    fireEvent.click(screen.getByRole("button", { name: "Dar conformidad" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect((dialog.getByRole("textbox", { name: /Sr\./ }) as HTMLInputElement).value).toBe("Ana Pérez")
    fireEvent.click(dialog.getByRole("button", { name: "Dar conformidad" }))
    await waitFor(() => expect(actions.conformWorkOrderAction).toHaveBeenCalled())
    const input = actions.conformWorkOrderAction.mock.calls[0]![0]
    expect(input).toMatchObject({ workOrderId: "ot-1", expectedVersion: 4, faenaReceiverName: "Ana Pérez" })
    expect(input.faenaReceivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it("registrar ingreso: la lectura de la unidad del equipo es obligatoria y la fecha estimada también", async () => {
    actions.startWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 5, status: "en_ejecucion" } })
    render(<OtActions {...props({ status: "asignada", entry: null, allowedTransitions: ["start"] })} />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar ingreso" }))
    const dialog = within(await screen.findByRole("dialog"))
    const submit = dialog.getByRole("button", { name: "Registrar ingreso" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox", { name: /Kilómetro/ }), { target: { value: "120500" } })
    // Falta la fecha estimada.
    expect(submit.disabled).toBe(true)
  })

  it("anular usa ConfirmDialog con motivo y envía el motivo escrito", async () => {
    actions.voidWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 5, status: "anulada" } })
    render(<OtActions {...props({ status: "solicitada", assignedToUserId: null, allowedTransitions: ["assign", "void"] })} />)
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Anular" }))
    const dialog = within(await screen.findByRole("dialog"))
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Se pidió para el equipo equivocado" } })
    fireEvent.click(dialog.getByRole("button", { name: "Anular orden" }))
    await waitFor(() => expect(actions.voidWorkOrderAction).toHaveBeenCalledWith({ workOrderId: "ot-1", expectedVersion: 4, reason: "Se pidió para el equipo equivocado" }))
  })

  it("desasignar es rutina: sin confirmación", async () => {
    actions.unassignWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 5, status: "solicitada" } })
    render(<OtActions {...props({ status: "asignada", allowedTransitions: ["unassign"] as OtTransition[] })} />)
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Desasignar" }))
    await waitFor(() => expect(actions.unassignWorkOrderAction).toHaveBeenCalledWith({ workOrderId: "ot-1", expectedVersion: 4 }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("marcar ítems: sólo envía lo que cambió y agrega ítems de taller", async () => {
    actions.markWorkOrderItemsAction.mockResolvedValue({ ok: true, data: { version: 5, status: "en_ejecucion" } })
    render(<OtActions {...props({ allowedTransitions: ["finish"], canEditExecution: true })} />)
    fireEvent.click(screen.getByRole("button", { name: "Marcar ítems" }))
    const dialog = within(await screen.findByRole("dialog"))
    const submit = dialog.getByRole("button", { name: "Guardar marcas" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    // «Rectificar discos» (i2) estaba pendiente: se marca SÍ.
    const group = dialog.getByRole("group", { name: /Rectificar discos/ })
    fireEvent.click(within(group).getByRole("button", { name: "SÍ" }))
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(actions.markWorkOrderItemsAction).toHaveBeenCalledWith({
      workOrderId: "ot-1", expectedVersion: 4, marks: [{ itemId: "i2", done: "si", note: null }], added: [],
    }))
  })
})

describe("OtActions: registrar el trabajo de la OT desde el PC", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  const variantOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}$`) }).className

  it("sin el registro que exige la salida, «Registrar trabajo» es la acción de la etapa y la salida queda secundaria", async () => {
    render(<OtActions {...props({ allowedTransitions: ["finish"], canEditExecution: true, needsLinkedRecord: true, recordForm: otRecordForm() })} />)
    expect(visibleButtons()).toEqual(["Registrar trabajo", "Registrar salida", "Marcar ítems"])
    expect(variantOf("Registrar trabajo")).not.toEqual(variantOf("Registrar salida"))
    expect(openMenu()).not.toContain("Registrar otra correctiva")
    // OT sólo de reparación: abre la correctiva directo.
    fireEvent.click(screen.getByRole("button", { name: "Registrar trabajo" }))
    const sheet = within(await screen.findByRole("dialog"))
    expect(sheet.getByText("Registrar correctiva · OT-BIO-0001")).toBeTruthy()
    expect(sheet.getByText("Paso 1 de 4 · Lectura y fecha")).toBeTruthy()
  })

  it("una OT de reparación y mantención pregunta qué registrar; sin pauta, la preventiva queda deshabilitada", async () => {
    render(<OtActions {...props({ allowedTransitions: ["finish"], maintenance: true, needsLinkedRecord: true, recordForm: otRecordForm({ schedule: null }) })} />)
    fireEvent.pointerDown(screen.getByRole("button", { name: "Registrar trabajo" }), { button: 0, ctrlKey: false })
    expect(screen.getByRole("menuitem", { name: "Correctiva" }).getAttribute("aria-disabled")).toBeNull()
    expect(screen.getByRole("menuitem", { name: "Preventiva · el equipo no tiene pauta" }).getAttribute("aria-disabled")).toBe("true")
  })

  it("con pauta, elegir «Preventiva» abre el registro de la preventiva", async () => {
    render(<OtActions {...props({ allowedTransitions: ["finish"], maintenance: true, needsLinkedRecord: true, recordForm: otRecordForm() })} />)
    fireEvent.pointerDown(screen.getByRole("button", { name: "Registrar trabajo" }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole("menuitem", { name: "Preventiva" }))
    expect(within(await screen.findByRole("dialog")).getByText("Registrar preventiva · OT-BIO-0001")).toBeTruthy()
  })

  it("con el registro ya hecho, la salida vuelve a ser la acción principal y «Registrar otra…» pasa al menú", () => {
    render(<OtActions {...props({ allowedTransitions: ["finish"], maintenance: true, needsLinkedRecord: false, recordForm: otRecordForm() })} />)
    expect(visibleButtons()).toEqual(["Registrar salida"])
    expect(openMenu()).toEqual(["Registrar otra correctiva", "Registrar otra preventiva", "Descargar PDF"])
  })

  it("sin el formulario (no puede registrar) o fuera de taller, no se ofrece registrar", () => {
    render(<OtActions {...props({ allowedTransitions: ["finish"], needsLinkedRecord: true, recordForm: null })} />)
    expect(visibleButtons()).toEqual(["Registrar salida"])
    cleanup()
    render(<OtActions {...props({ status: "trabajo_terminado", allowedTransitions: [], needsLinkedRecord: true, recordForm: otRecordForm() })} />)
    expect(visibleButtons()).toEqual([])
    expect(openMenu()).toEqual(["Descargar PDF"])
  })
})
