// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { OtDocument } from "@/app/(print)/mantencion/ot/[id]/print/ot-document"
import { OT_PRINT_STYLES } from "@/app/(print)/mantencion/ot/[id]/print/ot-print-styles"
import { PRINT_DOCUMENT_SPECS, PRINT_READY_ATTRIBUTE } from "@/lib/pdf/print-specs"
import { otDetail } from "./ot-fixtures"

afterEach(cleanup)

const full = () => otDetail({
  repair: true,
  maintenance: true,
  exit: { exitAt: "2026-11-03T14:30:00.000Z", finishedByName: "Javier Roa" },
  reception: { receivedAt: "2026-11-03T18:00:00.000Z", receiverName: "Marco Vera", recordedByName: "Alexis Soto", recordedAt: "2026-11-03T18:05:00.000Z" },
  faenaReception: { receivedAt: "2026-11-04T13:00:00.000Z", receiverName: "Ana Pérez", recordedByName: "Ana Pérez", closedAt: "2026-11-04T13:01:00.000Z" },
})

describe("talonario de la OT para imprimir", () => {
  it("lleva la marca que exige el render del PDF y el encabezado del papel", () => {
    const { container } = render(<OtDocument detail={full()} logoSrc="/chome_logo.svg" />)
    expect(container.querySelector(`[${PRINT_READY_ATTRIBUTE}]`)).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Orden de trabajo reparación / mantención")
    expect(screen.getByText("OT-BIO-0001")).toBeTruthy()
    expect(screen.getByText("KA-135 · RBYD-98")).toBeTruthy()
  })

  it("marca REPARACIÓN y MANTENCIÓN según la OT", () => {
    render(<OtDocument detail={full()} logoSrc="/x.svg" />)
    const group = screen.getByRole("group", { name: "Tipo de trabajo" })
    expect(group.textContent).toContain("Reparación: marcada")
    expect(group.textContent).toContain("Mantención: marcada")
  })

  it("las dos listas salen numeradas con SÍ / NO y se completan con líneas en blanco, como el papel", () => {
    render(<OtDocument detail={full()} logoSrc="/x.svg" />)
    const anexos = within(screen.getByRole("heading", { name: "Trabajos anexos (reparación)" }).closest("section")!)
    expect(anexos.getByText("Cambiar pastillas de freno")).toBeTruthy()
    expect(anexos.getByText("SÍ")).toBeTruthy()
    // 2 líneas con texto + 2 en blanco hasta el mínimo de 4.
    expect(screen.getByRole("heading", { name: "Trabajos anexos (reparación)" }).closest("section")!.querySelectorAll("tbody tr")).toHaveLength(4)
    const mant = within(screen.getByRole("heading", { name: /^Registro de mantenciones/ }).closest("section")!)
    expect(mant.getByText("NO")).toBeTruthy()
    expect(mant.getByText("Falta el filtro")).toBeTruthy()
  })

  it("trae los cuatro recuadros del papel con sus datos", () => {
    render(<OtDocument detail={full()} logoSrc="/x.svg" />)
    for (const name of ["Ingreso a taller", "Salida taller", "Recepción", "Recepción en faena"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy()
    }
    const ingreso = within(screen.getByRole("heading", { name: "Ingreso a taller" }).closest("section")!)
    for (const text of ["Luis Mena", "Taller Los Aromos", "Pedro Díaz", "120.500", "05-11-2026"]) expect(ingreso.getByText(text)).toBeTruthy()
    const recepcion = within(screen.getByRole("heading", { name: "Recepción" }).closest("section")!)
    expect(recepcion.getByText("Marco Vera")).toBeTruthy()
    const faena = within(screen.getByRole("heading", { name: "Recepción en faena" }).closest("section")!)
    expect(faena.getByText("Ana Pérez")).toBeTruthy()
  })

  it("una OT sin ingreso imprime los recuadros vacíos con «—», no se cae", () => {
    render(<OtDocument detail={otDetail({ entry: null, status: "asignada" })} logoSrc="/x.svg" />)
    const ingreso = within(screen.getByRole("heading", { name: "Ingreso a taller" }).closest("section")!)
    expect(ingreso.getAllByText("—").length).toBeGreaterThanOrEqual(6)
  })

  it("una OT anulada imprime ANULADA con su motivo", () => {
    render(<OtDocument detail={otDetail({ status: "anulada", voided: { at: "2026-11-02T10:00:00.000Z", byName: "Alexis Soto", reason: "Equipo equivocado" } })} logoSrc="/x.svg" />)
    expect(screen.getByRole("note").textContent).toContain("ANULADA")
    expect(screen.getByRole("note").textContent).toContain("Equipo equivocado")
  })

  it("la spec de impresión apunta a la página de la OT, sin archivar y sin esperar imágenes", () => {
    const spec = PRINT_DOCUMENT_SPECS.mantencion_ot
    expect(spec.path("ot 1")).toBe("/mantencion/ot/ot%201/print")
    expect(spec.waitForImages).toBe(false)
  })

  it("los estilos cubren el @page A4 y el recuadro de SÍ / NO", () => {
    expect(OT_PRINT_STYLES).toContain("@page { size: A4;")
    expect(OT_PRINT_STYLES).toContain("td.yn")
  })
})
