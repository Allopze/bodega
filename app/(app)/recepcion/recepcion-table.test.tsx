// @vitest-environment jsdom
/**
 * REC-005 / ADQ-09: la tarjeta móvil y la fila de escritorio deben decir lo
 * mismo. Desde ADQ-09 ambas pintan la etapa de la OC y «qué falta» (un solo
 * componente, `StageProgressCompact`) en lugar de pastillas de guía y un
 * recuento de pendientes aparte.
 */
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/recepcion",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

import { RecepcionTable, type ReceiptGuideRow } from "./recepcion-table"
import { receiptGuideActionLabel } from "./recepcion-table.helpers"

// `StageProgressCompact` (línea J1) tiene su propia prueba: aquí sólo importa
// que la bandeja lo pinte en las dos vistas con el progreso de cada OC.
vi.mock("@/components/states/stage-progress-compact", () => ({
  StageProgressCompact: ({ progress }: { progress: { currentStage: string; nextAction: string } }) => (
    <div>
      <span>{`etapa:${progress.currentStage}`}</span>
      <span>{`falta:${progress.nextAction}`}</span>
    </div>
  ),
}))

const progress = {
  currentStage: "Recepción",
  completedStages: ["Solicitado", "Aprobación"],
  nextAction: "diferencias",
  items: [],
}

const order = {
  id: "oc-1",
  code: "OC-000123",
  worksiteId: "ws-1",
  supplierId: "sup-1",
  status: "office_received",
  deliveryMode: "via_oficina",
  sentAt: "2026-09-01",
  createdAt: "2026-08-28",
}

function renderTable(guides: ReceiptGuideRow[]) {
  return render(
    <RecepcionTable
      orders={[order]}
      wsMap={{ "ws-1": "Faena Norte" }}
      supMap={{ "sup-1": "Ferretería Andes" }}
      progressMap={{ "oc-1": progress }}
      guideMap={{ "oc-1": guides }}
      canOffice
      canFaena
      officeName="Oficina Central"
    />,
  )
}

const guide = (status: string): ReceiptGuideRow => ({
  id: "gdi-1", code: "GDI-1", status, totalQuantity: 10, receivedQuantity: 4,
})

/** El bloque de tarjetas es el `md:hidden` que `DataTable` monta junto a la tabla. */
function mobileCards(container: HTMLElement) {
  return container.querySelector<HTMLElement>("div.md\\:hidden")!
}

describe("bandeja de recepción — etapa y «qué falta» (ADQ-09)", () => {
  it("escritorio y teléfono muestran la etapa de la OC", () => {
    const { container } = renderTable([guide("dispatched")])
    expect(within(screen.getByRole("table")).getByText("etapa:Recepción")).toBeInTheDocument()
    expect(within(mobileCards(container)).getByText("etapa:Recepción")).toBeInTheDocument()
  })

  it("lleva el «qué falta» de la OC, sin pastillas de guía ni recuento aparte (A5)", () => {
    const { container } = renderTable([guide("partially_received")])
    expect(screen.getByRole("table")).toHaveTextContent("falta:diferencias")
    expect(container.textContent).not.toMatch(/Pend\. de faena|por llegar a faena|Pendiente de despacho/)
  })

  it("una OC anulada (sin progreso) no pinta etapa", () => {
    const { container } = render(
      <RecepcionTable
        orders={[order]}
        wsMap={{ "ws-1": "Faena Norte" }}
        supMap={{ "sup-1": "Ferretería Andes" }}
        progressMap={{ "oc-1": null }}
        guideMap={{}}
        canOffice
        canFaena
        officeName="Oficina Central"
      />,
    )
    expect(container.textContent).not.toMatch(/etapa:/)
  })
})

// ADQ-11: un solo verbo para la guía viva, en escritorio y móvil.
describe("acción sobre la guía viva (ADQ-11)", () => {
  it("borrador → «Completar despacho»; despachada/parcial → «Confirmar llegada a faena»", () => {
    expect(receiptGuideActionLabel("draft")).toBe("Completar despacho")
    expect(receiptGuideActionLabel("dispatched")).toBe("Confirmar llegada a faena")
    expect(receiptGuideActionLabel("partially_received")).toBe("Confirmar llegada a faena")
  })

  it("escritorio y móvil rotulan igual y no queda «Cotejar» ni «Completar guía»", () => {
    const { container } = renderTable([guide("dispatched")])
    expect(within(screen.getByRole("table")).getByRole("link", { name: "Confirmar llegada a faena" })).toBeInTheDocument()
    expect(within(mobileCards(container)).getByRole("link", { name: "Confirmar llegada a faena" })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Cotejar|Completar guía/)
  })
})
