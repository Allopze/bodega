// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import type { SafetyIndicator } from "@/db/schema"

vi.mock("next/server", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("next/dynamic", () => ({ default: () => () => null }))
vi.mock("@/app/(app)/analitica/analytics-kpi-card", () => ({ KpiCard: () => null }))
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: PropsWithChildren) => <section>{children}</section>,
  CardContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectTrigger: ({ children }: PropsWithChildren) => <button type="button">{children}</button>,
  SelectValue: () => null,
  SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children }: PropsWithChildren) => <button type="button">{children}</button>,
  TabsContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))
vi.mock("./indicadores-edit-modal", () => ({
  IndicadoresEditModal: ({ month }: { month: number }) => <div>Editor del mes {month}</div>,
}))

import { IndicadoresDashboard } from "./indicadores-dashboard"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("IndicadoresDashboard", () => {
  it("offers explicit register actions instead of relying on row clicks", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"))
    render(
      <IndicadoresDashboard
        worksites={[{ id: "faena-1", name: "Faena Norte" }]}
        indicatorRows={[] as SafetyIndicator[]}
        year={2026}
        currentYear={2026}
        canManage
      />,
    )

    expect(screen.getByText("Sin registros para Faena Norte en 2026.")).toBeDefined()
    expect(screen.getAllByRole("button", { name: "Registrar" })).toHaveLength(24)
    const registerCurrentMonth = screen.getByRole("button", { name: "Registrar mes actual · Julio" })

    fireEvent.click(registerCurrentMonth)
    expect(screen.getByText("Editor del mes 7")).toBeDefined()
  })
})
