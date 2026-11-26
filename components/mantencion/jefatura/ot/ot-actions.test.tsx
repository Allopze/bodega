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
  reclassifyWorkOrderAction: vi.fn(),
  editWorkOrderAction: vi.fn(),
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
    canDownloadPdf: true,
    repair: true, maintenance: false, needsLinkedRecord: false, recordForm: null, actorUserId: "u-mec", partsRequestHref: null,
    canEditRequest: false, canReclassify: false, executionWorksites: [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Santa Fe" }], actionTypeRequired: false,
    request: {
      equipmentLabel: "KA-135 · RBYD-98", worksiteId: "ws-1", worksiteName: "Biodiversa", repair: true, maintenance: false, requestDate: "2026-10-30",
      requesterName: "Ana Pérez", repairDescription: "Pierde aceite por el cárter", observations: "Equipo crítico", actionType: "correctiva",
      specialties: ["mecanica"], executionWorksiteId: null, annexItems: ["Cambiar pastillas de freno"], maintenanceItems: [],
      laborHours: null, workPerformed: null, hasExit: false,
    },
    ...overrides,
  }
}

/** Un equipo en horas con la última lectura firmada en 7.501 h (el caso de OT-STF-0024 de la auditoría). */
const HOURS_READINGS = { readings: [{ value: 7501, date: "2026-11-10", source: "MC-STF-0003" }], initial: null }

const BUTTONS = ["Registrar ingreso", "Registrar trabajo", "Registrar salida", "Recibir equipo", "Dar conformidad", "Asignar", "Marcar ítems", "Rechazar", "Reabrir"]
const MENU = ["Reasignar", "Desasignar", "Editar orden", "Corregir tipo de acción", "Cambiar entrega estimada", "Corregir ingreso", "Registrar otra correctiva", "Registrar otra preventiva", "Solicitar compra", "Anular"]

function visibleButtons() {
  return BUTTONS.filter((name) => screen.queryByRole("button", { name: new RegExp(`^${name}$`) }))
}

/** Abre «Más acciones» (Radix abre con pointerdown) y devuelve sus ítems, en orden; `[]` si el menú no se dibuja. */
function openMenu() {
  const trigger = screen.queryByRole("button", { name: /^Más acciones/ })
  if (!trigger) return []
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  return MENU.filter((name) => screen.queryByRole("menuitem", { name: new RegExp(`^${name}$`) }))
}

/** «Descargar PDF» ya no es un ítem del menú: es un enlace a la vista, como en el registro. */
const pdfLink = () => screen.queryByRole("link", { name: "Descargar PDF" })

describe("OtActions: sólo se dibuja lo que allowedTransitions permite", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  // [caso, props, botones a la vista, ítems de «Más acciones»]. «Descargar PDF» está siempre a la vista, fuera de este menú.
  const cases: Array<[string, Partial<Props>, string[], string[]]> = [
    ["sin transiciones: sólo el PDF, y sin menú vacío", { allowedTransitions: [] }, [], []],
    ["solicitada con jefatura: asignar a la vista, anular en el menú", { status: "solicitada", assignedToUserId: null, allowedTransitions: ["assign", "void"] }, ["Asignar"], ["Anular"]],
    ["asignada: ingreso a la vista; reasignar, desasignar y anular en el menú", { status: "asignada", allowedTransitions: ["assign", "unassign", "start", "void"] }, ["Registrar ingreso"], ["Reasignar", "Desasignar", "Anular"]],
    ["en taller con jefatura: salida e ítems a la vista; el resto en el menú", { allowedTransitions: ["assign", "finish", "void"], canEditExecution: true }, ["Registrar salida", "Marcar ítems"], ["Reasignar", "Cambiar entrega estimada", "Corregir ingreso", "Anular"]],
    ["en taller sin permiso de edición: no marca ítems ni cambia la fecha", { allowedTransitions: ["finish"], canEditExecution: false }, ["Registrar salida"], []],
    ["por recibir: recibir el equipo y rechazar", { status: "trabajo_terminado", allowedTransitions: ["receive", "reject_receipt"] }, ["Recibir equipo", "Rechazar"], []],
    ["por conformidad: conformidad y rechazar", { status: "recepcionada", allowedTransitions: ["conform", "reject_conformity"] }, ["Dar conformidad", "Rechazar"], []],
    ["cerrada: reabrir", { status: "cerrada", allowedTransitions: ["reopen"] }, ["Reabrir"], []],
  ]

  it.each(cases)("%s", (_name, overrides, buttons, menu) => {
    render(<OtActions {...props(overrides)} />)
    expect(visibleButtons()).toEqual(buttons)
    // Nunca más de tres acciones sueltas además de «Descargar PDF» y «Más acciones».
    expect(buttons.length).toBeLessThanOrEqual(3)
    expect(openMenu()).toEqual(menu)
    // El menú sólo se dibuja si tiene algo; el PDF no depende de él.
    expect(!!screen.queryByRole("button", { name: /^Más acciones/ })).toBe(menu.length > 0)
    expect(pdfLink()?.getAttribute("href")).toBe("/api/mantencion/ot/ot-1/pdf")
    expect(screen.queryByRole("menuitem", { name: /Descargar PDF/ })).toBeNull()
  })

  it("«Descargar PDF» es una acción secundaria a la vista: el mismo botón que «Reabrir» y que el PDF del registro", () => {
    render(<OtActions {...props({ status: "cerrada", allowedTransitions: ["reopen"] })} />)
    const link = pdfLink()!
    expect(link.hasAttribute("download")).toBe(true)
    // Misma variante (secundaria) y tamaño que los demás botones secundarios de la cabecera.
    expect(link.className).toBe(screen.getByRole("button", { name: "Reabrir" }).className)
    expect(link.querySelector("svg")).toBeTruthy()
  })

  it("en el menú, «Reasignar» dice «Asignar» si todavía no hay mecánico", () => {
    render(<OtActions {...props({ status: "en_ejecucion", allowedTransitions: ["assign"] })} />)
    expect(openMenu()).toContain("Reasignar")
    cleanup()
    render(<OtActions {...props({ status: "solicitada", assignedToUserId: null, allowedTransitions: ["assign"] })} />)
    expect(screen.getByRole("button", { name: "Asignar" })).toBeTruthy()
  })

  // El PDF y la impresión exigen `mant:ot:view_worksite|view_all`; el mecánico que
  // sólo ejecuta ve la OT, pero no un botón que le respondería 403.
  it("«Descargar PDF» sólo aparece con permiso para ver la OT", () => {
    render(<OtActions {...props({ status: "solicitada", assignedToUserId: null, allowedTransitions: ["assign", "void"], canDownloadPdf: false })} />)
    expect(openMenu()).toEqual(["Anular"])
    expect(pdfLink()).toBeNull()
    cleanup()
    render(<OtActions {...props({ status: "solicitada", assignedToUserId: null, allowedTransitions: ["assign", "void"], canDownloadPdf: true })} />)
    expect(openMenu()).toEqual(["Anular"])
    expect(pdfLink()).toBeTruthy()
    cleanup()
    // Sin permiso para ver la OT y sin nada más que hacer, no queda ningún control.
    render(<OtActions {...props({ status: "cerrada", allowedTransitions: [], canDownloadPdf: false })} />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(pdfLink()).toBeNull()
  })

  it("«Anular» solo en el menú no lleva separador delante; con otras acciones, sí", () => {
    render(<OtActions {...props({ status: "solicitada", assignedToUserId: null, allowedTransitions: ["assign", "void"] })} />)
    openMenu()
    expect(screen.queryByRole("separator")).toBeNull()
    cleanup()
    render(<OtActions {...props({ status: "asignada", allowedTransitions: ["unassign", "void"] })} />)
    openMenu()
    expect(screen.getAllByRole("separator")).toHaveLength(1)
  })
})

describe("OtActions: «Editar orden» y «Corregir tipo de acción» (una sola puerta)", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it("«Editar orden» sólo con canEditRequest; «Corregir tipo de acción» sólo con canReclassify y nunca las dos", () => {
    render(<OtActions {...props({ status: "asignada", allowedTransitions: ["assign", "unassign", "start", "void"], canEditRequest: true })} />)
    expect(openMenu()).toEqual(["Reasignar", "Desasignar", "Editar orden", "Anular"])
    cleanup()
    render(<OtActions {...props({ allowedTransitions: ["finish"], canReclassify: true })} />)
    expect(openMenu()).toEqual(["Corregir tipo de acción"])
    cleanup()
    // Aunque ambas banderas llegaran en true, el menú ofrece una sola puerta.
    render(<OtActions {...props({ status: "solicitada", allowedTransitions: [], canEditRequest: true, canReclassify: true })} />)
    expect(openMenu()).toEqual(["Editar orden"])
    cleanup()
    // Sin permiso (ninguna bandera): ninguna de las dos.
    render(<OtActions {...props({ status: "cerrada", allowedTransitions: ["reopen"] })} />)
    expect(openMenu()).toEqual([])
  })

  it("«Editar orden» abre el formulario precargado con lo guardado y envía expectedVersion", async () => {
    actions.editWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 5, status: "asignada" } })
    render(<OtActions {...props({ status: "asignada", allowedTransitions: ["assign"], canEditRequest: true })} />)
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar orden" }))
    const sheet = within(await screen.findByRole("dialog"))
    expect(sheet.getByText("Editar la orden OT-BIO-0001")).toBeTruthy()
    expect(sheet.getByText(/el folio se imputa a ella\./)).toBeTruthy()
    expect(sheet.queryByText(/costos/)).toBeNull()
    expect((sheet.getByRole("textbox", { name: /Solicitante/ }) as HTMLInputElement).value).toBe("Ana Pérez")
    expect((sheet.getByRole("textbox", { name: /^Reparación/ }) as HTMLTextAreaElement).value).toBe("Pierde aceite por el cárter")
    expect((sheet.getByRole("textbox", { name: "Observaciones" }) as HTMLTextAreaElement).value).toBe("Equipo crítico")
    expect((sheet.getByRole("checkbox", { name: "Reparación" }) as HTMLInputElement).checked).toBe(true)
    expect((sheet.getByRole("checkbox", { name: "Mecánica" }) as HTMLInputElement).checked).toBe(true)
    expect((sheet.getByRole("textbox", { name: "Trabajos anexos (reparación), línea 1" }) as HTMLInputElement).value).toBe("Cambiar pastillas de freno")
    expect(sheet.getByRole("button", { name: /Fecha de la orden/ }).textContent).toContain("30-10-2026")
    fireEvent.change(sheet.getByRole("textbox", { name: "Observaciones" }), { target: { value: "Urgente" } })
    fireEvent.click(sheet.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(actions.editWorkOrderAction).toHaveBeenCalled())
    expect(actions.editWorkOrderAction.mock.calls[0]![0]).toEqual({
      workOrderId: "ot-1", expectedVersion: 4, repair: true, maintenance: false, requestDate: "2026-10-30", requesterName: "Ana Pérez",
      repairDescription: "Pierde aceite por el cárter", observations: "Urgente", annexItems: ["Cambiar pastillas de freno"], maintenanceItems: [],
      actionType: "correctiva", specialties: ["mecanica"], executionWorksiteId: null,
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Orden actualizada")
  })

  it("editar: el conflicto «cambió en otra sesión» y los errores se ven en el formulario, que sigue abierto", async () => {
    actions.editWorkOrderAction.mockResolvedValue({ ok: false, message: "La OT cambió en otra sesión. Recarga antes de continuar." })
    render(<OtActions {...props({ status: "asignada", allowedTransitions: ["assign"], canEditRequest: true })} />)
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar orden" }))
    const sheet = within(await screen.findByRole("dialog"))
    fireEvent.click(sheet.getByRole("button", { name: "Guardar cambios" }))
    expect((await sheet.findByRole("alert")).textContent).toContain("La OT cambió en otra sesión")
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })

  it("editar: un error de un campo oculto (ítems de un tipo desmarcado) se muestra como mensaje general y los ítems ocultos no viajan", async () => {
    actions.editWorkOrderAction.mockResolvedValue({ ok: false, message: "Revisa los campos marcados.", fieldErrors: { maintenanceItems: ["Cada ítem necesita al menos 3 caracteres."] } })
    render(<OtActions {...props({ status: "asignada", allowedTransitions: ["assign"], canEditRequest: true })} />)
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar orden" }))
    const sheet = within(await screen.findByRole("dialog"))
    // Marca Mantención, escribe un ítem, la desmarca: la lista queda oculta.
    fireEvent.click(sheet.getByRole("checkbox", { name: "Mantención" }))
    fireEvent.click(sheet.getAllByRole("button", { name: "Agregar línea" })[1]!)
    fireEvent.change(sheet.getByRole("textbox", { name: "Mantenciones solicitadas o asignadas en taller, línea 1" }), { target: { value: "Cambio de aceite" } })
    fireEvent.click(sheet.getByRole("checkbox", { name: "Mantención" }))
    expect(sheet.queryByText("Mantenciones solicitadas o asignadas en taller")).toBeNull()
    fireEvent.click(sheet.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(actions.editWorkOrderAction).toHaveBeenCalled())
    expect(actions.editWorkOrderAction.mock.calls[0]![0]).toMatchObject({ maintenance: false, maintenanceItems: [] })
    const alert = await sheet.findByRole("alert")
    expect(alert.textContent).toContain("Cada ítem necesita al menos 3 caracteres.")
  })

  // OT4-6: «Editar orden» de una OT asignada, sin tipo, con Reparación, su descripción y un trabajo anexo (OT-CHO-0015).
  async function openEdit() {
    actions.editWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 5, status: "asignada" } })
    render(<OtActions {...props({ status: "asignada", allowedTransitions: ["assign"], canEditRequest: true, request: { ...props().request, actionType: null } })} />)
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar orden" }))
    return within(await screen.findByRole("dialog"))
  }

  it("editar: elegir el tipo de acción NO cambia Reparación ni Mantención, y guardar conserva la descripción y los ítems", async () => {
    const sheet = await openEdit()
    fireEvent.click(sheet.getByRole("combobox", { name: /Tipo de acción/ }))
    fireEvent.click(await screen.findByRole("option", { name: "Preventiva" }))
    expect(sheet.getByRole("combobox", { name: /Tipo de acción/ }).textContent).toContain("Preventiva")
    expect((sheet.getByRole("checkbox", { name: "Reparación" }) as HTMLInputElement).checked).toBe(true)
    expect((sheet.getByRole("checkbox", { name: "Mantención" }) as HTMLInputElement).checked).toBe(false)
    expect((sheet.getByRole("textbox", { name: /^Reparación/ }) as HTMLTextAreaElement).value).toBe("Pierde aceite por el cárter")
    // Nada que perder: ningún aviso.
    expect(sheet.queryByText(/Al guardar se borra/)).toBeNull()
    fireEvent.click(sheet.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(actions.editWorkOrderAction).toHaveBeenCalled())
    expect(actions.editWorkOrderAction.mock.calls[0]![0]).toMatchObject({
      repair: true, maintenance: false, actionType: "preventiva",
      repairDescription: "Pierde aceite por el cárter", annexItems: ["Cambiar pastillas de freno"], maintenanceItems: [],
    })
  })

  it("editar: el texto de ayuda del tipo de acción ya no promete marcar casillas", async () => {
    const sheet = await openEdit()
    expect(sheet.getByText("Elegirlo no cambia lo marcado en «Tipo de trabajo».")).toBeTruthy()
    expect(sheet.queryByText(/Al elegirla se marca Reparación/)).toBeNull()
  })

  it("editar: desmarcar a mano un tipo con contenido avisa qué se borra al guardar, sin diálogo, y recuperarlo quita el aviso", async () => {
    const sheet = await openEdit()
    expect(sheet.getByRole("status").textContent).toBe("")
    fireEvent.click(sheet.getByRole("checkbox", { name: "Reparación" }))
    expect(sheet.getByRole("status").textContent).toBe("Al guardar se borran la descripción y 1 trabajo anexo.")
    // Un solo diálogo en pantalla: el aviso no abre otro.
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    fireEvent.click(sheet.getByRole("checkbox", { name: "Reparación" }))
    expect(sheet.getByRole("status").textContent).toBe("")
    expect((sheet.getByRole("textbox", { name: /^Reparación/ }) as HTMLTextAreaElement).value).toBe("Pierde aceite por el cárter")
    // Sin descripción, el aviso habla sólo de los trabajos; en plural concuerda.
    fireEvent.change(sheet.getByRole("textbox", { name: /^Reparación/ }), { target: { value: "  " } })
    fireEvent.click(sheet.getAllByRole("button", { name: "Agregar línea" })[0]!)
    fireEvent.change(sheet.getByRole("textbox", { name: "Trabajos anexos (reparación), línea 2" }), { target: { value: "Rectificar discos" } })
    fireEvent.click(sheet.getByRole("checkbox", { name: "Reparación" }))
    expect(sheet.getByRole("status").textContent).toBe("Al guardar se borran 2 trabajos anexos.")
  })

  it("editar: Mantención desmarcada con líneas dice cuántas se borran", async () => {
    const sheet = await openEdit()
    fireEvent.click(sheet.getByRole("checkbox", { name: "Mantención" }))
    fireEvent.click(sheet.getAllByRole("button", { name: "Agregar línea" })[1]!)
    fireEvent.change(sheet.getByRole("textbox", { name: "Mantenciones solicitadas o asignadas en taller, línea 1" }), { target: { value: "Cambio de aceite" } })
    fireEvent.click(sheet.getByRole("checkbox", { name: "Mantención" }))
    expect(sheet.getByRole("status").textContent).toBe("Al guardar se borra 1 mantención solicitada.")
  })

  it("«Corregir tipo de acción» muestra lo guardado, exige motivo y sólo habilita cuando algo cambió", async () => {
    actions.reclassifyWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 5, status: "en_ejecucion" } })
    render(<OtActions {...props({ allowedTransitions: ["finish"], canReclassify: true })} />)
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Corregir tipo de acción" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByRole("combobox", { name: /Tipo de acción/ }).textContent).toContain("Correctiva")
    expect((dialog.getByRole("checkbox", { name: "Mecánica" }) as HTMLInputElement).checked).toBe(true)
    // La OT todavía no sale de taller: no hay horas hombre que corregir.
    expect(dialog.queryByRole("spinbutton", { name: /Horas hombre/ })).toBeNull()
    const submit = dialog.getByRole("button", { name: "Guardar corrección" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(dialog.getByRole("checkbox", { name: "Soldadura" }))
    // Cambió algo pero falta el motivo.
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo de la corrección/ }), { target: { value: "corto" } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo de la corrección/ }), { target: { value: "Faltaba la soldadura del soporte" } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(actions.reclassifyWorkOrderAction).toHaveBeenCalledWith({
      workOrderId: "ot-1", expectedVersion: 4, actionType: "correctiva", specialties: ["mecanica", "soldadura"], executionWorksiteId: null,
      reason: "Faltaba la soldadura del soporte",
    }))
    expect(toastSuccess).toHaveBeenCalledWith("Tipo de acción corregido")
  })

  it("«Corregir tipo de acción» ofrece las horas hombre sólo tras la salida, precargadas, y las envía", async () => {
    actions.reclassifyWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 5, status: "cerrada" } })
    render(<OtActions {...props({
      status: "cerrada", allowedTransitions: ["reopen"], canReclassify: true,
      request: { ...props().request, hasExit: true, laborHours: 8 },
    })} />)
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Corregir tipo de acción" }))
    const dialog = within(await screen.findByRole("dialog"))
    const hours = dialog.getByRole("spinbutton", { name: /Horas hombre/ }) as HTMLInputElement
    expect(hours.value).toBe("8")
    fireEvent.change(hours, { target: { value: "2.5" } })
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo de la corrección/ }), { target: { value: "Se digitó 8 en vez de 2,5" } })
    fireEvent.click(dialog.getByRole("button", { name: "Guardar corrección" }))
    await waitFor(() => expect(actions.reclassifyWorkOrderAction).toHaveBeenCalledWith(expect.objectContaining({ laborHours: 2.5, reason: "Se digitó 8 en vez de 2,5" })))
  })

  it("«Corregir tipo de acción»: un conflicto de versión queda en el diálogo y se reenvía con la versión original", async () => {
    actions.reclassifyWorkOrderAction.mockResolvedValue({ ok: false, message: "La OT cambió en otra sesión. Recarga antes de continuar." })
    render(<OtActions {...props({ allowedTransitions: ["finish"], canReclassify: true })} />)
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Corregir tipo de acción" }))
    const dialog = within(await screen.findByRole("dialog"))
    fireEvent.click(dialog.getByRole("checkbox", { name: "Eléctrica" }))
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo de la corrección/ }), { target: { value: "Faltaba la parte eléctrica" } })
    fireEvent.click(dialog.getByRole("button", { name: "Guardar corrección" }))
    expect((await dialog.findByRole("alert")).textContent).toContain("La OT cambió en otra sesión")
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })
})

describe("OtActions: «Solicitar compra»", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  const HREF = "/solicitudes/nueva?tipo=repuestos&ot=ot-1"

  it("«Solicitar compra» sólo aparece en el menú con partsRequestHref", () => {
    render(<OtActions {...props({ allowedTransitions: ["finish"] })} />)
    expect(openMenu()).not.toContain("Solicitar compra")
    cleanup()
    render(<OtActions {...props({ allowedTransitions: ["finish"], partsRequestHref: HREF })} />)
    // Va en «Más acciones», y no como botón suelto en la cabecera.
    expect(openMenu()).toEqual(["Solicitar compra"])
    expect(screen.getByRole("menuitem", { name: "Solicitar compra" }).getAttribute("href")).toBe(HREF)
    expect(screen.queryByRole("button", { name: "Solicitar compra" })).toBeNull()
  })
})

describe("OtActions: aviso de repuestos reservados sin usar", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  const NOTICE = { count: 2, worksiteNames: ["Santa Fe"] }
  const TEXT = "Quedan 2 repuestos reservados sin usar; pasan a stock libre de Santa Fe."

  it("«Dar conformidad» (que cierra la OT) avisa lo que queda reservado antes de confirmar", async () => {
    render(<OtActions {...props({ status: "recepcionada", allowedTransitions: ["conform"], reservedUnused: NOTICE })} />)
    fireEvent.click(screen.getByRole("button", { name: "Dar conformidad" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText(TEXT)).toBeTruthy()
  })

  it("«Anular» también lo avisa, con la misma frase", async () => {
    render(<OtActions {...props({ status: "asignada", allowedTransitions: ["void"], reservedUnused: NOTICE })} />)
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Anular" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText(new RegExp(TEXT.replace(/[.;]/g, "\\$&")))).toBeTruthy()
  })

  it("sin repuestos reservados no dice nada, y «Recibir equipo» (que no cierra la OT) tampoco", async () => {
    render(<OtActions {...props({ status: "recepcionada", allowedTransitions: ["conform"] })} />)
    fireEvent.click(screen.getByRole("button", { name: "Dar conformidad" }))
    expect(within(await screen.findByRole("dialog")).queryByText(/reservados sin usar/)).toBeNull()
    cleanup()
    render(<OtActions {...props({ status: "trabajo_terminado", allowedTransitions: ["receive"], reservedUnused: NOTICE })} />)
    fireEvent.click(screen.getByRole("button", { name: "Recibir equipo" }))
    expect(within(await screen.findByRole("dialog")).queryByText(/reservados sin usar/)).toBeNull()
  })

  it("en singular concuerda: «Queda 1 repuesto reservado sin usar; pasa a stock libre…»", async () => {
    render(<OtActions {...props({ status: "recepcionada", allowedTransitions: ["conform"], reservedUnused: { count: 1, worksiteNames: ["Santa Fe", "Biodiversa"] } })} />)
    fireEvent.click(screen.getByRole("button", { name: "Dar conformidad" }))
    expect(within(await screen.findByRole("dialog")).getByText("Queda 1 repuesto reservado sin usar; pasa a stock libre de Santa Fe y Biodiversa.")).toBeTruthy()
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

  it("dar conformidad pide fecha, hora y «Recibió» (por defecto, quien actúa) y envía la hora como instante UTC", async () => {
    actions.conformWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 8, status: "cerrada" } })
    render(<OtActions {...props({ status: "recepcionada", allowedTransitions: ["conform"] })} />)
    fireEvent.click(screen.getByRole("button", { name: "Dar conformidad" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect((dialog.getByRole("textbox", { name: /Recibió/ }) as HTMLInputElement).value).toBe("Ana Pérez")
    fireEvent.click(dialog.getByRole("button", { name: "Dar conformidad" }))
    await waitFor(() => expect(actions.conformWorkOrderAction).toHaveBeenCalled())
    const input = actions.conformWorkOrderAction.mock.calls[0]![0]
    expect(input).toMatchObject({ workOrderId: "ot-1", expectedVersion: 4, faenaReceiverName: "Ana Pérez" })
    expect(input.faenaReceivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it("registrar ingreso: sólo pide la lectura de la unidad del equipo, la última conocida y la fecha estimada", async () => {
    actions.startWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 5, status: "en_ejecucion" } })
    render(<OtActions {...props({ status: "asignada", entry: null, allowedTransitions: ["start"], entryReadings: HOURS_READINGS, unit: "h" })} />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar ingreso" }))
    const dialog = within(await screen.findByRole("dialog"))
    // Un equipo en horas: sólo el horómetro (antes pedía también el kilómetro y lo descartaba en silencio).
    expect(dialog.getByRole("textbox", { name: /Horómetro al ingresar/ })).toBeTruthy()
    expect(dialog.queryByRole("textbox", { name: /Odómetro|Kilómetro/ })).toBeNull()
    expect(dialog.getByText("Última lectura registrada: 7.501 h · 10-11-2026")).toBeTruthy()
    const submit = dialog.getByRole("button", { name: "Registrar ingreso" }) as HTMLButtonElement
    // Falta la fecha estimada (el único dato que sigue desactivando el botón).
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox", { name: /Horómetro al ingresar/ }), { target: { value: "7600" } })
    expect(submit.disabled).toBe(true)
    cleanup()

    render(<OtActions {...props({ status: "asignada", entry: null, allowedTransitions: ["start"], unit: "km" })} />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar ingreso" }))
    const km = within(await screen.findByRole("dialog"))
    expect(km.getByRole("textbox", { name: /Odómetro al ingresar/ })).toBeTruthy()
    expect(km.queryByRole("textbox", { name: /Horómetro/ })).toBeNull()
    // Sin lecturas cargadas no inventa una «última lectura».
    expect(km.queryByText(/Última lectura/)).toBeNull()
  })

  describe("corregir el ingreso: la lectura se lee y se valida como en la app", () => {
    const ENTRY_H = { ...otDetail().entry!, odometer: null, hourmeter: 7_600, entryAt: "2026-11-12T13:00:00.000Z", estimatedDeliveryDate: "2026-11-20" }

    async function openCorrection(overrides: Partial<Props> = {}) {
      actions.updateWorkOrderEntryAction.mockResolvedValue({ ok: true, data: { version: 5, status: "en_ejecucion" } })
      render(<OtActions {...props({ allowedTransitions: ["finish"], canEditExecution: true, unit: "h", entry: ENTRY_H, entryReadings: HOURS_READINGS, ...overrides })} />)
      openMenu()
      fireEvent.click(screen.getByRole("menuitem", { name: "Corregir ingreso" }))
      const dialog = within(await screen.findByRole("dialog"))
      return { dialog, field: dialog.getByRole("textbox", { name: /Horómetro al ingresar/ }) as HTMLInputElement, save: dialog.getByRole("button", { name: "Guardar corrección" }) as HTMLButtonElement }
    }

    it("precarga lo guardado con el separador de miles", async () => {
      const { field } = await openCorrection()
      expect(field.value).toBe("7.600")
    })

    it("«8.100» son 8100 horas (no 8,1): el salto sobre la última lectura se confirma antes de enviar", async () => {
      const { dialog, field, save } = await openCorrection()
      fireEvent.change(field, { target: { value: "8.100" } })
      expect(field.value).toBe("8.100")
      fireEvent.click(save)
      // Son 599 h más que la última (7.501 h): se pregunta, no se envía.
      expect((await dialog.findByRole("alert")).textContent).toContain("Son 599 h más que la última vez. ¿Está bien?")
      expect(actions.updateWorkOrderEntryAction).not.toHaveBeenCalled()
      fireEvent.click(dialog.getByRole("button", { name: "Sí, está bien" }))
      await waitFor(() => expect(actions.updateWorkOrderEntryAction).toHaveBeenCalled())
      expect(actions.updateWorkOrderEntryAction.mock.calls[0]![0].entry).toMatchObject({ hourmeter: 8100, odometer: null })
    })

    it("«Corregir la lectura» devuelve el foco al campo sin enviar nada", async () => {
      const { dialog, field, save } = await openCorrection()
      fireEvent.change(field, { target: { value: "8.100" } })
      fireEvent.click(save)
      fireEvent.click(await dialog.findByRole("button", { name: "Corregir la lectura" }))
      expect(document.activeElement).toBe(field)
      expect(actions.updateWorkOrderEntryAction).not.toHaveBeenCalled()
    })

    it("una lectura menor que la última dice cuál es y de qué fecha, y no se envía; el botón sigue activo", async () => {
      const { dialog, field, save } = await openCorrection()
      fireEvent.change(field, { target: { value: "7.000" } })
      expect(save.disabled).toBe(false)
      fireEvent.click(save)
      expect((await dialog.findByRole("alert")).textContent).toBe("Es menor que la lectura de 7.501 h del 10-11-2026 (MC-STF-0003). Revisa el número o la fecha.")
      expect(actions.updateWorkOrderEntryAction).not.toHaveBeenCalled()
      expect(screen.getByRole("dialog")).toBeTruthy()
      // Corregida, se envía sin avisos.
      fireEvent.change(field, { target: { value: "7.520" } })
      expect(dialog.queryByRole("alert")).toBeNull()
      fireEvent.click(save)
      await waitFor(() => expect(actions.updateWorkOrderEntryAction).toHaveBeenCalled())
      expect(actions.updateWorkOrderEntryAction.mock.calls[0]![0].entry).toMatchObject({ hourmeter: 7520 })
    })

    it("sin número (texto que no se entiende) dice qué falta junto al campo, en vez de dejar el botón apagado", async () => {
      const { dialog, field, save } = await openCorrection()
      fireEvent.change(field, { target: { value: "abc" } })
      expect(field.value).toBe("")
      expect(save.disabled).toBe(false)
      fireEvent.click(save)
      expect((await dialog.findByRole("alert")).textContent).toBe("Ingresa la lectura del horómetro.")
      expect(field.getAttribute("aria-invalid")).toBe("true")
      expect(actions.updateWorkOrderEntryAction).not.toHaveBeenCalled()
    })

    it("un valor sobre el tope de la columna lo dice; «1.234.567» ya no deja el botón apagado sin mensaje", async () => {
      const { dialog, field, save } = await openCorrection()
      fireEvent.change(field, { target: { value: "123.456.789" } })
      fireEvent.click(save)
      expect((await dialog.findByRole("alert")).textContent).toBe("La lectura no puede pasar de 99.999.999.")
      fireEvent.change(field, { target: { value: "1.234.567" } })
      expect(field.value).toBe("1.234.567")
      expect(save.disabled).toBe(false)
      fireEvent.click(save)
      expect((await dialog.findByRole("alert")).textContent).toContain("más que la última vez")
    })

    it("no avisa mientras se tipea (los pasos hacia «8100» están bajo la última lectura): sí al salir del campo", async () => {
      const { dialog, field } = await openCorrection()
      fireEvent.change(field, { target: { value: "8" } })
      expect(dialog.queryByRole("alert")).toBeNull()
      fireEvent.blur(field)
      expect((await dialog.findByRole("alert")).textContent).toContain("Es menor que la lectura de 7.501 h")
    })

    it("la lectura se compara con la fecha de ingreso: una posterior a lo registrado después también se rechaza", async () => {
      const readings = { readings: [{ value: 7501, date: "2026-11-10", source: "MC-STF-0003" }, { value: 7650, date: "2026-11-14", source: "MC-STF-0004" }], initial: null }
      const { dialog, field, save } = await openCorrection({ entryReadings: readings })
      fireEvent.change(field, { target: { value: "7.700" } })
      fireEvent.click(save)
      expect((await dialog.findByRole("alert")).textContent).toBe("Es mayor que la lectura de 7.650 h registrada después, el 14-11-2026 (MC-STF-0004). Revisa el número o la fecha.")
    })

    it("sin las lecturas del equipo igual lee bien el número y lo envía, sin compararlo", async () => {
      const { dialog, field, save } = await openCorrection({ entryReadings: null })
      expect(dialog.queryByText(/Última lectura/)).toBeNull()
      fireEvent.change(field, { target: { value: "8.100" } })
      fireEvent.click(save)
      await waitFor(() => expect(actions.updateWorkOrderEntryAction).toHaveBeenCalled())
      expect(actions.updateWorkOrderEntryAction.mock.calls[0]![0].entry).toMatchObject({ hourmeter: 8100 })
      expect(dialog.queryByRole("alert")).toBeNull()
    })

    it("un equipo en kilómetros envía el odómetro y deja el horómetro en null", async () => {
      actions.updateWorkOrderEntryAction.mockResolvedValue({ ok: true, data: { version: 5, status: "en_ejecucion" } })
      render(<OtActions {...props({ allowedTransitions: ["finish"], canEditExecution: true, unit: "km" })} />)
      openMenu()
      fireEvent.click(screen.getByRole("menuitem", { name: "Corregir ingreso" }))
      const dialog = within(await screen.findByRole("dialog"))
      const field = dialog.getByRole("textbox", { name: /Odómetro al ingresar/ }) as HTMLInputElement
      expect(field.value).toBe("120.500")
      fireEvent.change(field, { target: { value: "120.600" } })
      fireEvent.click(dialog.getByRole("button", { name: "Guardar corrección" }))
      await waitFor(() => expect(actions.updateWorkOrderEntryAction).toHaveBeenCalled())
      expect(actions.updateWorkOrderEntryAction.mock.calls[0]![0].entry).toMatchObject({ odometer: 120600, hourmeter: null })
    })
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
    // «Rectificar discos» (i2) estaba pendiente: se marca Sí.
    const group = dialog.getByRole("group", { name: /Rectificar discos/ })
    fireEvent.click(within(group).getByRole("button", { name: "Sí" }))
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(actions.markWorkOrderItemsAction).toHaveBeenCalledWith({
      workOrderId: "ot-1", expectedVersion: 4, marks: [{ itemId: "i2", done: "si", note: null }], added: [],
    }))
  })
})

describe("OtActions: terminar con trabajo realizado y horas hombre", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  async function openFinish() {
    render(<OtActions {...props({ allowedTransitions: ["finish"], canEditExecution: true })} />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar salida" }))
    return within(await screen.findByRole("dialog"))
  }

  it("envía el trabajo realizado y las horas (coma decimal) junto con la salida", async () => {
    actions.finishWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 5, status: "trabajo_terminado" } })
    const dialog = await openFinish()
    fireEvent.change(dialog.getByRole("textbox", { name: /Trabajo realizado/ }), { target: { value: "  Cambio de manguera  " } })
    fireEvent.change(dialog.getByRole("spinbutton", { name: /Horas hombre/ }), { target: { value: "6.5" } })
    fireEvent.click(dialog.getByRole("button", { name: "Registrar salida" }))
    await waitFor(() => expect(actions.finishWorkOrderAction).toHaveBeenCalledWith(expect.objectContaining({
      workOrderId: "ot-1", expectedVersion: 4, workPerformed: "Cambio de manguera", laborHours: 6.5,
    })))
  })

  it("precarga el trabajo realizado y las horas ya guardados (tras un rechazo o una reapertura) en vez de pisarlos en silencio", async () => {
    actions.finishWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 6, status: "trabajo_terminado" } })
    render(<OtActions {...props({
      allowedTransitions: ["finish"], canEditExecution: true,
      request: { ...props().request, workPerformed: "Se cambió la manguera", laborHours: 8 },
    })} />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar salida" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect((dialog.getByRole("textbox", { name: /Trabajo realizado/ }) as HTMLTextAreaElement).value).toBe("Se cambió la manguera")
    expect((dialog.getByRole("spinbutton", { name: /Horas hombre/ }) as HTMLInputElement).value).toBe("8")
    // Sin tocarlos, reenvía lo guardado.
    fireEvent.click(dialog.getByRole("button", { name: "Registrar salida" }))
    await waitFor(() => expect(actions.finishWorkOrderAction).toHaveBeenCalledWith(expect.objectContaining({ workPerformed: "Se cambió la manguera", laborHours: 8 })))
  })

  it("los dos campos son opcionales: vacíos viajan como null", async () => {
    actions.finishWorkOrderAction.mockResolvedValue({ ok: true, data: { version: 5, status: "trabajo_terminado" } })
    const dialog = await openFinish()
    fireEvent.click(dialog.getByRole("button", { name: "Registrar salida" }))
    await waitFor(() => expect(actions.finishWorkOrderAction).toHaveBeenCalledWith(expect.objectContaining({ workPerformed: null, laborHours: null })))
  })

  it("horas negativas o sobre el tope no se envían", async () => {
    const dialog = await openFinish()
    fireEvent.change(dialog.getByRole("spinbutton", { name: /Horas hombre/ }), { target: { value: "-2" } })
    fireEvent.click(dialog.getByRole("button", { name: "Registrar salida" }))
    expect(await dialog.findByText(/horas entre 0 y 10\.000/)).toBeTruthy()
    expect(actions.finishWorkOrderAction).not.toHaveBeenCalled()
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
    expect(openMenu()).toEqual(["Registrar otra correctiva", "Registrar otra preventiva"])
    expect(pdfLink()).toBeTruthy()
  })

  it("sin el formulario (no puede registrar) o fuera de taller, no se ofrece registrar", () => {
    render(<OtActions {...props({ allowedTransitions: ["finish"], needsLinkedRecord: true, recordForm: null })} />)
    expect(visibleButtons()).toEqual(["Registrar salida"])
    cleanup()
    render(<OtActions {...props({ status: "trabajo_terminado", allowedTransitions: [], needsLinkedRecord: true, recordForm: otRecordForm() })} />)
    expect(visibleButtons()).toEqual([])
    expect(openMenu()).toEqual([])
    expect(pdfLink()).toBeTruthy()
  })
})
