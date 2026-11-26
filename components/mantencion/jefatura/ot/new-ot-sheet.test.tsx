// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

Element.prototype.scrollIntoView = function scrollIntoView() {}

const push = vi.fn()
const createWorkOrderAction = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/app/(app)/mantencion/ot/actions", () => ({ createWorkOrderAction: (...args: unknown[]) => createWorkOrderAction(...args) }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const { NewWorkOrderCta, buildCreatePayload, checksForActionType } = await import("./new-ot-sheet")
const { discardNotices } = await import("./ot-request-fields")

const EQUIPMENT = [
  { id: "veh-1", code: "KA-135", plate: "RBYD-98", typeName: "Camión", worksiteId: "ws-1", worksiteName: "Biodiversa", unit: "km" as const },
  { id: "veh-2", code: "EX-04", plate: "EX-04", typeName: "Excavadora", worksiteId: "ws-2", worksiteName: "Santa Fe", unit: "h" as const },
]

const BASE = { equipment: EQUIPMENT, mechanics: null, today: "2026-11-02", defaultRequesterName: "Ana Pérez" }

async function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Nueva orden/ }))
  return within(await screen.findByRole("dialog"))
}

describe("«Nueva orden»", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it("parte con la fecha de hoy y el solicitante por defecto, y no deja crear sin equipo", async () => {
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    expect((sheet.getByRole("textbox", { name: /Solicitante/ }) as HTMLInputElement).value).toBe("Ana Pérez")
    expect(sheet.getByRole("button", { name: /Fecha de la orden/ }).textContent).toContain("02-11-2026")
    expect((sheet.getByRole("button", { name: "Crear orden" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("la OT no pide costo: ni mano de obra ni costo total (decisión 2026-11-17)", async () => {
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    expect(sheet.queryByLabelText(/Costo/)).toBeNull()
    expect(sheet.queryByText(/mano de obra|Costo total/i)).toBeNull()
  })

  it("el selector de mecánico sólo existe para quien administra las OT", async () => {
    const { unmount } = render(<NewWorkOrderCta {...BASE} />)
    expect((await openSheet()).queryByText(/Mecánico \(opcional\)/)).toBeNull()
    unmount()
    render(<NewWorkOrderCta {...BASE} mechanics={[{ id: "u-1", name: "Marta Lillo", worksiteNames: ["Santa Fe"] }]} />)
    expect((await openSheet()).getByText("Mecánico (opcional)")).toBeTruthy()
  })

  it("el administrador de contrato ve a quién queda asignada: el mecánico de la faena del equipo, a elegir si hay varios", async () => {
    const worksiteMechanics = [
      { id: "m-1", name: "Javier Roa", worksiteId: "ws-1" },
      { id: "m-2", name: "Deivis González", worksiteId: "ws-1" },
      { id: "m-3", name: "Pedro Fuentes", worksiteId: "ws-2" },
    ]
    render(<NewWorkOrderCta {...BASE} worksiteMechanics={worksiteMechanics} />)
    const sheet = await openSheet()
    const pick = async (name: RegExp) => {
      fireEvent.focus(sheet.getByRole("combobox", { name: /Equipo/ }))
      fireEvent.mouseDown(await screen.findByRole("option", { name }))
    }
    // Sin equipo todavía no se sabe la faena.
    expect(sheet.queryByText(/Se asigna a/)).toBeNull()
    // Santa Fe tiene un solo mecánico: se asigna sin preguntar.
    await pick(/EX-04/)
    expect(sheet.getByTestId("ot-mecanico-faena").textContent).toContain("Se asigna a Pedro Fuentes")
    // Biodiversa tiene dos: hay que elegir, y sólo entre ellos.
    await pick(/KA-135 · RBYD-98/)
    expect(sheet.queryByTestId("ot-mecanico-faena")).toBeNull()
    expect(sheet.getByText("Mecánico")).toBeTruthy()
    expect(sheet.getByText(/Mecánicos de Biodiversa/)).toBeTruthy()
  })

  it("si la faena del equipo no tiene mecánico, avisa que queda por asignar", async () => {
    render(<NewWorkOrderCta {...BASE} worksiteMechanics={[]} />)
    const sheet = await openSheet()
    fireEvent.focus(sheet.getByRole("combobox", { name: /Equipo/ }))
    fireEvent.mouseDown(await screen.findByRole("option", { name: /EX-04/ }))
    expect(sheet.getByTestId("ot-mecanico-faena").textContent).toContain("Santa Fe no tiene mecánico")
  })

  it("las dos listas de ítems aparecen según el tipo y se detienen en 12 líneas", async () => {
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    expect(sheet.queryByText("Mantenciones solicitadas o asignadas en taller")).toBeNull()
    fireEvent.click(sheet.getByRole("checkbox", { name: "Mantención" }))
    expect(sheet.getByText("Mantenciones solicitadas o asignadas en taller")).toBeTruthy()
    const add = sheet.getAllByRole("button", { name: "Agregar línea" })[1]!
    for (let i = 0; i < 14; i++) fireEvent.click(add)
    expect(sheet.getByText("12/12")).toBeTruthy()
    expect((add as HTMLButtonElement).disabled).toBe(true)
  })

  it("envía el JSON del createWorkOrderSchema en `payload`, con un clientRequestId y sin líneas vacías, y navega al detalle", async () => {
    createWorkOrderAction.mockResolvedValue({ ok: true, message: "OT OT-BIO-0003 creada", data: { id: "ot-3", folio: "OT-BIO-0003" } })
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    fireEvent.focus(sheet.getByRole("combobox", { name: /Equipo/ }))
    fireEvent.mouseDown(await screen.findByRole("option", { name: /KA-135 · RBYD-98/ }))
    fireEvent.change(sheet.getByRole("textbox", { name: /^Reparación/ }), { target: { value: "Pierde aceite por el cárter" } })
    fireEvent.click(sheet.getAllByRole("button", { name: "Agregar línea" })[0]!)
    fireEvent.click(sheet.getAllByRole("button", { name: "Agregar línea" })[0]!)
    fireEvent.change(sheet.getByRole("textbox", { name: "Trabajos anexos (reparación), línea 1" }), { target: { value: "Cambiar pastillas de freno" } })
    fireEvent.click(sheet.getByRole("button", { name: "Crear orden" }))

    await waitFor(() => expect(createWorkOrderAction).toHaveBeenCalled())
    const formData = createWorkOrderAction.mock.calls[0]![1] as FormData
    const payload = JSON.parse(String(formData.get("payload")))
    expect(payload).toMatchObject({
      vehicleId: "veh-1", repair: true, maintenance: false, requestDate: "2026-11-02", requesterName: "Ana Pérez",
      repairDescription: "Pierde aceite por el cárter", observations: null, annexItems: ["Cambiar pastillas de freno"], maintenanceItems: [], assignedToUserId: null,
    })
    expect(payload).not.toHaveProperty("totalCost")
    expect(payload.clientRequestId).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(push).toHaveBeenCalledWith("/mantencion/ot/ot-3"))
  })

  it("OT-5: los ítems de un tipo desmarcado no se envían, y el error de un campo oculto se ve como mensaje general", async () => {
    createWorkOrderAction.mockResolvedValue({ ok: false, message: "Revisa los campos marcados.", fieldErrors: { maintenanceItems: ["Cada ítem necesita al menos 3 caracteres."] } })
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    fireEvent.focus(sheet.getByRole("combobox", { name: /Equipo/ }))
    fireEvent.mouseDown(await screen.findByRole("option", { name: /EX-04/ }))
    fireEvent.change(sheet.getByRole("textbox", { name: /^Reparación/ }), { target: { value: "Pierde aceite por el cárter" } })
    fireEvent.click(sheet.getByRole("checkbox", { name: "Mantención" }))
    fireEvent.click(sheet.getAllByRole("button", { name: "Agregar línea" })[1]!)
    fireEvent.change(sheet.getByRole("textbox", { name: "Mantenciones solicitadas o asignadas en taller, línea 1" }), { target: { value: "ab" } })
    fireEvent.click(sheet.getByRole("checkbox", { name: "Mantención" }))
    expect(sheet.queryByText("Mantenciones solicitadas o asignadas en taller")).toBeNull()
    fireEvent.click(sheet.getByRole("button", { name: "Crear orden" }))
    await waitFor(() => expect(createWorkOrderAction).toHaveBeenCalled())
    const payload = JSON.parse(String((createWorkOrderAction.mock.calls[0]![1] as FormData).get("payload")))
    expect(payload).toMatchObject({ maintenance: false, maintenanceItems: [] })
    const alert = await sheet.findByRole("alert")
    expect(alert.textContent).toContain("Cada ítem necesita al menos 3 caracteres.")
  })

  it("un error del servidor queda en el formulario, bajo su campo", async () => {
    createWorkOrderAction.mockResolvedValue({ ok: false, message: "Revisa los campos marcados.", fieldErrors: { repairDescription: ["Describe la reparación que se pide."] } })
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    fireEvent.focus(sheet.getByRole("combobox", { name: /Equipo/ }))
    fireEvent.mouseDown(await screen.findByRole("option", { name: /EX-04/ }))
    fireEvent.click(sheet.getByRole("button", { name: "Crear orden" }))
    expect((await sheet.findByText("Describe la reparación que se pide.")).getAttribute("role")).toBe("alert")
    expect(push).not.toHaveBeenCalled()
  })
})

describe("buildCreatePayload", () => {
  const values = {
    vehicleId: "veh-1", repair: false, maintenance: true, requestDate: "2026-11-02", requesterName: "  Ana  ", repairDescription: "ignorada", observations: "  ",
    annexItems: ["x"], maintenanceItems: [" Cambio de aceite ", "", "  "], assignedToUserId: "",
    actionType: "" as const, specialties: [] as never[], executionWorksiteId: "",
  }
  it("descarta la reparación y sus ítems si no se marcó (OT-5), recorta textos y quita líneas vacías", () => {
    expect(buildCreatePayload(values, "cid")).toEqual({
      clientRequestId: "cid", vehicleId: "veh-1", repair: false, maintenance: true, requestDate: "2026-11-02", requesterName: "Ana", repairDescription: null,
      observations: null, annexItems: [], maintenanceItems: ["Cambio de aceite"], assignedToUserId: null,
      actionType: null, specialties: [], executionWorksiteId: null,
    })
  })

  it("los ítems de «Mantención» tampoco viajan si esa casilla está desmarcada", () => {
    expect(buildCreatePayload({ ...values, repair: true, maintenance: false, annexItems: [" a revisar "], maintenanceItems: ["oculto"] }, "cid")).toMatchObject({
      annexItems: ["a revisar"], maintenanceItems: [],
    })
  })

  it("lleva el tipo de acción, las especialidades y la faena de ejecución", () => {
    expect(buildCreatePayload({ ...values, actionType: "preventiva", specialties: ["mecanica", "soldadura"], executionWorksiteId: "ws-2" }, "cid")).toMatchObject({
      actionType: "preventiva", specialties: ["mecanica", "soldadura"], executionWorksiteId: "ws-2",
    })
  })

  it("el tipo prellena las casillas: correctiva = reparación; preventiva y predictiva = mantención", () => {
    expect(checksForActionType("correctiva")).toEqual({ repair: true, maintenance: false })
    expect(checksForActionType("preventiva")).toEqual({ repair: false, maintenance: true })
    expect(checksForActionType("predictiva")).toEqual({ repair: false, maintenance: true })
  })
})

describe("«Nueva orden»: el tipo de acción prellena las casillas (sólo en el alta)", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it("elegir «Preventiva» marca Mantención y desmarca Reparación; en «Editar orden» no se toca (OT4-6)", async () => {
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    expect((sheet.getByRole("checkbox", { name: "Reparación" }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(sheet.getByRole("combobox", { name: /Tipo de acción/ }))
    fireEvent.click(await screen.findByRole("option", { name: "Preventiva" }))
    expect((sheet.getByRole("checkbox", { name: "Reparación" }) as HTMLInputElement).checked).toBe(false)
    expect((sheet.getByRole("checkbox", { name: "Mantención" }) as HTMLInputElement).checked).toBe(true)
    // En el alta, la ayuda sigue explicando el prellenado y no hay avisos de lo que se borra.
    expect(sheet.getByText(/Al elegirla se marca Reparación/)).toBeTruthy()
    expect(sheet.queryByRole("status")?.textContent ?? "").toBe("")
  })

  it("el aviso de lo que se borra sólo existe al editar: en el alta no hay nada guardado que perder", async () => {
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    fireEvent.change(sheet.getByRole("textbox", { name: /^Reparación/ }), { target: { value: "Fuga de aceite" } })
    fireEvent.click(sheet.getByRole("checkbox", { name: "Reparación" }))
    expect(sheet.queryByText(/Al guardar se borra/)).toBeNull()
  })
})

describe("discardNotices (OT4-6)", () => {
  const base = { repair: true, maintenance: true, repairDescription: "", annexItems: [] as string[], maintenanceItems: [] as string[] }

  it("sin tipos desmarcados, o desmarcados sin contenido, no avisa nada", () => {
    expect(discardNotices(base)).toEqual({ repair: null, maintenance: null })
    expect(discardNotices({ ...base, repair: false, repairDescription: "   ", annexItems: ["", "  "] })).toEqual({ repair: null, maintenance: null })
    // Con la casilla marcada el contenido viaja: no se pierde.
    expect(discardNotices({ ...base, repairDescription: "Fuga", annexItems: ["a"], maintenanceItems: ["b"] })).toEqual({ repair: null, maintenance: null })
  })

  it("dice qué se borra, con el verbo y los números concordados", () => {
    expect(discardNotices({ ...base, repair: false, repairDescription: "Fuga" }).repair).toBe("Al guardar se borra la descripción.")
    expect(discardNotices({ ...base, repair: false, annexItems: ["a"] }).repair).toBe("Al guardar se borra 1 trabajo anexo.")
    expect(discardNotices({ ...base, repair: false, annexItems: ["a", " b "] }).repair).toBe("Al guardar se borran 2 trabajos anexos.")
    expect(discardNotices({ ...base, repair: false, repairDescription: "Fuga", annexItems: ["a", "b"] }).repair).toBe("Al guardar se borran la descripción y 2 trabajos anexos.")
    expect(discardNotices({ ...base, repair: false, repairDescription: "Fuga", annexItems: ["a"] }).repair).toBe("Al guardar se borran la descripción y 1 trabajo anexo.")
    expect(discardNotices({ ...base, maintenance: false, maintenanceItems: ["a"] }).maintenance).toBe("Al guardar se borra 1 mantención solicitada.")
    expect(discardNotices({ ...base, maintenance: false, maintenanceItems: ["a", "b", ""] }).maintenance).toBe("Al guardar se borran 2 mantenciones solicitadas.")
  })
})

describe("clasificación Trinorma en el formulario", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it("muestra la faena de imputación del equipo (no editable) y marca el tipo como obligatorio con el interruptor", async () => {
    render(<NewWorkOrderCta {...BASE} actionTypeRequired worksites={[{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Santa Fe" }]} />)
    const sheet = await openSheet()
    fireEvent.focus(sheet.getByRole("combobox", { name: /Equipo/ }))
    fireEvent.mouseDown(await screen.findByRole("option", { name: /KA-135 · RBYD-98/ }))
    const imputation = sheet.getByRole("textbox", { name: /Faena de imputación/ }) as HTMLInputElement
    expect(imputation.value).toBe("Biodiversa")
    expect(imputation.readOnly).toBe(true)
    expect(sheet.getByText("Tipo de acción").parentElement?.textContent).toContain("*")
    expect(sheet.getByText("Faena de ejecución (opcional)")).toBeTruthy()
  })

  it("las especialidades viajan en el payload", async () => {
    createWorkOrderAction.mockResolvedValue({ ok: false, message: "x" })
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    fireEvent.focus(sheet.getByRole("combobox", { name: /Equipo/ }))
    fireEvent.mouseDown(await screen.findByRole("option", { name: /EX-04/ }))
    fireEvent.click(sheet.getByRole("checkbox", { name: "Eléctrica" }))
    fireEvent.click(sheet.getByRole("checkbox", { name: "Mecánica" }))
    fireEvent.click(sheet.getByRole("button", { name: "Crear orden" }))
    await waitFor(() => expect(createWorkOrderAction).toHaveBeenCalled())
    const payload = JSON.parse(String((createWorkOrderAction.mock.calls[0]![1] as FormData).get("payload")))
    expect(payload.specialties).toEqual(["mecanica", "electrica"])
    expect(payload.actionType).toBeNull()
  })
})
