// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/talana",
  useSearchParams: () => new URLSearchParams(nav.search),
}))

import { TalanaView, type ChangeTableRow, type DifferenceTableRow, type RunTableRow, type TalanaViewProps } from "./talana-view"

const DIFFERENCES: DifferenceTableRow[] = [
  { id: "d-1", personLabel: "Ana Pérez", rut: "11111111-1", codeLabel: "Faena distinta", detail: "Chome: Teno · Talana: Masisa", fixIn: "revisar", fixInLabel: "Revisar" },
  { id: "d-2", personLabel: "Beto Rojas", rut: "22222222-2", codeLabel: "Sin cargo en Talana", detail: "Talana no tiene cargo.", fixIn: "talana", fixInLabel: "Talana" },
]

const CHANGES: ChangeTableRow[] = [
  { id: "c-1", displayName: "Ana Pérez", rut: "11111111-1", worksiteName: "Masisa", kind: "cargo", kindLabel: "Cambio de cargo", beforeLabel: "Auxiliar", afterLabel: "Operador", outcome: "planned", reasonLabel: "" },
  { id: "c-2", displayName: "Luis Gomez", rut: "33333333-3", worksiteName: "", kind: "alta", kindLabel: "Alta", beforeLabel: "", afterLabel: "", outcome: "skipped", reasonLabel: "Centro de costo sin faena" },
  { id: "c-3", displayName: "Rosa Díaz", rut: "44444444-4", worksiteName: "Teno", kind: "sexo", kindLabel: "Sexo completado", beforeLabel: "", afterLabel: "", outcome: "applied", reasonLabel: "" },
]

const RUNS: RunTableRow[] = [
  { id: "run-2", startedAt: "2026-11-08T09:30:00.000Z", mode: "simulate", status: "success", activeContracts: 214, altas: 2, bajas: 1, changes: 5, skipped: 3, reason: "", hasItems: true },
  { id: "run-1", startedAt: "2026-11-07T09:30:00.000Z", mode: "apply", status: "blocked", activeContracts: 0, altas: 0, bajas: 0, changes: 0, skipped: 0, reason: "Talana devolvió cero contratos activos", hasItems: false },
]

function renderView(overrides: Partial<TalanaViewProps> = {}, search = "") {
  nav.search = search
  return render(
    <TalanaView
      differences={DIFFERENCES}
      changes={CHANGES}
      runs={RUNS}
      selectedRun={{ id: "run-2", startedAt: "2026-11-08T09:30:00.000Z", mode: "simulate", isLatest: true }}
      hasSyncedData
      canViewWorkers
      {...overrides}
    />,
  )
}

const table = () => within(screen.getByRole("table"))

afterEach(() => { cleanup(); vi.clearAllMocks(); nav.search = "" })

describe("TalanaView — pestañas", () => {
  it("abre en «Diferencias» y lleva el contador en cada pestaña", () => {
    renderView()

    expect(screen.getByRole("tab", { name: /Diferencias/ })).toHaveTextContent(/Diferencias\s*2/)
    expect(screen.getByRole("tab", { name: /Cambios de la corrida/ })).toHaveTextContent(/Cambios de la corrida\s*3/)
    expect(screen.getByRole("tab", { name: /Corridas/ })).toHaveTextContent(/Corridas\s*2/)
    expect(table().getByText("Ana Pérez")).toBeTruthy()
  })

  it("cambiar de pestaña escribe ?vista= con router.replace y sin saltar el scroll", () => {
    renderView()

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Cambios de la corrida/ }))
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/talana?vista=cambios", { scroll: false })

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Corridas/ }))
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/talana?vista=corridas", { scroll: false })
  })

  it("volver a «Diferencias» limpia el parámetro y conserva los demás", () => {
    renderView({}, "corrida=run-1&vista=cambios")

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Diferencias/ }))

    expect(nav.replace).toHaveBeenLastCalledWith("/admin/talana?corrida=run-1", { scroll: false })
  })

  it("un ?vista= desconocido cae en «Diferencias»", () => {
    renderView({}, "vista=cualquiera")
    expect(table().getByText("Beto Rojas")).toBeTruthy()
  })
})

describe("TalanaView — diferencias", () => {
  it("cada fila dice quién, qué diferencia, el detalle y dónde corregirla", () => {
    renderView()

    const row = table().getByText("Ana Pérez").closest("tr") as HTMLElement
    expect(within(row).getByText("11111111-1")).toBeTruthy()
    expect(within(row).getByText("Faena distinta")).toBeTruthy()
    expect(within(row).getByText("Chome: Teno · Talana: Masisa")).toBeTruthy()
    expect(within(row).getByText("Revisar")).toBeTruthy()
    const talanaRow = table().getByText("Beto Rojas").closest("tr") as HTMLElement
    expect(within(talanaRow).getByText("Talana")).toBeTruthy()
  })

  it("sin diferencias y con datos descargados lo dice y ofrece el historial", () => {
    renderView({ differences: [] })

    expect(screen.getByText("Talana y Chome coinciden")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Ver historial de corridas" }))
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/talana?vista=corridas", { scroll: false })
  })

  it("sin ninguna descarga explica el horario diario y enlaza a Trabajadores", () => {
    renderView({ differences: [], hasSyncedData: false })

    expect(screen.getByText("Aún no hay datos de Talana")).toBeTruthy()
    expect(screen.getByText(/todos los días a las 06:30/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ver trabajadores" }).getAttribute("href")).toBe("/admin/trabajadores")
  })

  it("quien no puede abrir Trabajadores recibe un enlace a Administración, no uno que lleve a /forbidden", () => {
    renderView({ differences: [], hasSyncedData: false, canViewWorkers: false })

    expect(screen.queryByRole("link", { name: "Ver trabajadores" })).toBeNull()
    expect(screen.getByRole("link", { name: "Volver a Administración" }).getAttribute("href")).toBe("/admin")
  })
})

describe("TalanaView — cambios de la corrida", () => {
  it("lista cada cambio con su resultado y, si se omitió, el motivo en español", () => {
    renderView({}, "vista=cambios")

    const cargo = table().getByText("Ana Pérez").closest("tr") as HTMLElement
    expect(within(cargo).getByText("Cambio de cargo")).toBeTruthy()
    expect(within(cargo).getByText("Auxiliar → Operador")).toBeTruthy()
    expect(within(cargo).getByText("Simulado")).toBeTruthy()

    const alta = table().getByText("Luis Gomez").closest("tr") as HTMLElement
    expect(within(alta).getByText("Omitido")).toBeTruthy()
    expect(within(alta).getByText("Centro de costo sin faena")).toBeTruthy()

    const sexo = table().getByText("Rosa Díaz").closest("tr") as HTMLElement
    expect(within(sexo).getByText("Aplicado")).toBeTruthy()
    // El sexo nunca lleva valor: sólo se dice que se completó.
    expect(within(sexo).getByText("Completado desde Talana")).toBeTruthy()
  })

  it("avisa que una simulación no aplicó nada", () => {
    renderView({}, "vista=cambios")
    expect(screen.getByText(/nada de esto se aplicó en Chome/)).toBeTruthy()
  })

  it("al mirar una corrida anterior ofrece volver a la última", () => {
    renderView({ selectedRun: { id: "run-1", startedAt: "2026-11-07T09:30:00.000Z", mode: "apply", isLatest: false } }, "vista=cambios&corrida=run-1")

    expect(screen.queryByText(/nada de esto se aplicó/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Ver la última corrida" }))
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/talana?vista=cambios", { scroll: false })
  })

  it("una corrida sin cambios lo dice en lenguaje de usuario", () => {
    renderView({ changes: [] }, "vista=cambios")
    expect(screen.getByText("Esta corrida no propuso cambios")).toBeTruthy()
  })

  it("sin corridas explica que corre todos los días y ofrece una salida real", () => {
    renderView({ changes: [], runs: [], selectedRun: null, hasSyncedData: false }, "vista=cambios")

    expect(screen.getByText("Todavía no hay corridas")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ver trabajadores" })).toBeTruthy()
  })
})

describe("TalanaView — corridas", () => {
  it("resume cada corrida: modo, estado, cifras y motivo", () => {
    renderView({}, "vista=corridas")

    const latest = table().getByText("214").closest("tr") as HTMLElement
    expect(within(latest).getByText("Simulación")).toBeTruthy()
    expect(within(latest).getByText("Terminó bien")).toBeTruthy()
    expect(within(latest).getByText("5")).toBeTruthy()

    const blocked = table().getByText("Aplicación").closest("tr") as HTMLElement
    expect(within(blocked).getByText("Detenida")).toBeTruthy()
    expect(within(blocked).getByText("Talana devolvió cero contratos activos")).toBeTruthy()
  })

  it("«Ver cambios» abre los cambios de esa corrida y sólo existe donde hay detalle", () => {
    renderView({}, "vista=corridas")

    const buttons = table().getAllByRole("button", { name: /Ver los cambios de la corrida/ })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/talana?vista=cambios&corrida=run-2", { scroll: false })
  })

  it("sin corridas explica el horario y enlaza a Trabajadores", () => {
    renderView({ runs: [], selectedRun: null, changes: [] }, "vista=corridas")

    expect(screen.getByText("Sin corridas registradas")).toBeTruthy()
    expect(screen.getByText(/todos los días a las 06:30/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ver trabajadores" })).toBeTruthy()
  })
})
