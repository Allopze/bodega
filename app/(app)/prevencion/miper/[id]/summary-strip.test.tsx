// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { SummaryStrip } from "./summary-strip"

const snapshot = {
  header: { worksiteName: "Planta", period: 2026, headcountTotal: 3 },
  entries: [{ id: "a", classification: "important", controlledStatus: "no" }, { id: "b", classification: "tolerable", controlledStatus: "yes" }],
} as unknown as MiperSnapshot

describe("SummaryStrip", () => {
  it.each([[0, "2 riesgos con datos pendientes"], [1, "1 riesgo con datos pendientes"]])("%i completos: el rótulo del botón dice qué filtra", (completeCount, label) => {
    const onTogglePending = vi.fn()
    render(<SummaryStrip snapshot={snapshot} authorName={null} submittedAt={null} versionLabel="v1" taskCount={1} completeCount={completeCount} onTogglePending={onTogglePending} />)
    fireEvent.click(screen.getByRole("button", { name: label }))
    expect(onTogglePending).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: /Completos/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Importante/ })).toBeNull()
  })
  it("sin pendientes muestra el estado sin ofrecer un filtro vacío; datos documentales plegados", () => {
    const { container } = render(<SummaryStrip snapshot={snapshot} authorName="Ana" submittedAt={null} versionLabel="v1" completeCount={2} onTogglePending={vi.fn()} />)
    expect(screen.getByText("Todos los riesgos tienen los datos requeridos")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
    expect(container.querySelector("details")).not.toHaveAttribute("open")
    expect(screen.getByText("Elaboró Ana")).toBeInTheDocument()
  })
  it("la tira marca los datos documentales con un único disclosure de texto exacto", () => {
    render(<SummaryStrip snapshot={snapshot} authorName={null} submittedAt={null} versionLabel="v1" completeCount={2} />)
    expect(screen.getByText("Datos del documento")).toBeInTheDocument()
  })
})
