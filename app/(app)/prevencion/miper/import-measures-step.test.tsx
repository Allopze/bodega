// @vitest-environment jsdom
import { useState } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { initialDecisions, type ImportDecisions } from "@/lib/prevention/miper/import-decisions"
import { RESPONSIBLE_MAX_LENGTH, type MeasureAnalysis } from "@/lib/prevention/miper/re04-measures"
import { addDaysToPlainDate, formatDate, todayInChile } from "@/lib/utils"
import { ImportMeasuresStep } from "./import-measures-step"

const ANALYSIS: MeasureAnalysis = {
  measures: [
    { rowNumber: 14, text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", phraseKey: "uso epp casco guantes calzado seguridad", prefix: null, labeled: false, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 14, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, labeled: false, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 15, text: "Topes de descarga", phraseKey: "topes descarga", prefix: "engineering", labeled: true, responsibleKey: "", deadlineKey: "trimestral" },
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
  it("nada pide confirmación: lo sugerido viene como valor, la «sin pista» va primero, como marcador, y el aviso la cuenta", () => {
    render(<Harness />)
    const filas = within(tipos()).getAllByRole("row").slice(1)
    expect(filas.map((fila) => within(fila).getAllByRole("cell")[0]!.textContent)).toEqual(["USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", "ORDEN Y LIMPIEZA", "Topes de descarga"])
    expect(within(filas[0]!).getByText("Sin pista")).toBeTruthy()
    expect(within(filas[1]!).getByText("Sugerida")).toBeTruthy()
    expect(within(filas[2]!).getByText("Del Excel")).toBeTruthy()
    expect(within(tipos()).getByRole("combobox", { name: "Tipo de control de «ORDEN Y LIMPIEZA»" })).not.toHaveAttribute("data-placeholder")
    expect(within(tipos()).getByRole("combobox", { name: /^Tipo de control de «USO DE EPP/ })).toHaveAttribute("data-placeholder")
    expect(screen.getByText("1 frase sin pista: ninguna palabra clave calzó y se carga como V. Elementos de protección personal si no eliges otro tipo. Van primero.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Aceptar sugerencias|^Confirmar/ })).toBeNull()
  })

  it("elegir un tipo marca la frase «Elegida»; en una «sin pista», elegir el mismo tipo sugerido también cuenta", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(within(tipos()).getByRole("combobox", { name: "Tipo de control de «ORDEN Y LIMPIEZA»" }))
    fireEvent.click(screen.getByRole("option", { name: "III. Controles de ingeniería" }))
    expect(onChange.mock.lastCall![0].phrases["orden limpieza"]).toEqual({ hierarchy: "engineering", confirmed: true })
    fireEvent.click(within(tipos()).getByRole("combobox", { name: /^Tipo de control de «USO DE EPP/ }))
    fireEvent.click(screen.getByRole("option", { name: "V. Elementos de protección personal" }))
    expect(onChange.mock.lastCall![0].phrases["uso epp casco guantes calzado seguridad"]).toEqual({ hierarchy: "ppe", confirmed: true })
    expect(within(tipos()).queryByText("Sin pista")).toBeNull()
    expect(within(tipos()).getAllByText("Elegida")).toHaveLength(2)
    // Sin «sin pista» que revisar, el aviso y el filtro se van.
    expect(screen.queryByRole("checkbox", { name: "Sólo sin pista" })).toBeNull()
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

  it("«Tal como dice el Excel» envía el responsable recortado al largo que acepta el servidor (300)", () => {
    const onChange = vi.fn()
    const long = `SUPERVISOR DE TURNO ${"Y PREVENCIONISTA DE FAENA ".repeat(14)}`.trim()
    expect(long.length).toBeGreaterThan(RESPONSIBLE_MAX_LENGTH)
    const analysis: MeasureAnalysis = {
      ...ANALYSIS,
      responsibles: [{ key: "largo", text: long, count: 3, suggestion: { kind: "text", name: long.slice(0, RESPONSIBLE_MAX_LENGTH) } }],
      measures: ANALYSIS.measures.map((measure) => ({ ...measure, responsibleKey: "largo" })),
    }
    render(<Harness onChange={onChange} analysis={analysis} />)
    const responsables = screen.getByRole("region", { name: "Responsables del Excel" })
    const select = () => within(responsables).getByRole("combobox", { name: /^Responsable para «SUPERVISOR DE TURNO/ })
    fireEvent.click(select())
    fireEvent.click(screen.getByRole("option", { name: "Jefe de faena" }))
    fireEvent.click(select())
    fireEvent.click(screen.getByRole("option", { name: /^Tal como dice el Excel/ }))
    expect(onChange.mock.lastCall![0].responsibles.largo).toEqual({ kind: "text", name: long.slice(0, RESPONSIBLE_MAX_LENGTH) })
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

  it("en un libro exportado, volver a «Ya implementadas» repone la frecuencia sugerida, no el «Existente · …» de PLAZOS", () => {
    const onChange = vi.fn()
    const exported: MeasureAnalysis = {
      ...ANALYSIS,
      deadlines: [{ key: "existente · trimestral", text: "Existente · Trimestral", count: 3, suggestion: { kind: "existing", frequency: "Trimestral" } }],
      measures: ANALYSIS.measures.map((measure) => ({ ...measure, deadlineKey: "existente · trimestral" })),
    }
    render(<Harness onChange={onChange} analysis={exported} />)
    const plazos = screen.getByRole("region", { name: "Plazos del Excel" })
    const kind = () => within(plazos).getByRole("combobox", { name: "Cómo se cargan las medidas con «Existente · Trimestral»" })
    fireEvent.click(kind())
    fireEvent.click(screen.getByRole("option", { name: "Por implementar: llevan plazo" }))
    fireEvent.click(kind())
    fireEvent.click(screen.getByRole("option", { name: "Ya implementadas: se verifican" }))
    expect(onChange.mock.lastCall![0].deadlines["existente · trimestral"]).toEqual({ kind: "existing", frequency: "Trimestral" })
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

  it("un archivo grande se revisa por páginas, con las «sin pista» en la primera aunque el análisis las traiga al final", () => {
    render(<Harness analysis={archivoGrande(60, [30, 45, 60])} />)
    expect(within(tipos()).getAllByRole("combobox")).toHaveLength(25)
    const filas = within(tipos()).getAllByRole("row").slice(1)
    expect(filas.slice(0, 4).map((fila) => within(fila).getAllByRole("cell")[0]!.textContent)).toEqual(["MEDIDA 30", "MEDIDA 45", "MEDIDA 60", "MEDIDA 1"])
    expect(screen.getByText("3 frases sin pista: ninguna palabra clave calzó y se cargan como IV. Controles administrativos si no eliges otro tipo. Van primero.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }))
    expect(within(tipos()).getByText("MEDIDA 23")).toBeTruthy()
    // Filtrar vuelve a la primera página y deja sólo las «sin pista».
    fireEvent.click(screen.getByRole("checkbox", { name: "Sólo sin pista" }))
    expect(within(tipos()).getAllByRole("combobox")).toHaveLength(3)
  })

  it("con «Sólo sin pista», la frase elegida sale de la lista y el foco pasa a la que sigue; sin ninguna, al filtro", async () => {
    render(<Harness analysis={archivoGrande(6, [2, 4])} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Sólo sin pista" }))
    // Elegir el MISMO tipo sugerido (IV) también cuenta: la fila se va con su selector y el foco no vuelve al comienzo del diálogo.
    fireEvent.click(within(tipos()).getByRole("combobox", { name: "Tipo de control de «MEDIDA 2»" }))
    fireEvent.click(screen.getByRole("option", { name: "IV. Controles administrativos" }))
    expect(within(tipos()).queryByText("MEDIDA 2")).toBeNull()
    const siguiente = within(tipos()).getByRole("combobox", { name: "Tipo de control de «MEDIDA 4»" })
    expect(document.activeElement).toBe(siguiente)
    // El selector que se cerró devuelve el foco en un `setTimeout`: no tiene que pisar el traspaso.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.activeElement).toBe(siguiente)
    fireEvent.click(siguiente)
    fireEvent.click(screen.getByRole("option", { name: "II. Sustitución" }))
    // No queda ninguna: el foco vuelve al filtro, que sigue en su lugar, en vez de perderse.
    expect(within(tipos()).getByText("No quedan frases sin pista.")).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Sólo sin pista" }))
  })

  /* Enter con el teclado sobre una opción (Task 10, visto en Chromium). Si el `keydown` no se
   * cancela, el navegador además «hace clic» con Enter (la activación del `keypress`) sobre lo
   * que tenga el foco en ese momento. jsdom no sintetiza esa activación: la prueba la hace a
   * mano, en el mismo orden que Chromium. */
  function enterComoElNavegador(opcion: HTMLElement) {
    opcion.focus()
    const noCancelado = fireEvent.keyDown(opcion, { key: "Enter" })
    if (noCancelado && document.activeElement instanceof HTMLElement) fireEvent.click(document.activeElement)
  }

  it.each([
    { caso: "sin filtro: el foco queda en el selector de esa fila", filtro: false, frase: "MEDIDA 1", foco: "Tipo de control de «MEDIDA 1»" },
    { caso: "con «Sólo sin pista»: el foco pasa al selector de la frase que sigue", filtro: true, frase: "MEDIDA 2", foco: "Tipo de control de «MEDIDA 3»" },
  ])("Enter sobre una opción elige el tipo y no abre ningún selector — $caso", ({ filtro, frase, foco }) => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} analysis={archivoGrande(4, [2, 3])} />)
    if (filtro) fireEvent.click(screen.getByRole("checkbox", { name: "Sólo sin pista" }))
    fireEvent.click(within(tipos()).getByRole("combobox", { name: `Tipo de control de «${frase}»` }))
    enterComoElNavegador(screen.getByRole("option", { name: "III. Controles de ingeniería" }))
    expect(onChange.mock.lastCall![0].phrases[frase.toLowerCase()]).toEqual({ hierarchy: "engineering", confirmed: true })
    // Antes, el clic de Enter caía en el selector que acababa de recibir el foco y lo abría.
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(document.activeElement).toBe(within(tipos()).getByRole("combobox", { name: foco }))
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
    measures: phrases.map((phrase, index) => ({ rowNumber: 14 + index, text: phrase.text, phraseKey: phrase.key, prefix: null, labeled: false, responsibleKey: "", deadlineKey: "trimestral" })),
    phrases,
    responsibles: [{ key: "", text: null, count: n, suggestion: { kind: "none" } }],
    deadlines: [{ key: "trimestral", text: "TRIMESTRAL", count: n, suggestion: { kind: "existing", frequency: "TRIMESTRAL" } }],
  }
}
