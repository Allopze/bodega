// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

Element.prototype.scrollIntoView = function scrollIntoView() {}

const push = vi.fn()
const createWorkOrderAction = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/app/(app)/mantencion/ot/actions", () => ({ createWorkOrderAction: (...args: unknown[]) => createWorkOrderAction(...args) }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const { NewWorkOrderCta, buildCreatePayload } = await import("./new-ot-sheet")

const EQUIPMENT = [
  { id: "veh-1", code: "KA-135", plate: "RBYD-98", typeName: "Camión", worksiteId: "ws-1", worksiteName: "Biodiversa", unit: "km" as const },
  { id: "veh-2", code: "EX-04", plate: "EX-04", typeName: "Excavadora", worksiteId: "ws-2", worksiteName: "Santa Fe", unit: "h" as const },
]

const BASE = { equipment: EQUIPMENT, mechanics: null, today: "2026-11-02", defaultRequesterName: "Ana Pérez" }

async function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Nueva OT/ }))
  return within(await screen.findByRole("dialog"))
}

describe("«Nueva OT»", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it("parte con la fecha de hoy y el solicitante por defecto, y no deja crear sin equipo", async () => {
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    expect((sheet.getByRole("textbox", { name: /Solicitante/ }) as HTMLInputElement).value).toBe("Ana Pérez")
    expect(sheet.getByRole("button", { name: /Fecha de la OT/ }).textContent).toContain("02-11-2026")
    expect((sheet.getByRole("button", { name: "Crear OT" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("el campo de costo dice mano de obra / taller externo y aclara que lo comprado por OC se suma solo", async () => {
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    expect(sheet.getByLabelText("Costo mano de obra / taller externo (CLP, opcional)")).toBeTruthy()
    expect(sheet.getByText("Sólo mano de obra o taller externo. Los repuestos y servicios comprados por OC se suman solos desde la solicitud vinculada.")).toBeTruthy()
    expect(sheet.queryByText(/Costo total/)).toBeNull()
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
    fireEvent.click(sheet.getByRole("button", { name: "Crear OT" }))

    await waitFor(() => expect(createWorkOrderAction).toHaveBeenCalled())
    const formData = createWorkOrderAction.mock.calls[0]![1] as FormData
    const payload = JSON.parse(String(formData.get("payload")))
    expect(payload).toMatchObject({
      vehicleId: "veh-1", repair: true, maintenance: false, requestDate: "2026-11-02", requesterName: "Ana Pérez",
      repairDescription: "Pierde aceite por el cárter", observations: null, totalCost: null, annexItems: ["Cambiar pastillas de freno"], maintenanceItems: [], assignedToUserId: null,
    })
    expect(payload.clientRequestId).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(push).toHaveBeenCalledWith("/mantencion/ot/ot-3"))
  })

  it("un error del servidor queda en el formulario, bajo su campo", async () => {
    createWorkOrderAction.mockResolvedValue({ ok: false, message: "Revisa los campos marcados.", fieldErrors: { repairDescription: ["Describe la reparación que se pide."] } })
    render(<NewWorkOrderCta {...BASE} />)
    const sheet = await openSheet()
    fireEvent.focus(sheet.getByRole("combobox", { name: /Equipo/ }))
    fireEvent.mouseDown(await screen.findByRole("option", { name: /EX-04/ }))
    fireEvent.click(sheet.getByRole("button", { name: "Crear OT" }))
    expect((await sheet.findByText("Describe la reparación que se pide.")).getAttribute("role")).toBe("alert")
    expect(push).not.toHaveBeenCalled()
  })
})

describe("buildCreatePayload", () => {
  const values = {
    vehicleId: "veh-1", repair: false, maintenance: true, requestDate: "2026-11-02", requesterName: "  Ana  ", repairDescription: "ignorada", observations: "  ",
    totalCost: "125000",
    annexItems: ["x"], maintenanceItems: [" Cambio de aceite ", "", "  "], assignedToUserId: "",
  }
  it("descarta la reparación si no se marcó, recorta textos y quita líneas vacías", () => {
    expect(buildCreatePayload(values, "cid")).toEqual({
      clientRequestId: "cid", vehicleId: "veh-1", repair: false, maintenance: true, requestDate: "2026-11-02", requesterName: "Ana", repairDescription: null,
      observations: null, totalCost: 125000, annexItems: ["x"], maintenanceItems: ["Cambio de aceite"], assignedToUserId: null,
    })
  })

  it("un costo vacío viaja como null, no como 0", () => {
    expect(buildCreatePayload({ ...values, totalCost: "" }, "cid").totalCost).toBeNull()
  })
})
