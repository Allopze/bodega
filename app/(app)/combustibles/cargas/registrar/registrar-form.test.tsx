// @vitest-environment jsdom
import * as React from "react"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { FieldLoadConfig } from "@/components/combustibles/field-load/types"

const replace = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/pwa/tae-offline-queue", () => ({
  getTaeDraft: vi.fn().mockResolvedValue(null),
  saveTaeDraft: vi.fn().mockResolvedValue(undefined),
  clearTaeDraft: vi.fn().mockResolvedValue(undefined),
  getTaeDraftPhotos: vi.fn().mockResolvedValue({}),
  saveTaeDraftPhotos: vi.fn().mockResolvedValue(undefined),
  getTaeIdentity: vi.fn().mockResolvedValue(null),
  saveTaeIdentity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/pwa/image-compress", () => ({ compressPhoto: vi.fn(async (file: File) => file) }))
// El selector de fecha del sistema abre un calendario en un popover: aquí basta un campo con el mismo valor local.
vi.mock("@/components/ui/date-time-picker", () => ({
  DateTimePicker: ({ id, value, onChange }: { id?: string; value?: string; onChange?: (value: string) => void }) => (
    <input id={id ? `${id}-date` : undefined} aria-label="Fecha y hora de la carga" value={value ?? ""} onChange={(event) => onChange?.(event.target.value)} />
  ),
}))

const { RegistrarForm } = await import("./registrar-form")
const { RegistrarResultado } = await import("./registrar-resultado")
const { addDaysToPlainDate, todayInChile } = await import("@/lib/utils")

const WORKSITES = [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Santa Fe" }]
const POINTS = [
  { id: "lp-1", name: "Surtidor principal", worksiteId: "ws-1" },
  { id: "lp-2", name: "Camión surtidor CS-02", worksiteId: "ws-1" },
  { id: "lp-3", name: "Surtidor Santa Fe", worksiteId: "ws-2" },
]
const CONFIG: FieldLoadConfig = {
  worksite: { id: "ws-1", name: "Biodiversa" },
  loadingPoint: { id: "lp-1", name: "Surtidor principal", type: "fixed_dispenser" },
  vehicles: [
    { id: "veh-1", code: "CA-14", plate: "KPRT14", type: "camion", meterType: "odometer", tankCapacityLiters: 400, products: [{ id: "prod-1", name: "Diésel", unit: "liter" }] },
    { id: "veh-2", code: "CM-11", plate: "HHRS11", type: "camion", meterType: "odometer", tankCapacityLiters: 400, products: [{ id: "prod-1", name: "Diésel", unit: "liter" }] },
  ],
  supplyMedia: [{ id: "medium-1", name: "Surtidor" }],
}
const PAST_WINDOW = { earliestDay: addDaysToPlainDate(todayInChile(), -62), latestDay: todayInChile() }
const PAST_AT = `${addDaysToPlainDate(todayInChile(), -3)}T10:30`
const REASON = "Se anotó en papel y no se ingresó a tiempo"

type Props = Partial<React.ComponentProps<typeof RegistrarForm>>
function renderForm(props: Props = {}) {
  return render(
    <RegistrarForm
      worksites={WORKSITES}
      points={POINTS}
      worksiteId="ws-1"
      pointId="lp-1"
      config={CONFIG}
      pastWindow={null}
      canView
      {...props}
    />,
  )
}

const next = () => screen.getByRole("button", { name: "Siguiente" })
const stepLabel = (n: number) => screen.getByText(`Paso ${n} de 7`)

beforeAll(() => {
  // Radix Select pide estas APIs del puntero y del scroll, que jsdom no trae.
  Object.assign(window.HTMLElement.prototype, {
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
    scrollIntoView: () => {},
  })
})

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("RegistrarForm — paso 1: faena y punto de carga", () => {
  it("el primer paso es «Dónde», de siete, y no deja seguir sin faena ni punto", () => {
    renderForm({ worksiteId: "", pointId: "", config: null })
    expect(stepLabel(1)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Dónde" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Faena" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Punto de carga" })).toBeDisabled()

    fireEvent.click(next())
    expect(screen.getByText("Elige la faena donde cargaste.")).toBeInTheDocument()
    expect(screen.queryByText("Paso 2 de 7")).toBeNull()
  })

  it("elegir la faena actualiza la URL con replace y sin saltar el scroll, y deja elegido el punto único", async () => {
    renderForm({ worksiteId: "", pointId: "", config: null })
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Faena" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("option", { name: "Santa Fe" }))
    expect(replace).toHaveBeenCalledWith("/combustibles/cargas/registrar?faena=ws-2&punto=lp-3", { scroll: false })
  })

  it("una faena con varios puntos no elige ninguno: hay que escoger el punto", async () => {
    renderForm({ worksiteId: "", pointId: "", config: null })
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Faena" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("option", { name: "Biodiversa" }))
    expect(replace).toHaveBeenCalledWith("/combustibles/cargas/registrar?faena=ws-1", { scroll: false })
  })

  it("con faena y punto elegidos pasa al paso 2 de 7, el equipo, con su buscador dentro del paso", () => {
    renderForm()
    // El formulario ya está montado pero oculto: nada de él es visible en el paso 1.
    expect(screen.queryByRole("textbox", { name: "Buscar equipo por código o patente" })).toBeNull()
    fireEvent.click(next())

    expect(stepLabel(2)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Equipo" })).toBeInTheDocument()
    const search = screen.getByRole("textbox", { name: "Buscar equipo por código o patente" })
    expect(screen.getAllByRole("option")).toHaveLength(2)
    fireEvent.change(search, { target: { value: "hhrs" } })
    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(screen.getByRole("option", { name: /CM-11/ })).toBeInTheDocument()
  })

  it("desde el primer paso del formulario, «Atrás» vuelve al paso 1; el resumen final también lo puede cambiar", () => {
    renderForm()
    fireEvent.click(next())
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }))
    expect(stepLabel(1)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Dónde" })).toBeInTheDocument()
  })

  it("mientras llegan los equipos de la faena elegida avisa y no deja seguir", () => {
    renderForm({ config: null })
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled()
    expect(screen.getByText(/No se pudieron cargar los equipos de esta faena/)).toBeInTheDocument()
  })
})

describe("RegistrarForm — «¿Es una carga de otro día?»", () => {
  it("sin el permiso (sin ventana de fechas) el bloque no existe", () => {
    renderForm({ pastWindow: null })
    expect(screen.queryByText("¿Es una carga de otro día?")).toBeNull()
    expect(screen.queryByRole("button", { name: /otro día/ })).toBeNull()
  })

  it("con el permiso viene plegado y se abre a pedido, con fecha, hora y motivo", () => {
    renderForm({ pastWindow: PAST_WINDOW })
    const toggle = screen.getByRole("button", { name: /¿Es una carga de otro día\?/ })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByLabelText("Motivo")).toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByLabelText("Fecha y hora de la carga")).toBeInTheDocument()
    expect(screen.getByLabelText("Motivo")).toBeInTheDocument()
    expect(screen.getByText(/Hasta 62 días atrás/)).toBeInTheDocument()
  })

  it("abierto, la fecha y el motivo se exigen en palabras antes de seguir", () => {
    renderForm({ pastWindow: PAST_WINDOW })
    fireEvent.click(screen.getByRole("button", { name: /¿Es una carga de otro día\?/ }))
    fireEvent.click(next())
    expect(screen.getByText("Indica la fecha y la hora en que se hizo la carga.")).toBeInTheDocument()
    expect(stepLabel(1)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Fecha y hora de la carga"), { target: { value: PAST_AT } })
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "olvido" } })
    fireEvent.click(next())
    expect(screen.getByText(/al menos 10 caracteres/, { selector: "p[role='alert']" })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Fecha y hora de la carga"), { target: { value: `${addDaysToPlainDate(todayInChile(), -63)}T10:30` } })
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: REASON } })
    fireEvent.click(next())
    expect(screen.getByText(/Solo se pueden registrar cargas de hasta 62 días atrás/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Fecha y hora de la carga"), { target: { value: PAST_AT } })
    fireEvent.click(next())
    expect(stepLabel(2)).toBeInTheDocument()
  })

  it("en una carga de otro día las fotos se ofrecen como opcionales y no bloquean el paso", () => {
    renderForm({ pastWindow: PAST_WINDOW })
    fireEvent.click(screen.getByRole("button", { name: /¿Es una carga de otro día\?/ }))
    fireEvent.change(screen.getByLabelText("Fecha y hora de la carga"), { target: { value: PAST_AT } })
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: REASON } })
    fireEvent.click(next())
    fireEvent.click(screen.getByRole("option", { name: /CA-14/ }))
    fireEvent.click(next())

    expect(stepLabel(3)).toBeInTheDocument()
    expect(screen.getByText("Tomar foto del tablero (opcional)")).toBeInTheDocument()
    fireEvent.change(document.getElementById("tae-meter-reading")!, { target: { value: "182310" } })
    fireEvent.click(next())
    expect(stepLabel(4)).toBeInTheDocument()
  })

  it("una carga de hoy sigue exigiendo la foto del tablero", () => {
    renderForm({ pastWindow: PAST_WINDOW })
    fireEvent.click(next())
    fireEvent.click(screen.getByRole("option", { name: /CA-14/ }))
    fireEvent.click(next())
    fireEvent.change(document.getElementById("tae-meter-reading")!, { target: { value: "182310" } })
    fireEvent.click(next())
    expect(screen.getByText("Falta la foto del tablero con la lectura.")).toBeInTheDocument()
    expect(stepLabel(3)).toBeInTheDocument()
  })
})

/** Recorre del paso 2 al resumen de una carga de otro día, sin fotos. */
async function fillUntilReview() {
  fireEvent.click(screen.getByRole("button", { name: /¿Es una carga de otro día\?/ }))
  fireEvent.change(screen.getByLabelText("Fecha y hora de la carga"), { target: { value: PAST_AT } })
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: REASON } })
  fireEvent.click(next())
  fireEvent.click(screen.getByRole("option", { name: /CA-14/ }))
  fireEvent.click(next())
  fireEvent.change(document.getElementById("tae-meter-reading")!, { target: { value: "182310" } })
  fireEvent.click(next())
  fireEvent.change(document.getElementById("tae-liters")!, { target: { value: "185" } })
  fireEvent.click(next())
  fireEvent.change(document.getElementById("tae-removed")!, { target: { value: "S-1" } })
  fireEvent.change(document.getElementById("tae-installed")!, { target: { value: "S-2" } })
  fireEvent.click(next())
  fireEvent.change(document.getElementById("tae-driver")!, { target: { value: "Juan Pérez" } })
  fireEvent.change(document.getElementById("tae-supervisor")!, { target: { value: "Rodrigo Pino" } })
  fireEvent.click(next())
  await screen.findByText("Paso 7 de 7")
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const sentPayloads = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body instanceof FormData ? ((init as RequestInit).body as FormData).get("payload") : "{}")))

describe("RegistrarForm — enviar y pantalla final", () => {
  it("el resumen muestra dónde y cuándo, y una posible duplicada deja ver la otra carga y registrar igual", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(422, {
        ok: false,
        code: "possible_duplicate",
        message: "Ya hay una carga de este equipo el 28-10-2026 10:25 con 185 L.",
        duplicateOf: { id: "sub-9", href: "/combustibles/cargas/terreno/sub-9" },
      }))
      .mockResolvedValueOnce(jsonResponse(201, {
        ok: true,
        data: { id: "sub-1", duplicate: false, review: { loadId: "load-1", status: "flagged", flagReasons: ["late_entry"] } },
      }))
    vi.stubGlobal("fetch", fetchMock)
    renderForm({ pastWindow: PAST_WINDOW })
    await fillUntilReview()

    // Dónde y cuándo van arriba del resumen, cada uno con su «Cambiar».
    expect(screen.getByText("Biodiversa · Surtidor principal")).toBeInTheDocument()
    expect(screen.getByText("Fecha de la carga")).toBeInTheDocument()
    expect(screen.getByText(/La plataforma guarda además el día en que la ingresas/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Enviar carga" }))
    expect(await screen.findByText(/Ya hay una carga de este equipo el 28-10-2026/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Ver la otra carga/ })).toHaveAttribute("href", "/combustibles/cargas/terreno/sub-9")
    expect(screen.queryByRole("button", { name: "Enviar carga" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Registrar de todos modos" }))
    expect(await screen.findByRole("heading", { name: "Carga registrada" })).toBeInTheDocument()

    const [first, second] = sentPayloads(fetchMock)
    expect(first.pastLoad).toEqual({ loadedAt: PAST_AT, reason: REASON })
    expect(first).not.toHaveProperty("acknowledgeDuplicate")
    expect(second.acknowledgeDuplicate).toBe(true)
    // Es la misma carga: reintentar con la confirmación conserva la clave de idempotencia.
    expect(second.clientSubmissionId).toBe(first.clientSubmissionId)
    expect(second).toMatchObject({ vehicleId: "veh-1", liters: 185, meterReading: 182310, worksiteId: "ws-1", loadingPointId: "lp-1" })
  })

  it("al registrarse, dice que quedó por decidir con el motivo en palabras y enlaza la ficha y la bandeja", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, {
      ok: true,
      data: { id: "sub-1", duplicate: false, review: { loadId: "load-1", status: "flagged", flagReasons: ["late_entry"] } },
    })))
    renderForm({ pastWindow: PAST_WINDOW })
    await fillUntilReview()
    fireEvent.click(screen.getByRole("button", { name: "Enviar carga" }))

    expect(await screen.findByRole("heading", { name: "Carga registrada" })).toBeInTheDocument()
    expect(screen.getByText("Quedó por decidir")).toBeInTheDocument()
    expect(screen.getByText("Registrada después (fecha pasada).")).toBeInTheDocument()
    expect(screen.queryByText("late_entry")).toBeNull()
    expect(screen.getByText(/Quedó guardada con la fecha y la hora que indicaste/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Ver la carga" })).toHaveAttribute("href", "/combustibles/cargas/terreno/sub-1")
    const inbox = screen.getByRole("link", { name: "Ir a Por revisar" }).getAttribute("href")!
    expect(inbox).toContain("/combustibles/revisar?")
    expect(inbox).toContain("tipo=carga")
    expect(inbox).toContain("faena=ws-1")
    expect(decodeURIComponent(inbox)).toContain("item=carga:load-1")
  })

  it("«Registrar otra carga» vuelve al paso 1 con la faena y el punto, y el bloque de otro día cerrado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { ok: true, data: { id: "sub-1", duplicate: false, review: null } })))
    renderForm({ pastWindow: PAST_WINDOW })
    await fillUntilReview()
    fireEvent.click(screen.getByRole("button", { name: "Enviar carga" }))
    await screen.findByRole("heading", { name: "Carga registrada" })

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Registrar otra carga" })) })
    expect(stepLabel(1)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /¿Es una carga de otro día\?/ })).toHaveAttribute("aria-expanded", "false")
  })

  it("una fecha rechazada por el servidor devuelve al paso 1, donde se corrige", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(422, {
      ok: false, code: "invalid_time", field: "pastLoadAt", message: "Solo se pueden registrar cargas de hasta 62 días atrás (desde el 30-08-2026).",
    })))
    renderForm({ pastWindow: PAST_WINDOW })
    await fillUntilReview()
    fireEvent.click(screen.getByRole("button", { name: "Enviar carga" }))
    // El error queda en el campo del paso 1 (el aviso del formulario oculto no cuenta como visible).
    expect(await screen.findByRole("alert")).toHaveTextContent(/Solo se pueden registrar cargas de hasta 62 días atrás/)
    expect(stepLabel(1)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /¿Es una carga de otro día\?/ })).toHaveAttribute("aria-expanded", "true")
  })
})

describe("RegistrarResultado", () => {
  const base = { worksiteId: "ws-1", onRestart: () => {} }

  it("una carga sin observaciones lo dice y no inventa un aviso", () => {
    render(<RegistrarResultado {...base} canView result={{ id: "sub-1", review: { loadId: "load-1", status: "ok", flagReasons: [] } }} />)
    expect(screen.getByRole("heading", { name: "Carga registrada" })).toBeInTheDocument()
    expect(screen.queryByText("Quedó por decidir")).toBeNull()
    expect(screen.getByText("La plataforma no encontró nada que revisar en esta carga.")).toBeInTheDocument()
    expect(screen.getByText("Quedó guardada con la fecha y la hora de la plataforma.")).toBeInTheDocument()
  })

  it("sin permiso de ver Combustible no ofrece enlaces que lo rechazarían", () => {
    render(<RegistrarResultado {...base} canView={false} result={{ id: "sub-1", review: { loadId: "load-1", status: "flagged", flagReasons: ["late_entry", "duplicate"] } }} />)
    expect(screen.getByText("Registrada después (fecha pasada); Posible carga duplicada.")).toBeInTheDocument()
    expect(within(screen.getByRole("status")).queryAllByRole("link")).toHaveLength(0)
    expect(screen.getByRole("button", { name: "Registrar otra carga" })).toBeInTheDocument()
  })

  it("reenviar una carga ya registrada no la duplica y lo dice", () => {
    render(<RegistrarResultado {...base} canView result={{ id: "sub-1", duplicate: true }} />)
    expect(screen.getByText("Esta carga ya estaba registrada: no se duplicó.")).toBeInTheDocument()
  })

  it("«Registrar otra carga» llama a onRestart", () => {
    const onRestart = vi.fn()
    render(<RegistrarResultado {...base} onRestart={onRestart} canView result={{ id: "sub-1" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar otra carga" }))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })
})
