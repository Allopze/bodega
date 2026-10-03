// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { SummaryStrip } from "./summary-strip"

const snapshot = {
  header: { worksiteName: "Planta", period: 2026, headcountTotal: 3 },
  entries: [{ id: "a", classification: "important", controlledStatus: "no" }, { id: "b", classification: "tolerable", controlledStatus: "yes" }],
} as unknown as MiperSnapshot

describe("SummaryStrip", () => {
  it("cada botón de filtro empieza su nombre accesible con su texto visible (WCAG 2.5.3)", () => {
    render(<SummaryStrip snapshot={snapshot} authorName={null} submittedAt={null} versionLabel="v1" taskCount={1} completeCount={1}
      onTogglePending={vi.fn()} onToggleClassification={vi.fn()} onToggleUncontrolled={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Importante 1: filtrar la matriz" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Tolerable 1: filtrar la matriz" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Completos 1 de 2: filtrar los riesgos con pendientes" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "No controlados 1: filtrar la matriz" })).toBeTruthy()
  })
})
