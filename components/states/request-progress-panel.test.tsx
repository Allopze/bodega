// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { RequestProgressPanel } from "./request-progress-panel"
import type { RequestProgress } from "@/lib/work-queue"

afterEach(() => cleanup())

describe("RequestProgressPanel", () => {
  it("shows item attributes when the product has them", () => {
    const progress = {
      currentStage: "Recepción",
      completedStages: ["Solicitado", "Aprobación", "Compra"],
      nextAction: "Orden recibida completamente.",
      items: [{
        id: "item-1",
        productName: "Guante Cabrillita Activex con Forro",
        quantityLabel: "20 pares",
        stageLabel: "Recepción",
        statusLabel: "Recibido",
        attributes: [
          { name: "Talla", value: "L" },
          { name: "Color", value: "Azul" },
        ],
      }],
    } as RequestProgress

    render(<RequestProgressPanel progress={progress} />)

    expect(screen.getByText("Talla: L")).toBeInTheDocument()
    expect(screen.getByText("Color: Azul")).toBeInTheDocument()
  })

  it("does not add an empty attribute row when the product has no attributes", () => {
    const progress = {
      currentStage: "Recepción",
      completedStages: ["Solicitado", "Aprobación", "Compra"],
      nextAction: "Orden recibida completamente.",
      items: [{
        id: "item-1",
        productName: "Buzo Dupont Tyvek",
        quantityLabel: "2 unidades",
        stageLabel: "Recepción",
        statusLabel: "Recibido",
        attributes: [],
      }],
    } as RequestProgress

    render(<RequestProgressPanel progress={progress} />)

    expect(screen.queryByLabelText("Atributos del producto")).not.toBeInTheDocument()
  })

  // ADQ-08: SOL-0044 (Cerrada) mostraba "Recepción" con reloj, como si siguiera
  // esperando algo, aunque la etapa ya estaba completa.
  it("shows the current stage as completed (check, no clock) when it is done", () => {
    const progress = {
      currentStage: "Recepción",
      completedStages: ["Solicitado", "Aprobación", "Compra", "Recepción"],
      nextAction: "Adquisición cerrada: todo llegó a faena.",
      items: [],
    } as RequestProgress

    render(<RequestProgressPanel progress={progress} />)

    expect(screen.getByText("Recepción completada")).toBeInTheDocument()
  })

  it("keeps the plain stage chip while the stage is still open", () => {
    const progress = {
      currentStage: "Recepción",
      completedStages: ["Solicitado", "Aprobación", "Compra"],
      nextAction: "Pendiente de recepción: falta que lleguen los ítems del proveedor.",
      items: [],
    } as RequestProgress

    render(<RequestProgressPanel progress={progress} />)

    expect(screen.queryByText("Recepción completada")).not.toBeInTheDocument()
    expect(screen.getAllByText("Recepción").length).toBeGreaterThan(0)
  })
})
