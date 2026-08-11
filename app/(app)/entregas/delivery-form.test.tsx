// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { INITIAL_STATE } from "@/components/admin/form-state"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("./actions", () => ({
  registerWorkerDeliveryAction: vi.fn(async () => INITIAL_STATE),
}))

vi.mock("@/components/admin/submit-button", () => ({
  SubmitButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>{label}</button>
  ),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, searchable }: PropsWithChildren<{ searchable?: boolean }>) => (
    <div data-testid="select" data-searchable={String(searchable)}>{children}</div>
  ),
  SelectTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) => <div data-value={value}>{children}</div>,
}))

afterEach(cleanup)

import { DeliveryForm } from "./delivery-form"

describe("DeliveryForm", () => {
  it("muestra trabajadores reales y buscables aunque no haya EPP pendiente", () => {
    render(
      <DeliveryForm
        worksites={[{ id: "office", name: "Oficina CHOME" }]}
        workers={[{
          id: "worker-1",
          name: "Andrea Rojas",
          worksiteId: "faena-1",
          worksiteName: "Faena Santa Fe",
          position: "Operaria",
          rut: "12.345.678-9",
        }]}
        stockProducts={[{
          sourceWorksiteId: "office",
          productId: "helmet",
          productName: "Casco dieléctrico",
          productSku: "EPP-001",
          unitOfMeasure: "unidad",
          stockQuantity: 4,
        }]}
        traceableItems={[]}
        initialSourceWorksiteId="office"
      />,
    )

    expect(screen.getByText("Andrea Rojas · Faena Santa Fe · Operaria")).toBeDefined()
    expect(screen.getByText("Busca por nombre, cargo o faena")).toBeDefined()
    expect(screen.getAllByTestId("select").some((select) => select.dataset.searchable === "true")).toBe(true)
    expect(screen.queryByText(/firma/i)).toBeNull()
  })
})
