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
    const { container } = render(<OtDocument detail={full()} linkedWork={[]} logoSrc="/chome_logo.svg" />)
    expect(container.querySelector(`[${PRINT_READY_ATTRIBUTE}]`)).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Orden de trabajo reparación / mantención")
    expect(screen.getByText("OT-BIO-0001")).toBeTruthy()
    expect(screen.getByText("KA-135 · RBYD-98")).toBeTruthy()
  })

  it("marca REPARACIÓN y MANTENCIÓN según la OT", () => {
    render(<OtDocument detail={full()} linkedWork={[]} logoSrc="/x.svg" />)
    const group = screen.getByRole("group", { name: "Tipo de trabajo" })
    expect(group.textContent).toContain("Reparación: marcada")
    expect(group.textContent).toContain("Mantención: marcada")
  })

  it("las dos listas salen numeradas con SÍ / NO y sólo con lo pedido (sin líneas en blanco)", () => {
    render(<OtDocument detail={full()} linkedWork={[]} logoSrc="/x.svg" />)
    const anexos = within(screen.getByRole("heading", { name: "Trabajos anexos (reparación)" }).closest("section")!)
    expect(anexos.getByText("Cambiar pastillas de freno")).toBeTruthy()
    expect(anexos.getByText("SÍ")).toBeTruthy()
    // Impresas, las líneas vacías del papel parecían datos que faltaban.
    expect(screen.getByRole("heading", { name: "Trabajos anexos (reparación)" }).closest("section")!.querySelectorAll("tbody tr")).toHaveLength(2)
    const mant = within(screen.getByRole("heading", { name: /^Registro de mantenciones/ }).closest("section")!)
    expect(mant.getByText("NO")).toBeTruthy()
    expect(mant.getByText("Falta el filtro")).toBeTruthy()
  })

  it("trae los cuatro recuadros del papel con sus datos", () => {
    render(<OtDocument detail={full()} linkedWork={[]} logoSrc="/x.svg" />)
    for (const name of ["Ingreso a taller", "Salida taller", "Recepción", "Recepción en faena"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy()
    }
    const ingreso = within(screen.getByRole("heading", { name: "Ingreso a taller" }).closest("section")!)
    for (const text of ["Luis Mena", "Taller Los Aromos", "Pedro Díaz", "120.500 km", "05-11-2026"]) expect(ingreso.getByText(text)).toBeTruthy()
    const recepcion = within(screen.getByRole("heading", { name: "Recepción" }).closest("section")!)
    expect(recepcion.getByText("Marco Vera")).toBeTruthy()
    const faena = within(screen.getByRole("heading", { name: "Recepción en faena" }).closest("section")!)
    expect(faena.getByText("Ana Pérez")).toBeTruthy()
    // «Sr.» era abreviatura del papel: impreso se leía como un título.
    expect(faena.getByText("Recibido por")).toBeTruthy()
    expect(screen.queryByText("Sr.")).toBeNull()
  })

  it("abre con el resultado: conforme, devoluciones con su último motivo y el plazo contra lo estimado", () => {
    const detail = full()
    render(<OtDocument
      detail={{
        ...detail,
        status: "cerrada",
        rejectionCount: 1,
      }}
      linkedWork={[]}
      logoSrc="/x.svg"
    />)
    const outcome = within(screen.getByRole("region", { name: "Resultado" }))
    expect(outcome.getByText("Cerrada")).toBeTruthy()
    expect(outcome.getByText(/^Conforme\./)).toBeTruthy()
    expect(outcome.getByText(/Devuelta 1 vez/).closest("li")!.textContent).toContain("Sigue la fuga de aceite")
    // Salida el 03-11 contra una entrega estimada el 05-11.
    expect(outcome.getByText(/Salió de taller 2 días antes de lo estimado \(05-11-2026\)/)).toBeTruthy()
  })

  it("lista los trabajos que el mecánico firmó contra la OT, con horas y repuestos; los anulados quedan tachados", () => {
    render(<OtDocument
      detail={full()}
      linkedWork={[
        { id: "r1", folio: "MC-BIO-0007", kind: "C", workDate: "2026-11-03", executorName: "Javier Roa", voided: false, work: "Frenos, Mecánico", hours: 3.5, parts: [{ quantity: 4, description: "Pastillas de freno" }] },
        { id: "r2", folio: "MC-BIO-0006", kind: "C", workDate: "2026-11-02", executorName: "Javier Roa", voided: true, work: "Frenos", hours: 1, parts: [] },
      ]}
      logoSrc="/x.svg"
    />)
    const work = within(screen.getByRole("heading", { name: "Trabajos registrados" }).closest("section")!)
    expect(work.getByText("MC-BIO-0007")).toBeTruthy()
    expect(work.getByText("Correctiva · Frenos, Mecánico")).toBeTruthy()
    expect(work.getByText("3,5")).toBeTruthy()
    expect(work.getByText("4 × Pastillas de freno")).toBeTruthy()
    expect(work.getByText("Anulado")).toBeTruthy()
    expect(work.getByText("MC-BIO-0006").closest("tr")!.className).toContain("voided")
  })

  it("una OT sin ingreso imprime los recuadros vacíos con «—», no se cae", () => {
    render(<OtDocument detail={otDetail({ entry: null, status: "asignada" })} linkedWork={[]} logoSrc="/x.svg" />)
    const ingreso = within(screen.getByRole("heading", { name: "Ingreso a taller" }).closest("section")!)
    expect(ingreso.getAllByText("—").length).toBeGreaterThanOrEqual(6)
  })

  it("una OT anulada imprime ANULADA con su motivo", () => {
    render(<OtDocument detail={otDetail({ status: "anulada", voided: { at: "2026-11-02T10:00:00.000Z", byName: "Alexis Soto", reason: "Equipo equivocado" } })} linkedWork={[]} logoSrc="/x.svg" />)
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
