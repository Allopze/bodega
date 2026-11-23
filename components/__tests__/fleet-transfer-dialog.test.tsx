// @vitest-environment jsdom
import * as React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { TransferCandidate } from "@/lib/services/fleet-transfers"

/**
 * «Trasladar equipos» (modal): el destino oculta lo que ya está allí, la casilla de
 * faena sólo marca lo visible (un filtro activo no puede arrastrar equipos ocultos),
 * y los errores del servidor aparecen donde se pueden corregir. Las acciones están
 * simuladas: aquí se prueba la interfaz, no el servicio.
 */

const actions = vi.hoisted(() => ({
  listTransferCandidatesAction: vi.fn(),
  transferVehiclesAction: vi.fn(),
}))
vi.mock("@/app/(app)/flota/traslados/actions", () => actions)

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))

// Radix Select no es operable en jsdom: se reemplaza por un <select> nativo con las mismas props.
vi.mock("@/components/ui/option-select", () => ({
  OptionSelect: (props: {
    options: Array<{ value: string; label: string }>; value?: string; emptyLabel?: string; placeholder?: string
    onValueChange?: (value: string) => void; id?: string; "aria-label"?: string; "aria-labelledby"?: string; "aria-describedby"?: string
  }) => (
    <select
      id={props.id} aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-describedby={props["aria-describedby"]}
      value={props.value ?? ""} onChange={(event) => props.onValueChange?.(event.target.value)}
    >
      <option value="">{props.emptyLabel ?? props.placeholder ?? ""}</option>
      {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}))

const { TransferDialog } = await import("@/components/fleet/transfer/transfer-dialog")
const { TransferButton } = await import("@/components/fleet/transfer/transfer-button")

const candidate = (code: string, worksiteId: string, patch: Partial<TransferCandidate> = {}): TransferCandidate => ({
  vehicleId: `v-${code}`, code, plate: `P-${code}`, typeName: "Camión", brand: "Scania",
  worksiteId, worksiteName: worksiteId === "ws-sf" ? "Santa Fe" : "Mininco",
  stayStartedOn: null, openWorkOrderFolio: null, providerMappingCount: 0, ...patch,
})

const CANDIDATES = [
  candidate("KA-70", "ws-sf"),
  candidate("KA-71", "ws-sf", { openWorkOrderFolio: "OT-55" }),
  candidate("KA-72", "ws-sf"),
  candidate("GR-50", "ws-sf", { typeName: "Grúa" }),
  candidate("KA-7A", "ws-mi"),
  candidate("GR-11", "ws-mi", { typeName: "Grúa" }),
]
const WORKSITES = [{ id: "ws-sf", name: "Santa Fe" }, { id: "ws-mi", name: "Mininco" }, { id: "ws-te", name: "Teno" }]
const WINDOW = { min: "2026-10-01", max: "2026-11-18" }

function renderDialog(props: { initialVehicleId?: string } = {}) {
  return render(
    <TransferDialog open onOpenChange={vi.fn()} candidates={CANDIDATES} worksites={WORKSITES} window={WINDOW} {...props} />,
  )
}

// El asterisco de «obligatorio» forma parte del texto del rótulo.
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`))
const checkbox = (name: string | RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement

beforeEach(() => { vi.clearAllMocks() })

describe("TransferDialog", () => {
  it("elegir el destino oculta los equipos que ya están en esa faena", () => {
    renderDialog()
    expect(screen.getByRole("region", { name: "Faena Mininco" })).toBeDefined()
    fireEvent.change(field("A la faena"), { target: { value: "ws-mi" } })
    expect(screen.queryByRole("region", { name: "Faena Mininco" })).toBeNull()
    expect(screen.queryByRole("checkbox", { name: /KA-7A/ })).toBeNull()
    expect(screen.getByRole("region", { name: "Faena Santa Fe" })).toBeDefined()
  })

  it("la casilla de la faena marca sólo los equipos visibles con el filtro activo", () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText("Buscar por código, patente o marca"), { target: { value: "KA-7" } })
    expect(screen.queryByRole("checkbox", { name: /GR-50/ })).toBeNull() // oculto por la búsqueda
    fireEvent.click(checkbox("Marcar todos los equipos de Santa Fe"))
    expect(checkbox(/KA-70/).checked).toBe(true)
    expect(checkbox(/KA-71/).checked).toBe(true)
    expect(checkbox(/KA-72/).checked).toBe(true)
    expect(checkbox(/KA-7A/).checked).toBe(false) // otra faena: su casilla es otra
    // Al limpiar el filtro, el equipo que estaba oculto sigue sin marcar y el pie cuenta tres.
    fireEvent.change(screen.getByLabelText("Buscar por código, patente o marca"), { target: { value: "" } })
    expect(checkbox(/GR-50/).checked).toBe(false)
    expect(screen.getByText(/^3 equipos por trasladar/)).toBeDefined()
    // Y desmarcar el grupo con el filtro puesto tampoco toca lo oculto.
    fireEvent.click(checkbox(/GR-50/))
    fireEvent.change(screen.getByLabelText("Buscar por código, patente o marca"), { target: { value: "KA-7" } })
    fireEvent.click(checkbox("Marcar todos los equipos de Santa Fe")) // ya completo: desmarca
    fireEvent.change(screen.getByLabelText("Buscar por código, patente o marca"), { target: { value: "" } })
    expect(checkbox(/GR-50/).checked).toBe(true)
    expect(checkbox(/KA-70/).checked).toBe(false)
  })

  it("el pie cuenta sólo lo marcado y el botón espera al menos un equipo", () => {
    renderDialog()
    const submit = screen.getByRole("button", { name: "Trasladar" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(screen.getByText("Marca los equipos que se trasladan.")).toBeDefined()
    fireEvent.click(checkbox(/KA-70/))
    expect(submit.disabled).toBe(false)
    expect(screen.getByText(/^1 equipo por trasladar/)).toBeDefined()
  })

  it("la nota de cada fila sólo aparece cuando el equipo está marcado", () => {
    renderDialog()
    expect(screen.queryByText(/Tiene la OT-55 abierta/)).toBeNull()
    fireEvent.click(checkbox(/KA-71/))
    expect(screen.getByText("Tiene la OT-55 abierta: sigue con el equipo; la recepción y la conformidad las da la faena de destino, y las horas quedan imputadas a Santa Fe")).toBeDefined()
  })

  it("un equipo marcado desde su ficha llega marcado", () => {
    renderDialog({ initialVehicleId: "v-KA-72" })
    expect(checkbox(/KA-72/).checked).toBe(true)
    expect(checkbox(/KA-70/).checked).toBe(false)
    expect(screen.getByText("1 equipo por trasladar · elige la faena de destino")).toBeDefined()
  })

  it("envía lo marcado, cierra, avisa y refresca; muestra el aviso de importación manual", async () => {
    actions.transferVehiclesAction.mockResolvedValue({
      ok: true, message: "Traslado T-001 registrado: 2 equipos.",
      data: { transferId: "t1", folio: "T-001", moved: 2, copecRecheckFrom: null, manualImportNotice: "Revisa la importación manual de Copec." },
    })
    const onOpenChange = vi.fn()
    render(<TransferDialog open onOpenChange={onOpenChange} candidates={CANDIDATES} worksites={WORKSITES} window={WINDOW} />)
    fireEvent.change(field("A la faena"), { target: { value: "ws-te" } })
    fireEvent.change(field("Motivo"), { target: { value: "Cambio de contrato en Teno" } })
    fireEvent.change(field("Autorizado por"), { target: { value: "Alexis Soto" } })
    fireEvent.click(checkbox(/KA-70/))
    fireEvent.click(checkbox(/KA-7A/))
    fireEvent.click(screen.getByRole("button", { name: "Trasladar" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(actions.transferVehiclesAction).toHaveBeenCalledWith({
      toWorksiteId: "ws-te", effectiveDate: "2026-11-18", reason: "Cambio de contrato en Teno", authorizedBy: "Alexis Soto",
      vehicleIds: ["v-KA-70", "v-KA-7A"],
    })
    // El aviso con el folio lleva el enlace a la lista de traslados.
    expect(toast.success).toHaveBeenCalledWith("Traslado T-001 registrado: 2 equipos.", expect.objectContaining({
      action: expect.objectContaining({ label: "Ver traslados", onClick: expect.any(Function) }),
    }))
    const [, options] = toast.success.mock.calls[0] as unknown as [string, { action: { onClick: () => void } }]
    options.action.onClick()
    expect(router.push).toHaveBeenCalledWith("/flota/traslados")
    expect(toast).toHaveBeenCalledWith("Revisa la importación manual de Copec.", expect.anything())
    expect(router.refresh).toHaveBeenCalled()
  })

  it("una fecha que no sirve para un equipo marcado se dice bajo su fila y bloquea «Trasladar» antes de enviar", () => {
    const arrived = [
      candidate("KA-70", "ws-sf", { stayStartedOn: "2026-11-18" }), // llegó hoy: la fecha por defecto (hoy) no es posterior
      candidate("KA-71", "ws-sf", { stayStartedOn: "2026-11-10" }),
    ]
    render(<TransferDialog open onOpenChange={vi.fn()} candidates={arrived} worksites={WORKSITES} window={WINDOW} />)
    const submit = screen.getByRole("button", { name: "Trasladar" }) as HTMLButtonElement
    const message = "Llegó a su faena actual el 18-11-2026: la fecha debe ser posterior."
    expect(screen.queryByText(message)).toBeNull() // sin marcar no hay mensaje
    fireEvent.click(checkbox(/KA-71/))
    expect(submit.disabled).toBe(false)
    fireEvent.click(checkbox(/KA-70/))
    expect(within(checkbox(/KA-70/).closest("li") as HTMLElement).getByText(message)).toBeDefined()
    expect(within(checkbox(/KA-71/).closest("li") as HTMLElement).queryByText(message)).toBeNull()
    expect(submit.disabled).toBe(true)
    fireEvent.click(checkbox(/KA-70/)) // se desmarca: el mensaje y el bloqueo se van
    expect(screen.queryByText(message)).toBeNull()
    expect(submit.disabled).toBe(false)
    expect(actions.transferVehiclesAction).not.toHaveBeenCalled()
  })

  it("no envía equipos que el destino dejó fuera de la lista", async () => {
    actions.transferVehiclesAction.mockResolvedValue({ ok: false, message: "Revisa los datos del traslado." })
    renderDialog()
    fireEvent.click(checkbox(/KA-7A/)) // marcado mientras no hay destino
    fireEvent.change(field("A la faena"), { target: { value: "ws-mi" } }) // KA-7A deja de listarse
    fireEvent.click(checkbox(/KA-70/))
    fireEvent.click(screen.getByRole("button", { name: "Trasladar" }))
    await waitFor(() => expect(actions.transferVehiclesAction).toHaveBeenCalled())
    expect(actions.transferVehiclesAction.mock.calls[0]![0].vehicleIds).toEqual(["v-KA-70"])
  })

  it("los errores por campo y por fila del servidor aparecen donde se corrigen", async () => {
    actions.transferVehiclesAction.mockResolvedValue({
      ok: false, message: "Revisa los datos del traslado.",
      fieldErrors: { reason: "El motivo debe tener al menos 10 caracteres." },
      rowErrors: { "v-KA-72": "Ya está en Mininco." },
    })
    renderDialog()
    fireEvent.click(checkbox(/KA-70/))
    fireEvent.click(checkbox(/KA-72/))
    fireEvent.click(screen.getByRole("button", { name: "Trasladar" }))
    expect(await screen.findByText("El motivo debe tener al menos 10 caracteres.")).toBeDefined()
    const row = checkbox(/KA-72/).closest("li") as HTMLElement
    expect(within(row).getByText("Ya está en Mininco.")).toBeDefined()
    expect(within(checkbox(/KA-70/).closest("li") as HTMLElement).queryByText("Ya está en Mininco.")).toBeNull()
    expect(screen.getByText("Revisa los datos del traslado.")).toBeDefined()
    expect(router.refresh).not.toHaveBeenCalled()
  })
})

describe("TransferDialog en teléfono", () => {
  // jsdom no calcula estilos responsivos: se fija la estructura de clases que garantiza el comportamiento
  // (campos y lista scrollean juntos bajo `sm`, el pie queda fuera del área que scrollea).
  it("campos y lista comparten un solo scroll bajo sm y el pie queda fuera de él", () => {
    renderDialog()
    const body = screen.getByTestId("transfer-body")
    const list = screen.getByTestId("transfer-list")
    expect(body.className).toContain("overflow-y-auto")
    expect(body.className).toContain("sm:overflow-hidden")
    expect(body.contains(field("A la faena"))).toBe(true)
    expect(body.contains(list)).toBe(true)
    // La lista sólo tiene scroll propio desde sm: en móvil no compite con el del cuerpo.
    expect(list.className).not.toMatch(/(^|\s)overflow-y-auto/)
    expect(list.className).toContain("sm:overflow-y-auto")
    expect(body.contains(screen.getByRole("button", { name: "Trasladar" }))).toBe(false)
  })
})

describe("TransferButton", () => {
  it("carga los candidatos al abrir y monta el diálogo", async () => {
    actions.listTransferCandidatesAction.mockResolvedValue({ ok: true, data: { candidates: CANDIDATES, worksites: WORKSITES, window: WINDOW } })
    render(<TransferButton initialVehicleId="v-KA-70" />)
    expect(actions.listTransferCandidatesAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Trasladar equipos" }))
    expect(await screen.findByRole("dialog")).toBeDefined()
    expect(checkbox(/KA-70/).checked).toBe(true)
  })

  it("si no puede cargar los equipos lo avisa y no abre nada", async () => {
    actions.listTransferCandidatesAction.mockResolvedValue({ ok: false, message: "Los traslados aún no están habilitados." })
    render(<TransferButton />)
    fireEvent.click(screen.getByRole("button", { name: "Trasladar equipos" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Los traslados aún no están habilitados."))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
