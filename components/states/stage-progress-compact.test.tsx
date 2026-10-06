// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { StageProgressCompact } from "./stage-progress-compact"
import type { RequestProgress } from "@/lib/work-queue"

afterEach(() => cleanup())

function progress(overrides: Partial<RequestProgress>): RequestProgress {
  return {
    currentStage: "Compra",
    completedStages: ["Solicitado", "Aprobación"],
    nextAction: "Falta emitir la OC.",
    items: [],
    ...overrides,
  }
}

describe("StageProgressCompact", () => {
  it("expone etapa, posición y qué falta en una sola etiqueta accesible", () => {
    render(<StageProgressCompact progress={progress({})} />)
    expect(screen.getByRole("img", { name: "Etapa 3 de 5: Compra. Falta emitir la OC." })).toBeTruthy()
  })

  it("muestra la etapa y la acción en texto visible, con el texto completo en title", () => {
    const { container } = render(<StageProgressCompact progress={progress({})} />)
    const line = container.querySelector("p")
    expect(line?.textContent).toBe("Compra · Falta emitir la OC.")
    expect(line?.getAttribute("title")).toBe("Compra: Falta emitir la OC.")
  })

  it("distingue completada / actual / pendiente por forma, no sólo por color", () => {
    const { container } = render(<StageProgressCompact progress={progress({})} />)
    const nodes = Array.from(container.querySelectorAll("ol > li > span:first-child"))
    expect(nodes).toHaveLength(5)
    // completadas: tilde (svg); actual: punto interior; pendientes: vacías.
    expect(nodes.map((n) => n.querySelector("svg") ? "done" : n.querySelector("span") ? "current" : "pending"))
      .toEqual(["done", "done", "current", "pending", "pending"])
  })

  it("marca la etapa final como completada cuando figura en completedStages", () => {
    render(
      <StageProgressCompact
        progress={progress({
          currentStage: "Entrega",
          completedStages: ["Solicitado", "Aprobación", "Compra", "Recepción", "Entrega"],
          nextAction: "Adquisición cerrada: todo llegó a faena.",
        })}
      />,
    )
    expect(screen.getByRole("img", { name: "Etapa Entrega completada (5 de 5). Adquisición cerrada: todo llegó a faena." })).toBeTruthy()
  })

  it("no nombra personas ni roles", () => {
    render(<StageProgressCompact progress={progress({})} />)
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toMatch(/debe|Compras |Aprobación debe/)
  })
})
