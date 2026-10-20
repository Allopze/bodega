// @vitest-environment jsdom

/**
 * Un ítem de la captura en UN solo árbol: el grupo de resultado de 44 px, el
 * pliegue de comentario y foto que se abre solo cuando la respuesta exige motivo
 * (sin robar el foco), la prenda de la matriz con un grupo por dimensión, y que
 * teclear en un ítem no repinta a los demás.
 *
 * El `Select` de Radix no abre su popover en jsdom; el `radiogroup` sí, y es lo
 * que prueba la selección por clic y por teclado.
 */

import * as React from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../actions", () => ({ removeAnswerEvidenceAction: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/pwa/image-compress", () => ({ compressPhoto: (file: File) => Promise.resolve(file) }))

// Cuenta cuántas veces se pinta el grupo de resultado de cada ítem, para el `React.memo`.
const groupRenders: Record<string, number> = {}
vi.mock("@/components/ui/choice-card-group", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/choice-card-group")>()
  return {
    ...original,
    ChoiceCardGroup: (props: React.ComponentProps<typeof original.ChoiceCardGroup>) => {
      const name = String(props.label)
      groupRenders[name] = (groupRenders[name] ?? 0) + 1
      return <original.ChoiceCardGroup {...props} />
    },
  }
})

const { ItemCapture } = await import("./item-capture")
const { MatrixRowCapture } = await import("./matrix-row-capture")

import type { ItemCaptureProps } from "./item-capture"
import type { MatrixCellState } from "./matrix-row-capture"
import type { ItemInfo } from "./types"

const ITEM_CUMPLE: ItemInfo = { id: "casco", label: "Casco de seguridad", kind: "cumple_nocumple_na_obs", required: false, countsForCompliance: true, danoPotencial: null }
const ITEM_BRM: ItemInfo = { id: "estado", label: "Extintor: estado", kind: "bueno_regular_malo_obs", required: false, countsForCompliance: true, danoPotencial: null }
const ITEM_TEXTO: ItemInfo = { id: "nota", label: "Observaciones", kind: "text", required: false, countsForCompliance: false, danoPotencial: null }

function props(overrides: Partial<ItemCaptureProps> = {}): ItemCaptureProps {
  return {
    item: ITEM_CUMPLE,
    sectionId: "sec-1",
    index: 1,
    required: true,
    result: "",
    comment: "",
    value: "",
    needsConfirmation: false,
    answerId: null,
    evidence: undefined,
    heldReason: null,
    heldProblem: null,
    onUpdate: vi.fn(),
    onConfirmRead: vi.fn(),
    ensureAnswerId: vi.fn().mockResolvedValue("answer-1"),
    onEvidenceChange: vi.fn(),
    ...overrides,
  }
}

function renderItem(overrides: Partial<ItemCaptureProps> = {}) {
  const base = props(overrides)
  const view = render(<ul><ItemCapture {...base} /></ul>)
  return {
    ...view,
    base,
    rerenderWith(next: Partial<ItemCaptureProps>) {
      view.rerender(<ul><ItemCapture {...base} {...next} /></ul>)
    },
  }
}

const details = () => document.querySelector("details") as HTMLDetailsElement

beforeEach(() => {
  for (const key of Object.keys(groupRenders)) delete groupRenders[key]
})
afterEach(() => cleanup())

describe("ItemCapture — resultado", () => {
  it("el grupo se llama «Resultado de {ítem}» y ofrece las opciones de la escala del ítem", () => {
    renderItem()
    const group = screen.getByRole("radiogroup", { name: "Resultado de Casco de seguridad" })
    expect(within(group).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Cumple", "No cumple", "No aplica"])
  })

  it("en la escala B/R/M ofrece Bueno, Regular y Malo (la etiqueta es la del anexo)", () => {
    renderItem({ item: ITEM_BRM })
    const group = screen.getByRole("radiogroup", { name: "Resultado de Extintor: estado" })
    expect(within(group).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Bueno", "Regular", "Malo"])
  })

  it("elegir por clic avisa al borrador con el resultado de la opción", () => {
    const { base } = renderItem()
    fireEvent.click(screen.getByRole("radio", { name: "No cumple" }))
    expect(base.onUpdate).toHaveBeenCalledWith("sec-1", "casco", { result: "non_conforming" })
  })

  it("las flechas del teclado mueven la elección y sólo la elegida es tabulable", () => {
    const { base } = renderItem({ result: "conforming" })
    const radios = screen.getAllByRole("radio")
    expect(radios.map((radio) => radio.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"])
    fireEvent.keyDown(screen.getByRole("radio", { name: "Cumple" }), { key: "ArrowRight" })
    expect(base.onUpdate).toHaveBeenLastCalledWith("sec-1", "casco", { result: "non_conforming" })
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "No cumple" }))
  })

  it("la opción elegida se distingue por tono y por el check, no sólo por color", () => {
    renderItem({ result: "non_conforming" })
    const chosen = screen.getByRole("radio", { checked: true })
    expect(chosen).toHaveTextContent("No cumple")
    expect(chosen.className).toContain("text-[var(--color-danger-ink)]")
    expect(chosen.querySelector("svg")).not.toBeNull()
  })

  it("«Regular» toma el tono ámbar", () => {
    renderItem({ item: ITEM_BRM, result: "partial" })
    expect(screen.getByRole("radio", { checked: true }).className).toContain("text-[var(--color-warning-ink)]")
  })

  it("un ítem que no puntúa se responde con su campo y el valor registra el resultado", () => {
    const { base } = renderItem({ item: ITEM_TEXTO, required: false })
    expect(screen.queryByRole("radiogroup")).toBeNull()
    fireEvent.change(screen.getByLabelText("Respuesta de Observaciones"), { target: { value: "Todo en orden" } })
    expect(base.onUpdate).toHaveBeenCalledWith("sec-1", "nota", { value: "Todo en orden", result: "recorded" })
  })

  it("«Opcional» sólo si el cierre no lo exige", () => {
    const { unmount } = renderItem({ required: true })
    expect(screen.queryByText("Opcional")).toBeNull()
    unmount()
    renderItem({ required: false })
    expect(screen.getByText("Opcional")).toBeInTheDocument()
  })

  it("la etiqueta es un h3 numerado", () => {
    renderItem({ index: 4 })
    expect(screen.getByRole("heading", { level: 3, name: "4. Casco de seguridad" })).toBeInTheDocument()
  })
})

describe("ItemCapture — comentario y foto plegados", () => {
  it("sin respuesta que lo exija el pliegue está cerrado y ofrece agregar", () => {
    renderItem({ result: "conforming" })
    expect(details().open).toBe(false)
    expect(within(details()).getByText("Agregar comentario o foto")).toBeInTheDocument()
  })

  it("se abre solo cuando la respuesta exige motivo, lo dice en el resumen y NO roba el foco", () => {
    const view = renderItem({ result: "conforming" })
    const conforme = screen.getByRole("radio", { name: "Cumple" })
    conforme.focus()
    expect(document.activeElement).toBe(conforme)

    view.rerenderWith({ result: "non_conforming" })

    expect(details().open).toBe(true)
    expect(within(details()).getByText("Motivo obligatorio")).toBeInTheDocument()
    // Sigue en el mismo botón: la persona responde ítem tras ítem y no pierde el lugar.
    expect(document.activeElement).not.toBe(screen.getByLabelText("Comentario de Casco de seguridad"))
    expect(screen.getByLabelText("Comentario de Casco de seguridad")).toBeVisible()
  })

  it("dice el problema en línea y lo enlaza al grupo con aria-describedby", () => {
    renderItem({ result: "non_conforming", heldReason: "invalid", heldProblem: "x" })
    const group = screen.getByRole("radiogroup", { name: "Resultado de Casco de seguridad" })
    expect(group).toHaveAccessibleDescription("Falta el motivo: escribe al menos 3 caracteres.")
    const problem = screen.getByText("Falta el motivo: escribe al menos 3 caracteres.")
    expect(problem.className).toContain("text-[var(--color-danger-ink)]")
  })

  it("al escribir el motivo el resumen pasa a «Comentario» y el pliegue no se cierra solo", () => {
    const view = renderItem({ result: "non_conforming" })
    view.rerenderWith({ comment: "Sin cierre lateral" })
    expect(details().open).toBe(true)
    expect(within(details()).getByText("Comentario")).toBeInTheDocument()
    expect(screen.queryByText(/Falta el motivo/)).toBeNull()
  })

  it("quien lo cierra a mano no lo ve reabrirse mientras sigue escribiendo", () => {
    const view = renderItem({ result: "non_conforming" })
    expect(details().open).toBe(true)
    // El navegador cambia `open` y avisa con `toggle`.
    details().open = false
    fireEvent(details(), new Event("toggle"))
    view.rerenderWith({ comment: "Sin" })
    view.rerenderWith({ comment: "Sin cierre" })
    expect(details().open).toBe(false)
  })

  it("el comentario del ítem es un textarea de 2 filas nombrado por el ítem", () => {
    const { base } = renderItem({ result: "non_conforming" })
    const field = screen.getByLabelText("Comentario de Casco de seguridad") as HTMLTextAreaElement
    expect(field.rows).toBe(2)
    fireEvent.change(field, { target: { value: "Golpeado" } })
    expect(base.onUpdate).toHaveBeenCalledWith("sec-1", "casco", { comment: "Golpeado" })
  })

  it("«Quitar respuesta» deja el ítem sin responder y limpia lo escrito", () => {
    const { base } = renderItem({ result: "conforming", comment: "ok" })
    fireEvent.click(screen.getByRole("button", { name: "Quitar respuesta" }))
    expect(base.onUpdate).toHaveBeenCalledWith("sec-1", "casco", { result: "", comment: "", value: "" })
  })

  it("sin respuesta no hay «Quitar respuesta» ni foto que colgar", () => {
    renderItem({ result: "" })
    expect(screen.queryByRole("button", { name: "Quitar respuesta" })).toBeNull()
    expect(screen.queryByRole("button", { name: /fotos/ })).toBeNull()
  })

  it("el resumen cuenta las fotos del servidor", () => {
    renderItem({
      result: "conforming",
      comment: "Rayado",
      answerId: "answer-1",
      evidence: [
        { id: "e1", path: "storage/a.jpg", caption: null },
        { id: "e2", path: "storage/b.jpg", caption: null },
      ],
    })
    expect(within(details()).getByText("Comentario · 2 fotos")).toBeInTheDocument()
  })

  it("una fila retenida por sus fotos abre el pliegue para poder quitarlas", () => {
    renderItem({
      result: "",
      answerId: "answer-1",
      evidence: [{ id: "e1", path: "storage/a.jpg", caption: null }],
      heldReason: "unanswer_with_photos",
      heldProblem: "Para dejar «Casco» sin responder, quita primero sus fotos.",
    })
    expect(details().open).toBe(true)
    expect(screen.getByRole("button", { name: "Quitar foto 1 de Casco de seguridad" })).toBeInTheDocument()
    expect(screen.getByText("Para dejar «Casco» sin responder, quita primero sus fotos.")).toBeInTheDocument()
  })
})

describe("ItemCapture — React.memo", () => {
  it("repintar al padre con las mismas props no repinta el ítem; cambiar su respuesta sí", () => {
    const base = props()
    function Parent({ tick }: { tick: number }) {
      return <ul data-tick={tick}><ItemCapture {...base} /></ul>
    }
    const view = render(<Parent tick={0} />)
    const name = "Resultado de Casco de seguridad"
    const first = groupRenders[name]!
    view.rerender(<Parent tick={1} />)
    view.rerender(<Parent tick={2} />)
    expect(groupRenders[name]).toBe(first)

    view.rerender(<ul><ItemCapture {...base} result="conforming" /></ul>)
    expect(groupRenders[name]).toBeGreaterThan(first)
  })
})

describe("MatrixRowCapture — una prenda, dos dimensiones", () => {
  const USA: ItemInfo = {
    id: "casco_uso", label: "Casco: usa", kind: "si_no_na_obs", required: false, countsForCompliance: true, danoPotencial: null,
    matrix: { rowId: "casco", rowLabel: "Casco", columnLabel: "Usa (Sí/No/N/A)" },
  }
  const ESTADO: ItemInfo = {
    id: "casco_estado", label: "Casco: estado", kind: "bueno_regular_malo_obs", required: false, countsForCompliance: true, danoPotencial: null,
    matrix: { rowId: "casco", rowLabel: "Casco", columnLabel: "Estado (B/R/M)" },
  }
  function cell(item: ItemInfo, overrides: Partial<MatrixCellState> = {}): MatrixCellState {
    return {
      item, required: true, result: "", comment: "", value: "", needsConfirmation: false,
      answerId: null, evidence: undefined, heldReason: null, heldProblem: null, ...overrides,
    }
  }
  function renderRow(cells: MatrixCellState[], handlers = {}) {
    const base = {
      sectionId: "sec-1", index: 2, rowLabel: "Casco", onUpdate: vi.fn(), onConfirmRead: vi.fn(),
      ensureAnswerId: vi.fn().mockResolvedValue("a"), onEvidenceChange: vi.fn(), ...handlers,
    }
    const view = render(<ul><MatrixRowCapture {...base} cells={cells} /></ul>)
    return { ...view, base, rerenderCells(next: MatrixCellState[]) { view.rerender(<ul><MatrixRowCapture {...base} cells={next} /></ul>) } }
  }

  it("una tarjeta por prenda con DOS grupos de radio rotulados Usa y Estado, y un solo h3", () => {
    renderRow([cell(USA), cell(ESTADO)])
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1)
    expect(screen.getByRole("heading", { level: 3, name: "2. Casco" })).toBeInTheDocument()
    const uso = screen.getByRole("radiogroup", { name: "Resultado de Casco: usa" })
    const estado = screen.getByRole("radiogroup", { name: "Resultado de Casco: estado" })
    expect(within(uso).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Sí", "No", "N/A"].map((label) => label === "N/A" ? "No aplica" : label))
    expect(within(estado).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Bueno", "Regular", "Malo"])
    // El rótulo visible no repite las opciones: «Usa», no «Usa (Sí/No/N/A)».
    // Aparece sobre cada grupo y otra vez, rotulando su comentario dentro del pliegue (que es uno solo).
    expect(screen.getAllByText("Usa").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Estado").length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/Sí\/No\/N\/A/)).toBeNull()
  })

  it("lado a lado desde md", () => {
    const { container } = renderRow([cell(USA), cell(ESTADO)])
    expect(container.querySelector(".md\\:grid-cols-2")).not.toBeNull()
  })

  it("cada dimensión responde por separado, con su propio ítem", () => {
    const { base } = renderRow([cell(USA), cell(ESTADO)])
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Resultado de Casco: usa" })).getByRole("radio", { name: "Sí" }))
    expect(base.onUpdate).toHaveBeenLastCalledWith("sec-1", "casco_uso", { result: "conforming" })
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Resultado de Casco: estado" })).getByRole("radio", { name: "Malo" }))
    expect(base.onUpdate).toHaveBeenLastCalledWith("sec-1", "casco_estado", { result: "non_conforming" })
  })

  it("un solo pliegue para la prenda, con el comentario de cada dimensión; se abre si una exige motivo", () => {
    const view = renderRow([cell(USA, { result: "conforming" }), cell(ESTADO)])
    expect(document.querySelectorAll("details")).toHaveLength(1)
    expect(details().open).toBe(false)
    expect(within(details()).getByText("Agregar comentario o foto")).toBeInTheDocument()

    view.rerenderCells([cell(USA, { result: "conforming" }), cell(ESTADO, { result: "non_conforming" })])
    expect(details().open).toBe(true)
    expect(within(details()).getByText("Motivo obligatorio")).toBeInTheDocument()
    expect(screen.getByLabelText("Comentario de Casco: usa")).toBeInTheDocument()
    expect(screen.getByLabelText("Comentario de Casco: estado")).toBeInTheDocument()
  })

  it("el problema de una dimensión se dice junto a esa dimensión", () => {
    renderRow([cell(USA), cell(ESTADO, { result: "non_conforming" })])
    expect(screen.getByRole("radiogroup", { name: "Resultado de Casco: estado" })).toHaveAccessibleDescription("Falta el motivo: escribe al menos 3 caracteres.")
    expect(screen.getByRole("radiogroup", { name: "Resultado de Casco: usa" })).not.toHaveAccessibleDescription()
  })

  it("el repintado del padre con celdas iguales (objetos nuevos) no repinta la prenda", () => {
    const view = renderRow([cell(USA), cell(ESTADO)])
    const nameUso = "Resultado de Casco: usa"
    const first = groupRenders[nameUso]!
    view.rerenderCells([cell(USA), cell(ESTADO)])
    view.rerenderCells([cell(USA), cell(ESTADO)])
    expect(groupRenders[nameUso]).toBe(first)
    view.rerenderCells([cell(USA, { result: "conforming" }), cell(ESTADO)])
    expect(groupRenders[nameUso]).toBeGreaterThan(first)
  })
})
