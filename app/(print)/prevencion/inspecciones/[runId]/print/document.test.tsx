// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// El documento importa el servicio solo para `loadInspectionActaData`; lo que se
// prueba aquí es el render, así que se evita arrastrar la base de datos.
vi.mock("@/lib/services/prevention-inspections", () => ({ getInspectionRunDetail: vi.fn() }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ kind: "all" }) }))

import { InspectionActaDocument, actaComplianceLabels, type InspectionActaData } from "./document"

type RunOverrides = Partial<InspectionActaData["detail"]["run"]>

function actaData(run: RunOverrides = {}): InspectionActaData {
  return {
    detail: {
      run: {
        id: "run-1",
        code: "INSP-0001",
        status: "completed",
        origin: "prevencion",
        scheduledFor: "2026-10-19",
        executedAt: null,
        subjectType: "contenedor",
        subjectLabel: "KA122",
        locationLatitude: null,
        locationLongitude: null,
        conformingCount: 4,
        partialCount: 0,
        nonConformingCount: 1,
        notApplicableCount: 0,
        compliancePercent: 80,
        officialComplianceBasisPoints: null,
        normalizedComplianceBasisPoints: null,
        closingResult: null,
        closingRestrictions: null,
        closingSignatures: null,
        ...run,
      },
      templateName: "Inspección de extintores",
      templateKind: "inspection",
      worksiteName: "Faena E2E",
      executorName: "Ana Soto",
      reviewerName: null,
      findings: [],
      answers: [
        { sectionId: "s1", itemId: "tipo", result: "recorded", value: "pqs", comment: "Cargado en 2025.", evidence: [] },
        { sectionId: "s1", itemId: "vence", result: "recorded", value: "2026-12-31", comment: null, evidence: [] },
        { sectionId: "s1", itemId: "manometro", result: "non_conforming", value: null, comment: "Aguja fuera de rango.", evidence: [] },
      ],
    },
    definition: {
      sections: [
        {
          id: "s1",
          title: "Extintor",
          items: [
            {
              id: "tipo",
              label: "Tipo de extintor",
              kind: "select",
              options: [{ value: "pqs", label: "PQS (Polvo Químico Seco)" }, { value: "co2", label: "CO2" }],
            },
            { id: "vence", label: "Vencimiento de la carga", kind: "date" },
            { id: "manometro", label: "Manómetro", kind: "bueno_regular_malo_obs" },
          ],
        },
      ],
    },
    closingAct: null,
    suggestedFilename: "INSP-0001.pdf",
  } as unknown as InspectionActaData
}

/** El valor de una fila de la grilla de datos del acta, por su rótulo. */
function fieldValue(container: HTMLElement, label: string) {
  const row = Array.from(container.querySelectorAll(".field-row"))
    .find((node) => node.querySelector(".field-label")?.textContent === label)
  return row?.querySelector(".field-value")?.textContent ?? null
}

describe("acta imprimible de una inspección", () => {
  it("imprime la fecha programada y el sujeto en el formato de la plataforma, no como se guardan", () => {
    const { container } = render(<InspectionActaDocument data={actaData()} />)

    expect(fieldValue(container, "Programada")).toBe("19-10-2026")
    expect(fieldValue(container, "Sujeto")).toBe("Contenedor · KA122")
  })

  it("un ítem que no puntúa se lee por la etiqueta de su opción y la fecha con formato, no por el valor crudo", () => {
    const { container } = render(<InspectionActaDocument data={actaData()} />)
    const text = container.textContent ?? ""

    expect(text).toContain("PQS (Polvo Químico Seco)")
    expect(text).toContain("31-12-2026")
    const filaTipo = Array.from(container.querySelectorAll("tr")).find((row) => row.textContent?.includes("Tipo de extintor"))
    expect(filaTipo?.textContent).not.toMatch(/\bpqs\b/)
    expect(text).not.toContain("2026-12-31")
  })

  it("el comentario de un ítem que no puntúa también sale en el acta", () => {
    const { container } = render(<InspectionActaDocument data={actaData()} />)
    const filaTipo = Array.from(container.querySelectorAll("tr")).find((row) => row.textContent?.includes("Tipo de extintor"))

    expect(filaTipo?.textContent).toContain("Cargado en 2025.")
  })

  it("separa el resultado oficial del normalizado y no repite el rótulo ambiguo «Cumplimiento»", () => {
    const { container } = render(
      <InspectionActaDocument data={actaData({ officialComplianceBasisPoints: 9_091, normalizedComplianceBasisPoints: 9_524, compliancePercent: 95 })} />,
    )

    expect(fieldValue(container, "Resultado oficial")).toBe("90.91%")
    expect(fieldValue(container, "Resultado normalizado")).toBe("95.24%")
    expect(fieldValue(container, "Cumplimiento")).toBeNull()
  })

  it("una fila anterior a los puntos base conserva su porcentaje firmado en lugar de «No calculable»", () => {
    const { container } = render(<InspectionActaDocument data={actaData()} />)

    expect(fieldValue(container, "Resultado normalizado")).toBe("80%")
    expect(fieldValue(container, "Resultado oficial")).toBe("Sin fórmula en el documento")
  })

  it("sin cifra alguna dice «No calculable» y no «0%»", () => {
    const { container } = render(<InspectionActaDocument data={actaData({ compliancePercent: null })} />)

    expect(fieldValue(container, "Resultado normalizado")).toBe("No calculable")
  })
})

describe("actaComplianceLabels", () => {
  it("prefiere los puntos base exactos al porcentaje entero", () => {
    expect(actaComplianceLabels({
      officialComplianceBasisPoints: null,
      normalizedComplianceBasisPoints: 8_350,
      compliancePercent: 84,
    }).normalized).toBe("83.5%")
  })
})
