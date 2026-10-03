// @vitest-environment jsdom
import { useState } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { initialDecisions, type ImportDecisions } from "@/lib/prevention/miper/import-decisions"
import type { MeasureAnalysis } from "@/lib/prevention/miper/re04-measures"
import { addDaysToPlainDate, formatDate, todayInChile } from "@/lib/utils"
import { ImportMeasuresStep } from "./import-measures-step"

const ANALYSIS: MeasureAnalysis = {
  measures: [
    { rowNumber: 14, text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", phraseKey: "uso epp casco guantes calzado seguridad", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 14, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 15, text: "Topes de descarga", phraseKey: "topes descarga", prefix: "engineering", responsibleKey: "", deadlineKey: "trimestral" },
  ],
  phrases: [
    { key: "orden limpieza", text: "ORDEN Y LIMPIEZA", count: 1, suggestion: { hierarchy: "administrative", source: "keyword" } },
    { key: "topes descarga", text: "Topes de descarga", count: 1, suggestion: { hierarchy: "engineering", source: "prefix" } },
    { key: "uso epp casco guantes calzado seguridad", text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", count: 1, suggestion: { hierarchy: "ppe", source: "default" } },
  ],
  responsibles: [
    { key: "supervisor/prevencion", text: "SUPERVISOR/PREVENCION", count: 2, suggestion: { kind: "text", name: "SUPERVISOR/PREVENCION" } },
    { key: "", text: null, count: 1, suggestion: { kind: "none" } },
  ],
  deadlines: [
    { key: "inmediato / antes de continuar la tarea", text: "INMEDIATO / ANTES DE CONTINUAR LA TAREA", count: 2, suggestion: { kind: "pending", dueDate: "2026-10-03" } },
    { key: "trimestral", text: "TRIMESTRAL", count: 1, suggestion: { kind: "existing", frequency: "TRIMESTRAL" } },
  ],
}
const USERS = [{ id: "u-1", name: "Jefe de faena" }]

/** El paso es controlado: el arnés guarda las decisiones como lo hace el diálogo. */
function Harness({ onChange, analysis = ANALYSIS }: { onChange?: (decisions: ImportDecisions) => void; analysis?: MeasureAnalysis }) {
  const [decisions, setDecisions] = useState(() => initialDecisions(analysis))
  return <ImportMeasuresStep analysis={analysis} responsibleOptions={USERS} decisions={decisions} onChange={(next) => { setDecisions(next); onChange?.(next) }} />
}
const tipos = () => screen.getByRole("region", { name: "Tipo de cada medida detectada" })

describe("ImportMeasuresStep (Fase C)", () => {
  it("las frases sin tipo del Excel nacen sugeridas (la sin pista lo dice); «Aceptar sugerencias» las confirma todas", () => {
    render(<Harness />)
    expect(within(tipos()).getByText("Sugerida")).toBeTruthy()
    expect(within(tipos()).getByText("Sugerida · sin pista")).toBeTruthy()
    expect(within(tipos()).getByText("Del Excel")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Aceptar sugerencias (2)" }))
    expect(within(tipos()).queryByText(/^Sugerida/)).toBeNull()
    expect(screen.getByRole("button", { name: "Aceptar sugerencias (0)" })).toBeDisabled()
  })

  it("«Sólo sugeridas» deja a la vista lo que falta; elegir un tipo o «Confirmar» confirma esa frase", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Sólo sugeridas" }))
    expect(within(tipos()).queryByText("Topes de descarga")).toBeNull()
    fireEvent.click(within(tipos()).getByRole("combobox", { name: "Tipo de control de «ORDEN Y LIMPIEZA»" }))
    fireEvent.click(screen.getByRole("option", { name: "III. Controles de ingeniería" }))
    expect(onChange.mock.lastCall![0].phrases["orden limpieza"]).toEqual({ hierarchy: "engineering", confirmed: true })
    expect(within(tipos()).queryByText("ORDEN Y LIMPIEZA")).toBeNull()
    fireEvent.click(within(tipos()).getByRole("button", { name: /^Confirmar el tipo de «USO DE EPP/ }))
    expect(onChange.mock.lastCall![0].phrases["uso epp casco guantes calzado seguridad"]).toEqual({ hierarchy: "ppe", confirmed: true })
  })

  it("cada responsable del Excel se decide una vez: como está escrito, una persona de la faena o sin responsable", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const responsables = screen.getByRole("region", { name: "Responsables del Excel" })
    expect(within(responsables).getByRole("combobox", { name: "Responsable para «SUPERVISOR/PREVENCION»" })).toHaveTextContent("Tal como dice el Excel")
    expect(within(responsables).getByRole("combobox", { name: "Responsable para «(vacío)»" })).toHaveTextContent("Sin responsable")
    fireEvent.click(within(responsables).getByRole("combobox", { name: "Responsable para «SUPERVISOR/PREVENCION»" }))
    fireEvent.click(screen.getByRole("option", { name: "Jefe de faena" }))
    expect(onChange.mock.lastCall![0].responsibles["supervisor/prevencion"]).toEqual({ kind: "user", userId: "u-1" })
  })

  it("cada plazo del Excel se decide una vez: existente con su frecuencia o por implementar con fecha", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const plazos = screen.getByRole("region", { name: "Plazos del Excel" })
    expect(within(plazos).getByRole("textbox", { name: "Frecuencia de verificación para «TRIMESTRAL»" })).toHaveValue("TRIMESTRAL")
    expect(within(plazos).getByRole("button", { name: "Plazo para «INMEDIATO / ANTES DE CONTINUAR LA TAREA»: 03-10-2026" })).toBeTruthy()
    fireEvent.click(within(plazos).getByRole("combobox", { name: "Cómo se cargan las medidas con «TRIMESTRAL»" }))
    fireEvent.click(screen.getByRole("option", { name: "Por implementar: llevan plazo" }))
    expect(onChange.mock.lastCall![0].deadlines.trimestral).toEqual({ kind: "pending", dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(within(plazos).queryByRole("textbox", { name: "Frecuencia de verificación para «TRIMESTRAL»" })).toBeNull()
  })

  it("un plazo por implementar que vence hoy lo dice junto a la decisión, con cuántas medidas afecta", () => {
    const hoy = todayInChile()
    render(<Harness analysis={conPlazoInmediato(hoy)} />)
    const plazos = screen.getByRole("region", { name: "Plazos del Excel" })
    // «INMEDIATO» se sugiere por implementar HOY: esas medidas vencen el día de la importación.
    expect(within(plazos).getByRole("button", { name: `Plazo para «INMEDIATO / ANTES DE CONTINUAR LA TAREA»: ${formatDate(hoy)}` }))
      .toHaveAccessibleDescription("2 medidas vencen hoy, el día de la importación.")
    // Cargarlas como existentes saca el aviso; pasar «TRIMESTRAL» a por implementar (nace con fecha de hoy) lo pone en su fila.
    fireEvent.click(within(plazos).getByRole("combobox", { name: "Cómo se cargan las medidas con «INMEDIATO / ANTES DE CONTINUAR LA TAREA»" }))
    fireEvent.click(screen.getByRole("option", { name: "Ya implementadas: se verifican" }))
    expect(within(plazos).queryByText(/vencen? hoy/)).toBeNull()
    fireEvent.click(within(plazos).getByRole("combobox", { name: "Cómo se cargan las medidas con «TRIMESTRAL»" }))
    fireEvent.click(screen.getByRole("option", { name: "Por implementar: llevan plazo" }))
    expect(within(plazos).getByRole("button", { name: `Plazo para «TRIMESTRAL»: ${formatDate(hoy)}` }))
      .toHaveAccessibleDescription("1 medida vence hoy, el día de la importación.")
  })

  it("un plazo posterior a hoy no avisa; uno que ya pasó dice que esas medidas nacen vencidas", () => {
    const hoy = todayInChile()
    const { unmount } = render(<Harness analysis={conPlazoInmediato(addDaysToPlainDate(hoy, 30))} />)
    expect(within(screen.getByRole("region", { name: "Plazos del Excel" })).queryByText(/vencen|vencidas/)).toBeNull()
    unmount()
    render(<Harness analysis={conPlazoInmediato(addDaysToPlainDate(hoy, -1))} />)
    expect(within(screen.getByRole("region", { name: "Plazos del Excel" })).getByText("2 medidas nacen vencidas: la fecha ya pasó.")).toBeTruthy()
  })

  it("un archivo grande se revisa por páginas y «Aceptar sugerencias» confirma también las de las otras páginas", () => {
    render(<Harness analysis={archivoGrande(60)} />)
    expect(within(tipos()).getAllByRole("combobox")).toHaveLength(25)
    expect(within(tipos()).queryByText("MEDIDA 26")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }))
    expect(within(tipos()).getByText("MEDIDA 26")).toBeTruthy()
    // Filtrar vuelve a la primera página.
    fireEvent.click(screen.getByRole("checkbox", { name: "Sólo sugeridas" }))
    expect(within(tipos()).getByText("MEDIDA 1")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Aceptar sugerencias (60)" }))
    expect(screen.getByRole("button", { name: "Aceptar sugerencias (0)" })).toBeDisabled()
    expect(within(tipos()).getByText("No quedan tipos por confirmar.")).toBeTruthy()
    // El botón queda deshabilitado: el foco pasa al filtro, que lo sigue en el orden de tabulación.
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Sólo sugeridas" }))
  })

  it("«Aceptar sugerencias» dice cuántas de las que confirma son «sin pista», aunque estén en otras páginas", () => {
    render(<Harness analysis={archivoGrande(60, [30, 45, 60])} />)
    // Las tres «sin pista» quedan fuera de la primera página: el aviso junto al botón las cuenta igual.
    expect(within(tipos()).queryByText("Sugerida · sin pista")).toBeNull()
    expect(screen.getByText("Falta confirmar el tipo de 60 frases (3 sin pista: se sugiere IV. Controles administrativos): elígelo en cada fila, usa «Confirmar» o «Aceptar sugerencias».")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }))
    fireEvent.click(within(tipos()).getByRole("button", { name: "Confirmar el tipo de «MEDIDA 30»" }))
    expect(screen.getByText(/^Falta confirmar el tipo de 59 frases \(2 sin pista: se sugiere IV\. Controles administrativos\)/)).toBeTruthy()
  })

  it("con «Sólo sugeridas», las «sin pista» van primero: quedan en la primera página", () => {
    render(<Harness analysis={archivoGrande(60, [30, 45, 60])} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Sólo sugeridas" }))
    const filas = within(tipos()).getAllByRole("row").slice(1)
    expect(filas.slice(0, 3).map((fila) => within(fila).getAllByRole("cell")[0]!.textContent)).toEqual(["MEDIDA 30", "MEDIDA 45", "MEDIDA 60"])
    for (const fila of filas.slice(0, 3)) expect(within(fila).getByText("Sugerida · sin pista")).toBeTruthy()
    // Después, las demás en su orden (por frecuencia, como las entrega el análisis).
    expect(within(filas[3]!).getAllByRole("cell")[0]!.textContent).toBe("MEDIDA 1")
  })

  it("con «Sólo sugeridas», la frase confirmada sale de la lista y el foco pasa a la que sigue por confirmar", async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Sólo sugeridas" }))
    // Elegir el MISMO tipo sugerido (IV) también confirma: la fila se va con su selector y el foco no vuelve al comienzo del diálogo.
    fireEvent.click(within(tipos()).getByRole("combobox", { name: "Tipo de control de «ORDEN Y LIMPIEZA»" }))
    fireEvent.click(screen.getByRole("option", { name: "IV. Controles administrativos" }))
    expect(within(tipos()).queryByText("ORDEN Y LIMPIEZA")).toBeNull()
    const siguiente = within(tipos()).getByRole("combobox", { name: /^Tipo de control de «USO DE EPP/ })
    expect(document.activeElement).toBe(siguiente)
    // El selector que se cerró devuelve el foco en un `setTimeout`: no tiene que pisar el traspaso.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.activeElement).toBe(siguiente)
    fireEvent.click(within(tipos()).getByRole("button", { name: /^Confirmar el tipo de «USO DE EPP/ }))
    // No queda ninguna: el foco vuelve al filtro en vez de perderse.
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Sólo sugeridas" }))
  })
})

/** El mismo archivo con el plazo «INMEDIATO…» sugerido para `dueDate`. */
function conPlazoInmediato(dueDate: string): MeasureAnalysis {
  return {
    ...ANALYSIS,
    deadlines: ANALYSIS.deadlines.map((group) => group.key === "inmediato / antes de continuar la tarea" ? { ...group, suggestion: { kind: "pending", dueDate } } : group),
  }
}

/**
 * Un RE-04 grande (el de Biodiversa trae unas 222 frases distintas): `n` frases sugeridas, una por fila.
 * Las de `sinPista` (números de frase) no calzaron ninguna palabra clave: se sugieren IV por descarte.
 */
function archivoGrande(n: number, sinPista: readonly number[] = []): MeasureAnalysis {
  const phrases = Array.from({ length: n }, (_, index) => ({
    key: `medida ${index + 1}`, text: `MEDIDA ${index + 1}`, count: 1,
    suggestion: { hierarchy: "administrative" as const, source: sinPista.includes(index + 1) ? "default" as const : "keyword" as const },
  }))
  return {
    measures: phrases.map((phrase, index) => ({ rowNumber: 14 + index, text: phrase.text, phraseKey: phrase.key, prefix: null, responsibleKey: "", deadlineKey: "trimestral" })),
    phrases,
    responsibles: [{ key: "", text: null, count: n, suggestion: { kind: "none" } }],
    deadlines: [{ key: "trimestral", text: "TRIMESTRAL", count: n, suggestion: { kind: "existing", frequency: "TRIMESTRAL" } }],
  }
}
