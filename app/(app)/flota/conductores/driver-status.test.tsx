// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { DriverRosterRow } from "@/lib/services/driver-licenses-contract"
import { ClassTags, DriverVigencia } from "./driver-status"

const TODAY = "2026-11-05"
const WARNING_DAYS = 30

type Vigencia = Pick<DriverRosterRow, "status" | "expiry" | "requiredClasses" | "license">

const license = (classes: DriverRosterRow["requiredClasses"], expiresAt: string | null) => ({
  classes,
  expiresAt,
  notes: null,
  updatedAt: "2026-11-01T12:00:00.000Z",
})

const renderVigencia = (row: Vigencia) =>
  render(<DriverVigencia row={row} today={TODAY} warningDays={WARNING_DAYS} />)

describe("DriverVigencia", () => {
  it("sin licencia: pastilla neutra con su texto y lo que exige el cargo", () => {
    renderVigencia({ status: "sin_licencia", expiry: null, requiredClasses: ["A4", "A5"], license: null })
    expect(screen.getByText("Sin licencia")).toBeInTheDocument()
    expect(screen.getByText("su cargo exige A4 o A5")).toBeInTheDocument()
  })

  it("clase insuficiente: dice qué tiene y qué exige el cargo", () => {
    renderVigencia({
      status: "clase_insuficiente",
      expiry: { state: "vigente", days: 400, expiresAt: "2027-12-10" },
      requiredClasses: ["D"],
      license: license(["A2", "B"], "2027-12-10"),
    })
    expect(screen.getByText("Clase insuficiente")).toBeInTheDocument()
    expect(screen.getByText("Tiene A2 y B · su cargo exige D")).toBeInTheDocument()
  })

  it("vencida: se rotula «Vencida» (no «Vencido») y cuenta los días", () => {
    renderVigencia({
      status: "vencida",
      expiry: { state: "vencido", days: -3, expiresAt: "2026-11-02" },
      requiredClasses: [],
      license: license(["B"], "2026-11-02"),
    })
    expect(screen.getByText("Vencida")).toBeInTheDocument()
    expect(screen.getByText("venció hace 3 días")).toBeInTheDocument()
  })

  it("por vencer: cuenta los días hasta el vencimiento", () => {
    renderVigencia({
      status: "por_vencer",
      expiry: { state: "por_vencer", days: 10, expiresAt: "2026-11-15" },
      requiredClasses: [],
      license: license(["B"], "2026-11-15"),
    })
    expect(screen.getByText("Por vencer")).toBeInTheDocument()
    expect(screen.getByText("vence en 10 días")).toBeInTheDocument()
  })

  it("vigente: más allá de la ventana de aviso da la fecha, no los días", () => {
    renderVigencia({
      status: "vigente",
      expiry: { state: "vigente", days: 400, expiresAt: "2027-12-10" },
      requiredClasses: [],
      license: license(["B"], "2027-12-10"),
    })
    expect(screen.getByText("Vigente")).toBeInTheDocument()
    expect(screen.getByText("vence el 10-12-2027")).toBeInTheDocument()
  })

  it("licencia sin fecha: avisa que falta, en vez de dejar el estado en blanco", () => {
    renderVigencia({
      status: "sin_fecha",
      expiry: { state: "sin_fecha", days: null, expiresAt: null },
      requiredClasses: [],
      license: license(["B"], null),
    })
    expect(screen.getByText("Sin fecha")).toBeInTheDocument()
    expect(screen.getByText("Falta registrar la fecha")).toBeInTheDocument()
  })
})

describe("ClassTags", () => {
  it("muestra la etiqueta corta y deja el nombre completo para lectores de pantalla", () => {
    render(<ClassTags classes={["A4", "A1_ANTIGUA"]} />)
    const list = screen.getByRole("list", { name: "Clases de licencia" })
    const items = within(list).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent("A4: Transporte de carga simple de más de 3.500 kg")
    expect(items[0]).toHaveAttribute("title", "A4: Transporte de carga simple de más de 3.500 kg")
    expect(items[1]).toHaveTextContent("A1 antigua")
  })

  it("sin clases no deja la celda vacía para quien lee con lector de pantalla", () => {
    render(<ClassTags classes={[]} />)
    expect(screen.getByText("Sin clases registradas")).toBeInTheDocument()
    expect(screen.queryByRole("list")).toBeNull()
  })
})
