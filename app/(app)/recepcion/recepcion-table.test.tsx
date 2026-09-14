// @vitest-environment jsdom
/**
 * REC-005 (auditoría 2026-09-14): la tarjeta móvil de la bandeja de recepción
 * perdía las tres señales de la guía de despacho. La fila de escritorio pintaba
 * "Pendiente de despacho" / "En traslado" / "Diferencia en faena" (esta última
 * en `danger`), mientras que la tarjeta —la que se mira EN FAENA, que es la
 * razón por la que existe (comentario A-1)— sólo mostraba el recuento de
 * `gapMap`. Quien recibía en terreno no veía la diferencia ya detectada.
 */
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/recepcion",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

import { RecepcionTable, type ReceiptGuideRow } from "./recepcion-table"
import { receiptGuideSignal } from "./recepcion-table.helpers"

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

function renderTable(guides: ReceiptGuideRow[], gap = 0) {
  return render(
    <RecepcionTable
      orders={[order]}
      wsMap={{ "ws-1": "Faena Norte" }}
      supMap={{ "sup-1": "Ferretería Andes" }}
      gapMap={{ "oc-1": gap }}
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

describe("bandeja de recepción — señales de guía en la tarjeta móvil (REC-005)", () => {
  it.each([
    ["draft", "Pendiente de despacho"],
    ["dispatched", "En traslado"],
    ["partially_received", "Diferencia en faena"],
  ])("anuncia la guía %s también en el teléfono", (status, label) => {
    const { container } = renderTable([guide(status)])

    // Escritorio: la señal que ya existía antes del arreglo.
    expect(screen.getByRole("table")).toHaveTextContent(label)
    // Móvil: la que faltaba.
    expect(within(mobileCards(container)).getByText(label)).toBeInTheDocument()
  })

  it("la diferencia de una guía parcial gana al recuento de gapMap en ambas vistas", () => {
    const { container } = renderTable([guide("partially_received")], 3)
    const cards = mobileCards(container)

    expect(within(cards).getByText("Diferencia en faena")).toBeInTheDocument()
    // Antes la tarjeta mostraba SÓLO esto y callaba la diferencia.
    expect(within(cards).queryByText(/ítems pendientes de recepción en faena/)).toBeNull()
  })

  it("sin guía viva la tarjeta conserva el recuento de pendientes de faena", () => {
    const { container } = renderTable([], 3)
    const cards = mobileCards(container)
    expect(within(cards).getByText(/ítems pendientes de recepción en faena/)).toBeInTheDocument()
  })
})

describe("receiptGuideSignal", () => {
  it("mapea cada estado de guía a la misma variante que ya usaba el escritorio", () => {
    expect(receiptGuideSignal("draft")).toEqual({ label: "Pendiente de despacho", variant: "warning" })
    expect(receiptGuideSignal("dispatched")).toEqual({ label: "En traslado", variant: "info" })
    expect(receiptGuideSignal("partially_received")).toEqual({ label: "Diferencia en faena", variant: "danger" })
    // `received`/`cancelled` no son guías vivas: no hay señal que dar.
    expect(receiptGuideSignal("received")).toBeNull()
    expect(receiptGuideSignal(undefined)).toBeNull()
  })
})
