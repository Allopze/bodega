// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./actions", () => ({ createWorker: vi.fn(), updateWorker: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { WorkerForm } from "./worker-form"
import type { WorkerTalanaInfo } from "./talana-info"

afterEach(cleanup)

const positions = [
  { id: "worker-position-unclassified", code: "SIN-CLASIFICAR", name: "Sin clasificar", isActive: true, needsReview: true },
  { id: "pos-operador", code: "OPERADOR", name: "Operador", isActive: true, needsReview: true },
]

describe("WorkerForm", () => {
  it("usa el catálogo y advierte cuando el cargo requiere revisión", () => {
    render(
      <WorkerForm
        open
        onClose={vi.fn()}
        worksites={[{ id: "ws-1", name: "Faena Uno" }]}
        sizeFamilies={[]}
        positions={positions}
        editWorker={{
          id: "worker-1",
          rut: null,
          firstName: "Ana",
          lastName: "Pérez",
          sex: null,
          positionId: "pos-operador",
          position: "Operador",
          positionNeedsReview: true,
          worksiteId: "ws-1",
          isActive: true,
          sizeTop: null,
          sizeBottom: null,
          sizeShoe: null,
          sizeGloves: null,
          sizeHelmet: null,
        }}
      />,
    )

    expect(screen.getByRole("combobox", { name: "Cargo" })).toHaveTextContent("Operador")
    expect(screen.getByText(/pendiente de revisión/i)).toBeTruthy()
    expect(document.querySelector('input[name="positionId"]')).toHaveValue("pos-operador")
    expect(document.querySelector('input[name="position"]')).toBeNull()
  })

  it("precarga el sexo guardado y lo envía con el formulario", () => {
    render(
      <WorkerForm
        open
        onClose={vi.fn()}
        worksites={[{ id: "ws-1", name: "Faena Uno" }]}
        sizeFamilies={[]}
        positions={positions}
        editWorker={{
          id: "worker-2",
          rut: null,
          firstName: "Rosa",
          lastName: "Díaz",
          sex: "female",
          positionId: "pos-operador",
          position: "Operador",
          positionNeedsReview: false,
          worksiteId: "ws-1",
          isActive: true,
          sizeTop: null,
          sizeBottom: null,
          sizeShoe: null,
          sizeGloves: null,
          sizeHelmet: null,
        }}
      />,
    )

    expect(screen.getByRole("combobox", { name: "Sexo" })).toHaveTextContent("Mujer")
    expect(document.querySelector('input[name="sex"]')).toHaveValue("female")
  })

  it("un trabajador nuevo queda sin sexo registrado hasta que se elija", () => {
    render(
      <WorkerForm
        open
        onClose={vi.fn()}
        worksites={[{ id: "ws-1", name: "Faena Uno" }]}
        sizeFamilies={[]}
        positions={positions}
      />,
    )

    expect(screen.getByRole("combobox", { name: "Sexo" })).toHaveTextContent("Sin registrar")
    expect(document.querySelector('input[name="sex"]')).toHaveValue("")
  })
})

describe("WorkerForm — Datos de Talana", () => {
  const TALANA: WorkerTalanaInfo = {
    summary: {
      syncedAt: "2026-11-08T09:35:00.000Z",
      contract: {
        type: "Plazo Fijo", fixedTerm: true, hiredOn: "2026-03-01", startsOn: "2026-09-01", endsOn: "2027-01-31",
        state: "vigente", costCenterName: "Masisa Maderas", cargo: "Operador de maquinaria", jefeName: "Juan Soto",
      },
      absence: { label: "Licencia médica", startsOn: "2026-11-02", endsOn: "2026-11-20", current: true },
    },
    chips: [],
  }

  const baseWorker = {
    id: "worker-3", rut: null, firstName: "Luis", lastName: "Soto", sex: null,
    positionId: "pos-operador", position: "Operador", positionNeedsReview: false,
    worksiteId: "ws-1", isActive: true,
    sizeTop: null, sizeBottom: null, sizeShoe: null, sizeGloves: null, sizeHelmet: null,
  }

  function renderForm(editWorker: (typeof baseWorker & { talana?: WorkerTalanaInfo }) | null) {
    return render(
      <WorkerForm
        open
        onClose={vi.fn()}
        worksites={[{ id: "ws-1", name: "Faena Uno" }]}
        sizeFamilies={[]}
        positions={positions}
        editWorker={editWorker}
      />,
    )
  }

  function panel() {
    return within(screen.getByText("Datos de Talana").closest("div") as HTMLElement)
  }

  it("al editar, muestra contrato, término, centro de costo, cargo, jefe y ausencia de sólo lectura", () => {
    renderForm({ ...baseWorker, talana: TALANA })

    expect(panel().getByText("Plazo Fijo · desde 01-09-2026")).toBeTruthy()
    expect(panel().getByText(/Fecha de vencimiento: 31-01-2027/)).toBeTruthy()
    expect(panel().getByText("Masisa Maderas")).toBeTruthy()
    expect(panel().getByText("Operador de maquinaria")).toBeTruthy()
    expect(panel().getByText("Juan Soto")).toBeTruthy()
    expect(panel().getByText("Licencia médica · hasta 20-11-2026")).toBeTruthy()
    expect(panel().getByText(/Al 08-11-2026.*Se corrige en Talana\./)).toBeTruthy()
    // Es de lectura: no agrega campos al formulario.
    expect(document.querySelector('[name="talana"]')).toBeNull()
  })

  it("un indefinido vigente no muestra «Término» y sin ausencia el campo queda en «—»", () => {
    renderForm({
      ...baseWorker,
      talana: {
        chips: [],
        summary: {
          syncedAt: null,
          contract: { ...TALANA.summary.contract!, type: "Indefinido", fixedTerm: false, endsOn: null },
          absence: null,
        },
      },
    })

    expect(panel().getByText(/^Indefinido · desde/, { selector: "dd" })).toBeTruthy()
    expect(panel().queryByText("Término")).toBeNull()
    expect(panel().getByText("Ausencia").nextElementSibling).toHaveTextContent("—")
    expect(panel().getByText(/Se corrige en Talana\./)).toBeTruthy()
  })

  it("un contrato finiquitado dice «Finiquitado» con la fecha de término", () => {
    renderForm({
      ...baseWorker,
      talana: {
        chips: [],
        summary: {
          syncedAt: null,
          contract: { ...TALANA.summary.contract!, state: "finiquitado", endsOn: "2026-10-15" },
          absence: null,
        },
      },
    })

    expect(panel().getByText("Finiquitado · 15-10-2026")).toBeTruthy()
  })

  it("sin `talana` (sin el permiso) no hay panel", () => {
    renderForm(baseWorker)

    expect(screen.queryByText("Datos de Talana")).toBeNull()
    expect(screen.queryByText(/Se corrige en Talana/)).toBeNull()
  })

  it("al crear un trabajador no hay panel de Talana", () => {
    renderForm(null)

    expect(screen.queryByText("Datos de Talana")).toBeNull()
  })
})
