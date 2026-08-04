// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MobileDocumentSummary } from "./mobile-document-summary"

describe("MobileDocumentSummary", () => {
  it("keeps the mobile reading view distinct from the A4 document", () => {
    render(
      <MobileDocumentSummary
        code="Acta SST"
        title="Evaluación preventiva"
        description="María Pérez · Faena Norte"
        sections={[{ title: "Resultado", fields: [{ label: "Estado", value: "Aprobado" }] }]}
      />,
    )

    expect(screen.getByRole("main", { name: "Resumen de Evaluación preventiva" })).toBeInTheDocument()
    expect(screen.getByText("Esta es una vista de lectura. Descarga el PDF para conservar el documento A4 completo.")).toBeInTheDocument()
    expect(screen.getByText("Aprobado")).toBeInTheDocument()
  })
})
