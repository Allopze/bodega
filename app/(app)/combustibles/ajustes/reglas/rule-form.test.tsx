// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("./actions", () => ({ createAnomalyRuleAction: vi.fn(), updateAnomalyRuleAction: vi.fn(), setAnomalyRuleStatusAction: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const { AnomalyRuleForm } = await import("./rule-form")
const { AnomalyRuleCatalog } = await import("./rule-catalog")

const row = (overrides: Partial<{ code: string; name: string; config: string | null; severity: string; isActive: boolean; description: string | null }> = {}) => ({
  id: "r1", code: "exceso_cargas_ventana", name: "Exceso de cargas en una ventana", description: "El equipo acumula más cargas de las esperadas.",
  severity: "medium", isActive: true, config: '{"maxLoads":3,"windowHours":2}', ...overrides,
})

describe("formulario de una regla", () => {
  it("muestra los parámetros en palabras, con su valor, y la frase que leerá la tabla", () => {
    render(<AnomalyRuleForm open onClose={() => {}} editRow={row()} />)
    expect(screen.getByRole("group", { name: "¿Cuándo se activa?" })).toBeInTheDocument()
    expect(screen.getByLabelText("Cargas dentro de la ventana")).toHaveValue("3")
    expect(screen.getByLabelText("Ventana de tiempo (horas)")).toHaveValue("2")
    expect(screen.getByText(/Así se leerá en la lista: Avisa si un equipo carga 3 veces o más en 2 horas\./)).toBeInTheDocument()
  })

  it("la frase sigue lo que se escribe, y un valor inválido la oculta en vez de mentir", () => {
    render(<AnomalyRuleForm open onClose={() => {}} editRow={row()} />)
    fireEvent.change(screen.getByLabelText("Ventana de tiempo (horas)"), { target: { value: "24" } })
    expect(screen.getByText(/carga 3 veces o más en 24 horas\./)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Ventana de tiempo (horas)"), { target: { value: "mucho" } })
    expect(screen.queryByText(/Así se leerá en la lista/)).toBeNull()
  })

  it("el margen se escribe en porcentaje aunque se guarde como fracción", () => {
    render(<AnomalyRuleForm open onClose={() => {}} editRow={row({ code: "litros_supera_capacidad", name: "Litros sobre la capacidad", config: '{"margin":0.05}' })} />)
    expect(screen.getByLabelText("Margen sobre la capacidad (%)")).toHaveValue("5")
    expect(screen.getByText(/en más de 5 %\./)).toBeInTheDocument()
  })

  it("el código de una regla del catálogo y el JSON van en «Avanzado», con el código de sólo lectura", () => {
    render(<AnomalyRuleForm open onClose={() => {}} editRow={row()} />)
    expect(screen.getByText("Avanzado: código y configuración en JSON")).toBeInTheDocument()
    expect(screen.getByLabelText("Código")).toHaveAttribute("readonly")
    expect(screen.getByLabelText("Configuración (JSON)")).toHaveValue('{"maxLoads":3,"windowHours":2}')
    // Una regla por lotes ofrece además el límite de filas; ésta no.
    expect(screen.queryByLabelText(/Filas que se revisan por corrida/)).toBeNull()
  })

  it("una regla sin parámetros lo dice y no inventa campos", () => {
    render(<AnomalyRuleForm open onClose={() => {}} editRow={row({ code: "sello_repetido", name: "Sello repetido", config: "{}" })} />)
    expect(screen.queryByRole("group", { name: "¿Cuándo se activa?" })).toBeNull()
    expect(screen.getByText(/Siempre que ocurre\. No tiene parámetros que ajustar\./)).toBeInTheDocument()
  })

  it("al crear pide el código, sugiere sólo los que aún no tienen regla y avisa de lo desconocido", () => {
    const { container } = render(<AnomalyRuleForm open onClose={() => {}} editRow={null} existingCodes={["sello_repetido"]} />)
    const code = screen.getByLabelText(/Código/)
    expect(code).not.toHaveAttribute("readonly")
    const options = [...container.ownerDocument.querySelectorAll("#rule-known-codes option")].map((option) => option.getAttribute("value"))
    expect(options).toContain("exceso_cargas_ventana")
    expect(options).not.toContain("sello_repetido")
    fireEvent.change(code, { target: { value: "regla_inventada" } })
    expect(screen.getByText(/Código desconocido para el motor/)).toBeInTheDocument()
  })
})

describe("catálogo de reglas", () => {
  it("dice cuándo se activa cada regla en palabras, con los casos del mes y el JSON sólo en «Avanzado»", () => {
    render(<AnomalyRuleCatalog rows={[row()]} caseCounts={{ exceso_cargas_ventana: 7 }} caseCountsFailed={false} />)
    const table = screen.getByRole("region", { name: "Reglas de detección" })
    expect(table).toHaveTextContent("Avisa si un equipo carga 3 veces o más en 2 horas.")
    expect(table).toHaveTextContent("7")
    expect(table).not.toHaveTextContent('{"maxLoads"')
    expect(screen.getByRole("checkbox", { name: "Regla «Exceso de cargas en una ventana» activa" })).toBeChecked()
    expect(screen.getByRole("region", { name: "Código y configuración de cada regla" })).toHaveTextContent('{"maxLoads":3,"windowHours":2}')
  })

  it("si no se pudieron leer los casos muestra «—», no un cero", () => {
    render(<AnomalyRuleCatalog rows={[row()]} caseCounts={{}} caseCountsFailed />)
    expect(screen.getByRole("region", { name: "Reglas de detección" })).toHaveTextContent("—")
  })

  it("sin reglas explica qué son y ofrece la acción", () => {
    render(<AnomalyRuleCatalog rows={[]} caseCounts={{}} caseCountsFailed={false} emptyAction={<button type="button">Crear una regla</button>} />)
    expect(screen.getByRole("heading", { name: "Aún no hay reglas de detección" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Crear una regla" })).toBeInTheDocument()
  })
})
