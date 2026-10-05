// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { buildMatrixTree } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

vi.mock("next/navigation", () => ({ usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))

import { ActivitySection } from "./activity-section"

const e = (id: string, rowNumber: number, activity: string, task: string, position = "P", location: string | null = null) => ({ id, rowNumber, activity, task, position, location, exposedFemale: 0, exposedMale: 1, exposedOther: 0, riskFactorId: null, riskFactor: null, isRoutine: true, hazard: `Peligro ${id}`, risk: "R", probableDamage: "D", probability: 1, consequence: 1, magnitude: 1, classification: "tolerable", controlledStatus: "yes", controls: [] }) as MiperEntrySnapshot
const noop = () => {}
function renderActivity(rows: MiperEntrySnapshot[], incomplete: string[]) {
  const [activity] = buildMatrixTree(rows, { incomplete: new Set(incomplete), observed: new Set<string>(), modified: new Set<string>(), matching: null })
  return render(<ActivitySection activity={activity!} expanded onToggle={noop} filtered={false} incomplete={new Set(incomplete)} observed={new Set()} changes={new Map()} issuesByEntry={new Map()} />)
}

describe("ActivitySection", () => {
  it("singulariza los totales: «1 tarea · 1 riesgo»", () => {
    renderActivity([e("a", 1, "Oficina", "Archivo")], [])
    expect(screen.getByText("1 tarea · 1 riesgo")).toBeTruthy()
  })
  it("sin pendientes dice «Completa»; con pendientes lo cuenta en tinta de señal", () => {
    const first = renderActivity([e("a", 1, "Oficina", "Archivo")], [])
    expect(screen.getByText("Completa")).toBeTruthy()
    expect(screen.queryByText(/con datos pendientes/)).toBeNull()
    first.unmount()
    renderActivity([e("a", 1, "Oficina", "Archivo"), e("b", 2, "Oficina", "Archivo")], ["a"])
    const pending = screen.getAllByText(/con datos pendientes/)
    expect(pending.some((node) => node.textContent === "1 riesgo con datos pendientes" && node.className.includes("signal-ink"))).toBe(true)
    expect(screen.queryByText("Completa")).toBeNull()
  })
  it("el encabezado es un h3 cuyo nombre es sólo la actividad y conserva su id", () => {
    renderActivity([e("a", 1, "Oficina", "Archivo")], ["a"])
    const heading = screen.getByRole("heading", { level: 3, name: "Oficina" })
    expect(heading.id).toMatch(/^miper-activity-/)
  })
  it("el puesto adicional se lee «y 1 puesto más» y no como un tercer dato", () => {
    renderActivity([e("a", 1, "Oficina", "Archivo", "Bodeguero", "Patio"), e("b", 2, "Oficina", "Archivo", "Jefe", "Patio")], [])
    const line = screen.getByText("Bodeguero y 1 puesto más · Patio")
    expect(line.getAttribute("title")).toContain("Jefe")
  })
})
