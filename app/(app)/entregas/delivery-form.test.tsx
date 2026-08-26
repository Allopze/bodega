// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { INITIAL_STATE } from "@/lib/form-state"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("./actions", () => ({
  registerWorkerDeliveryAction: vi.fn(async () => INITIAL_STATE),
}))

vi.mock("@/components/ui/submit-button", () => ({
  SubmitButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>{label}</button>
  ),
}))

vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: ({ min, max, ...props }: { min?: string; max?: string; [key: string]: unknown }) => (
    <input data-testid="delivery-date-picker" min={min} max={max} {...props} />
  ),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, searchable, value, onValueChange }: PropsWithChildren<{
    searchable?: boolean
    value?: string
    onValueChange?: (value: string) => void
  }>) => (
    <select
      data-testid="select"
      data-searchable={String(searchable)}
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: PropsWithChildren) => <>{children}</>,
  SelectItem: ({ children, value, disabled }: PropsWithChildren<{ value: string; disabled?: boolean }>) => (
    <option value={value} disabled={disabled}>{children}</option>
  ),
}))

afterEach(cleanup)

import { DeliveryForm } from "./delivery-form"

describe("DeliveryForm", () => {
  it("permite seleccionar cualquier fecha pasada y limita sólo el futuro", () => {
    render(
      <DeliveryForm
        today="2026-08-21"
        worksites={[{ id: "faena-1", name: "Faena Santa Fe" }]}
        workers={[{
          id: "worker-1",
          name: "Andrea Rojas",
          worksiteId: "faena-1",
          worksiteName: "Faena Santa Fe",
          position: "Operaria",
          rut: "12.345.678-9",
        }]}
        stockProducts={[{
          sourceWorksiteId: "faena-1",
          productId: "helmet",
          productName: "Casco dieléctrico",
          productSku: "EPP-001",
          unitOfMeasure: "unidad",
          stockQuantity: 4,
        }]}
      />,
    )

    const datePicker = screen.getByTestId("delivery-date-picker")
    expect(datePicker).not.toHaveAttribute("min")
    expect(datePicker).toHaveAttribute("max", "2026-08-21")
    expect(screen.getByText("Por defecto hoy. Puedes registrar cualquier fecha pasada.")).toBeDefined()
  })

  it("muestra sólo trabajadores de la faena seleccionada aunque no haya EPP pendiente", () => {
    render(
      <DeliveryForm
        today="2026-08-21"
        worksites={[
          { id: "faena-1", name: "Faena Santa Fe" },
          { id: "faena-2", name: "Faena Arauco" },
        ]}
        workers={[
          {
            id: "worker-1",
            name: "Andrea Rojas",
            worksiteId: "faena-1",
            worksiteName: "Faena Santa Fe",
            position: "Operaria",
            rut: "12.345.678-9",
          },
          {
            id: "worker-2",
            name: "Bruno Soto",
            worksiteId: "faena-2",
            worksiteName: "Faena Arauco",
            position: "Supervisor",
            rut: "11.111.111-1",
          },
        ]}
        stockProducts={[{
          sourceWorksiteId: "faena-1",
          productId: "helmet",
          productName: "Casco dieléctrico",
          productSku: "EPP-001",
          unitOfMeasure: "unidad",
          stockQuantity: 4,
        }]}
        traceableItems={[]}
        initialSourceWorksiteId="faena-1"
      />,
    )

    expect(screen.getByText("Andrea Rojas · Faena Santa Fe · Operaria")).toBeDefined()
    expect(screen.queryByText("Bruno Soto · Faena Arauco · Supervisor")).toBeNull()
    expect(screen.getAllByTestId("select").some((select) => select.dataset.searchable === "true")).toBe(true)
    expect(screen.queryByText(/firma/i)).toBeNull()

    fireEvent.change(screen.getAllByTestId("select")[0]!, { target: { value: "faena-2" } })

    expect(screen.queryByText("Andrea Rojas · Faena Santa Fe · Operaria")).toBeNull()
    expect(screen.getByText("Bruno Soto · Faena Arauco · Supervisor")).toBeDefined()
  })

  it("abre en una bodega con dotación, no en la bodega de oficina que sólo tiene stock", () => {
    render(
      <DeliveryForm
        today="2026-08-21"
        worksites={[
          { id: "ws-oficina", name: "Administración" },
          { id: "faena-1", name: "Faena Santa Fe" },
        ]}
        workers={[{
          id: "worker-1",
          name: "Andrea Rojas",
          worksiteId: "faena-1",
          worksiteName: "Faena Santa Fe",
          position: "Operaria",
          rut: "12.345.678-9",
        }]}
        stockProducts={[
          {
            sourceWorksiteId: "ws-oficina",
            productId: "gloves",
            productName: "Guantes",
            productSku: "EPP-002",
            unitOfMeasure: "unidad",
            stockQuantity: 10,
          },
          {
            sourceWorksiteId: "faena-1",
            productId: "helmet",
            productName: "Casco dieléctrico",
            productSku: "EPP-001",
            unitOfMeasure: "unidad",
            stockQuantity: 4,
          },
        ]}
        traceableItems={[]}
      />,
    )

    // Sin `initialSourceWorksiteId`, la oficina va primera en stock y en la
    // lista de bodegas, pero no tiene dotación: debe ganar la faena.
    expect((screen.getAllByTestId("select")[0] as HTMLSelectElement).value).toBe("faena-1")
    expect(screen.getByText("Andrea Rojas · Faena Santa Fe · Operaria")).toBeDefined()
  })
})
