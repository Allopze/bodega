// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { newDraft, newLine } from "./new-note-draft"
import { NEW_NOTE_OPTIONS, SINGLE_WORKSITE_OPTIONS } from "./new-note-fixtures"
import { draftStorageKey, writeDraft } from "./new-note-storage"

// jsdom no implementa `scrollIntoView`, que Radix Select llama al abrir la lista.
Element.prototype.scrollIntoView = function scrollIntoView() {}

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), refresh: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const actions = vi.hoisted(() => ({ createPartsNoteAction: vi.fn(), searchNoteSparePartsAction: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/mantencion/notas-pedido/nueva", useSearchParams: () => new URLSearchParams() }))
vi.mock("@/lib/toast", () => ({ toast }))
vi.mock("@/app/(app)/mantencion/notas-pedido/nueva/actions", () => actions)

const { NewNoteForm } = await import("./new-note-form")

const USER = "u-mec"
const CREATED = { ok: true, message: "Nota NP-2026-0007 creada.", data: { noteId: "n-1", code: "NP-2026-0007", duplicate: false } }
const FILTER = { id: "p-1", sku: "RPT-0001", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "CAT", unitOfMeasure: "litro", lastPrice: null, referencePrice: null, preferredSupplierId: null, purchasedForVehicleIds: [] }

const picker = () => screen.getByRole("combobox", { name: /^Repuesto/ })
const quantity = () => screen.getByLabelText(/^Cantidad/)
const send = () => screen.getByRole("button", { name: "Enviar nota" })
const sentInput = (call = 0) => actions.createPartsNoteAction.mock.calls[call]![0] as { clientOpId: string; lines: Array<Record<string, unknown>> } & Record<string, unknown>

function renderForm(props: Partial<React.ComponentProps<typeof NewNoteForm>> = {}) {
  return render(<NewNoteForm userId={USER} options={SINGLE_WORKSITE_OPTIONS} {...props} />)
}

/** Espera a que el formulario termine de montar (el borrador se lee en un efecto) y llena la primera línea. */
async function fillFirstLine(description = "Filtro de aceite", amount = "2") {
  await waitFor(() => expect(picker()).toBeInTheDocument())
  fireEvent.change(picker(), { target: { value: description } })
  fireEvent.change(quantity(), { target: { value: amount } })
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  actions.createPartsNoteAction.mockResolvedValue(CREATED)
  actions.searchNoteSparePartsAction.mockResolvedValue({ ok: true, parts: [] })
})
afterEach(cleanup)

describe("envío", () => {
  it("manda la nota con su id de operación, borra el borrador y abre el detalle", async () => {
    renderForm()
    await fillFirstLine()
    expect(screen.getByRole("textbox", { name: /^Faena/ })).toHaveValue("Biodiversa")
    fireEvent.click(send())
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/mantencion/notas-pedido/n-1"))
    expect(actions.createPartsNoteAction).toHaveBeenCalledTimes(1)
    expect(sentInput()).toMatchObject({
      clientOpId: expect.stringMatching(/^.{8,64}$/), worksiteId: "ws-1", workOrderId: null, urgent: false, notes: null,
      lines: [{ description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", partNumber: null, productId: null, chargeVehicleId: null, chargeCostCenterId: null, suggestedSupplierId: null }],
    })
    expect(toast.success).toHaveBeenCalledWith("Nota NP-2026-0007 creada.")
    expect(localStorage.getItem(draftStorageKey(USER))).toBeNull()
  })

  it("Enter dentro de un campo no envía la nota: sólo el botón (la cantidad por omisión no puede mandarla a medias)", async () => {
    renderForm()
    await fillFirstLine()
    expect(fireEvent.keyDown(picker(), { key: "Enter" })).toBe(false)
    expect(fireEvent.keyDown(quantity(), { key: "Enter" })).toBe(false)
    expect(fireEvent.keyDown(screen.getByLabelText(/^Observación/), { key: "Enter" })).toBe(true)
    expect(fireEvent.keyDown(send(), { key: "Enter" })).toBe(true)
    expect(actions.createPartsNoteAction).not.toHaveBeenCalled()
  })

  it("sin lo mínimo no llama al servidor y dice qué falta", async () => {
    renderForm()
    await waitFor(() => expect(picker()).toBeInTheDocument())
    fireEvent.click(send())
    expect(await screen.findByText("Agrega al menos un repuesto.")).toBeInTheDocument()
    expect(screen.getByText("Revisa los campos marcados.")).toBeInTheDocument()
    expect(screen.getByText("Describe el repuesto (al menos 3 letras).")).toBeInTheDocument()
    expect(actions.createPartsNoteAction).not.toHaveBeenCalled()
  })

  it("un rechazo del servidor deja todo lo escrito, muestra el error bajo su línea y el reintento usa el MISMO id de operación", async () => {
    const message = "El equipo de cargo de «Filtro de aceite» no está hoy en la faena de la nota."
    actions.createPartsNoteAction.mockResolvedValueOnce({ ok: false, message, fieldErrors: { "lines.0.chargeVehicleId": [message] } })
    renderForm()
    await fillFirstLine()
    fireEvent.click(send())
    await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(1))
    expect(screen.getByText(/la nota no se duplica/)).toBeInTheDocument()
    expect(picker()).toHaveValue("Filtro de aceite")
    expect(quantity()).toHaveValue("2")
    expect(localStorage.getItem(draftStorageKey(USER))).not.toBeNull()
    expect(router.replace).not.toHaveBeenCalled()

    await waitFor(() => expect(send()).toBeEnabled())
    fireEvent.click(send())
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/mantencion/notas-pedido/n-1"))
    expect(sentInput(1).clientOpId).toBe(sentInput(0).clientOpId)
  })

  it("sin conexión el envío no rompe la pantalla ni pierde nada: avisa, conserva el borrador y se puede reintentar sin duplicar", async () => {
    actions.createPartsNoteAction.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    renderForm()
    await fillFirstLine("Bomba hidráulica", "1")
    fireEvent.click(send())
    expect(await screen.findByText(/Sin conexión: no se pudo enviar/)).toBeInTheDocument()
    expect(picker()).toHaveValue("Bomba hidráulica")
    const stored = JSON.parse(localStorage.getItem(draftStorageKey(USER))!)
    expect(stored.draft.lines[0].description).toBe("Bomba hidráulica")

    await waitFor(() => expect(send()).toBeEnabled())
    fireEvent.click(send())
    await waitFor(() => expect(router.replace).toHaveBeenCalled())
    expect(sentInput(1).clientOpId).toBe(sentInput(0).clientOpId)
    expect(stored.draft.clientOpId).toBe(sentInput(0).clientOpId)
  })

  it("si el id del borrador ya creó una nota para otra orden, el reintento no queda trabado: id nuevo y un aviso claro", async () => {
    actions.createPartsNoteAction.mockResolvedValueOnce({ ok: false, message: "Ese identificador ya se usó en otra orden." })
    renderForm()
    await fillFirstLine()
    fireEvent.click(send())
    expect(await screen.findByText(/ya se había enviado, para otra orden de trabajo/)).toBeInTheDocument()
    await waitFor(() => expect(send()).toBeEnabled())
    fireEvent.click(send())
    await waitFor(() => expect(router.replace).toHaveBeenCalled())
    expect(sentInput(1).clientOpId).not.toBe(sentInput(0).clientOpId)
  })

  it("si la nota ya se había creado (la respuesta se perdió), reabre esa misma nota", async () => {
    actions.createPartsNoteAction.mockResolvedValueOnce({ ok: true, message: "La nota NP-2026-0007 ya estaba creada.", data: { noteId: "n-1", code: "NP-2026-0007", duplicate: true } })
    renderForm()
    await fillFirstLine()
    fireEvent.click(send())
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/mantencion/notas-pedido/n-1"))
    expect(toast.success).toHaveBeenCalledWith("La nota NP-2026-0007 ya estaba creada.")
  })
})

describe("borrador", () => {
  it("lo escrito se guarda en el equipo en cada cambio, y una pantalla en blanco no deja borrador", async () => {
    renderForm()
    await waitFor(() => expect(picker()).toBeInTheDocument())
    expect(localStorage.getItem(draftStorageKey(USER))).toBeNull()
    fireEvent.change(picker(), { target: { value: "Rodamiento" } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem(draftStorageKey(USER))!).draft.lines[0].description).toBe("Rodamiento"))
    fireEvent.change(picker(), { target: { value: "" } })
    await waitFor(() => expect(localStorage.getItem(draftStorageKey(USER))).toBeNull())
  })

  it("se restaura al volver, con su id de operación, y «Empezar de nuevo» lo descarta", async () => {
    const draft = { ...newDraft(SINGLE_WORKSITE_OPTIONS), clientOpId: "op-guardada-1", urgent: true, notes: "Para el lunes", lines: [{ ...newLine("l1"), description: "Correa del alternador", quantity: "3" }] }
    writeDraft(USER, draft, new Date())
    renderForm()
    expect(await screen.findByText(/Recuperamos lo que dejaste escrito/)).toBeInTheDocument()
    expect(picker()).toHaveValue("Correa del alternador")
    expect(quantity()).toHaveValue("3")
    expect(screen.getByRole("checkbox", { name: /Es urgente/ })).toBeChecked()
    expect(screen.getByLabelText(/^Observación/)).toHaveValue("Para el lunes")

    fireEvent.click(send())
    await waitFor(() => expect(actions.createPartsNoteAction).toHaveBeenCalled())
    expect(sentInput().clientOpId).toBe("op-guardada-1")
    cleanup()

    writeDraft(USER, draft, new Date())
    renderForm()
    fireEvent.click(await screen.findByRole("button", { name: "Empezar de nuevo" }))
    await waitFor(() => expect(picker()).toHaveValue(""))
    expect(screen.queryByText(/Recuperamos/)).not.toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem(draftStorageKey(USER))).toBeNull())
  })

  it("el borrador de otra persona del mismo equipo no se ve", async () => {
    writeDraft("u-otro", { ...newDraft(SINGLE_WORKSITE_OPTIONS), clientOpId: "op-otro-1234", lines: [{ ...newLine("l1"), description: "Secreto", quantity: "1" }] }, new Date())
    renderForm()
    await waitFor(() => expect(picker()).toBeInTheDocument())
    expect(picker()).toHaveValue("")
    expect(screen.queryByText(/Recuperamos/)).not.toBeInTheDocument()
  })
})

describe("líneas, catálogo y OT", () => {
  it("elegir un repuesto del catálogo lo ata a la línea y toma su unidad; «Cambiar» vuelve al buscador", async () => {
    actions.searchNoteSparePartsAction.mockResolvedValue({ ok: true, parts: [FILTER] })
    renderForm()
    await waitFor(() => expect(picker()).toBeInTheDocument())
    fireEvent.change(picker(), { target: { value: "filtro" } })
    const option = await screen.findByRole("option", { name: /Filtro de aceite/ })
    expect(actions.searchNoteSparePartsAction).toHaveBeenCalledWith({ query: "filtro" })
    fireEvent.mouseDown(option)
    const chosen = await screen.findByRole("group", { name: "Repuesto elegido" })
    expect(chosen).toHaveTextContent("Filtro de aceite")
    expect(chosen).toHaveTextContent("1R-0750")
    // El N° de parte ya viene del catálogo: no se pide otra vez.
    expect(screen.queryByLabelText(/^N° de parte/)).not.toBeInTheDocument()

    fireEvent.change(quantity(), { target: { value: "5" } })
    fireEvent.click(send())
    await waitFor(() => expect(actions.createPartsNoteAction).toHaveBeenCalled())
    expect(sentInput().lines[0]).toMatchObject({ description: "Filtro de aceite", productId: "p-1", partNumber: "1R-0750", unitOfMeasure: "litro", quantity: 5 })
  })

  it("si el catálogo no responde, lo escrito sigue valiendo como texto libre", async () => {
    actions.searchNoteSparePartsAction.mockRejectedValue(new TypeError("Failed to fetch"))
    renderForm()
    await waitFor(() => expect(picker()).toBeInTheDocument())
    fireEvent.change(picker(), { target: { value: "empaquetadura" } })
    expect(await screen.findByText(/No se pudo buscar en el catálogo\. Puedes describirlo con tus palabras\./)).toBeInTheDocument()
    expect(picker()).toHaveValue("empaquetadura")
  })

  it("agrega y quita líneas (siempre queda una) y las vacías no se envían", async () => {
    renderForm()
    await fillFirstLine()
    expect(screen.queryByRole("button", { name: /Quitar el repuesto/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Agregar repuesto" }))
    expect(await screen.findByRole("heading", { name: "Repuesto 2" })).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole("combobox", { name: /^Repuesto/ })[1]))
    fireEvent.click(send())
    await waitFor(() => expect(actions.createPartsNoteAction).toHaveBeenCalled())
    expect(sentInput().lines).toHaveLength(1)
    cleanup()

    actions.createPartsNoteAction.mockClear()
    localStorage.clear()
    renderForm()
    await fillFirstLine("Bomba", "1")
    fireEvent.click(screen.getByRole("button", { name: "Agregar repuesto" }))
    expect(await screen.findByRole("button", { name: "Quitar el repuesto 2" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Quitar el repuesto 2" }))
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Repuesto 2" })).not.toBeInTheDocument())
  })

  it("con una OT en el enlace la faena queda elegida y el equipo de la OT es el cargo por defecto de la línea", async () => {
    renderForm({ options: NEW_NOTE_OPTIONS, initial: { workOrderId: "ot-1" } })
    await waitFor(() => expect(picker()).toBeInTheDocument())
    expect(screen.getByRole("combobox", { name: /^Faena/ })).toHaveTextContent("Biodiversa")
    expect(screen.getByLabelText(/^Orden de trabajo/)).toHaveValue("OT-0001")
    expect(screen.getByLabelText(/^Cargo a/)).toHaveValue("KA-135 · RBYD-98")
    fireEvent.change(picker(), { target: { value: "Filtro de aceite" } })
    fireEvent.click(send())
    await waitFor(() => expect(actions.createPartsNoteAction).toHaveBeenCalled())
    expect(sentInput()).toMatchObject({ worksiteId: "ws-1", workOrderId: "ot-1" })
    expect(sentInput().lines[0]).toMatchObject({ chargeVehicleId: "v-1", chargeCostCenterId: null })
  })

  it("con varias faenas en el alcance hay que elegir una antes de enviar", async () => {
    renderForm({ options: NEW_NOTE_OPTIONS })
    await fillFirstLine()
    fireEvent.click(send())
    expect(await screen.findByText("Elige la faena.")).toBeInTheDocument()
    expect(actions.createPartsNoteAction).not.toHaveBeenCalled()
  })
})
