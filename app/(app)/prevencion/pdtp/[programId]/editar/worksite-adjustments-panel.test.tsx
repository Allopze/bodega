// @vitest-environment jsdom
/**
 * El control que faltaba: la regla de dotación R4 (`syncPdtpCphsHeadcountExclusion`)
 * estaba implementada y probada por faena, pero ninguna pantalla la llamaba.
 * Estos casos fijan que el botón exista en la matriz de ajustes por faena y que
 * el resultado del servidor —cuántas faenas cambiaron— llegue al usuario, que es
 * lo único que distingue "no había nada que cambiar" de "no se aplicó".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { WorksiteAdjustmentsPanel } from "./worksite-adjustments-panel"

const { mockApplyRule, mockAdjustment, mockRefresh, mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockApplyRule: vi.fn(),
  mockAdjustment: vi.fn(),
  mockRefresh: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }))
vi.mock("../../actions", () => ({
  applyPdtpCphsHeadcountRuleAction: mockApplyRule,
  setPdtpActivityWorksiteAdjustmentAction: mockAdjustment,
}))
vi.mock("@/lib/toast", () => ({ toast: { success: mockToastSuccess, error: mockToastError } }))

const WORKSITES = [
  { id: "ws-1", name: "Cholguán", code: "F1" },
  { id: "ws-2", name: "Horcones", code: "F2" },
]

const ACTIVITIES = [{
  id: "act-11", n: 11, activity: "Constituir el o los Comités Paritarios cuando proceda",
  responsibleDisplay: "Prevencionista", status: "active",
}] as never

function renderPanel() {
  return render(
    <WorksiteAdjustmentsPanel
      programId="program-1"
      activities={ACTIVITIES}
      schedule={[]}
      visibleWorksites={WORKSITES}
      memberWorksiteIds={[]}
      appliesToAllWorksites
      exclusions={[]}
      params={[]}
      overrides={[]}
      responsibleCatalog={[]}
    />,
  )
}

beforeEach(() => {
  mockApplyRule.mockResolvedValue({ ok: true, message: "Regla aplicada en 5 de 6 faena(s)." })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("WorksiteAdjustmentsPanel — regla de dotación", () => {
  it("barre todas las faenas del programa y reporta cuántas cambiaron", async () => {
    renderPanel()

    fireEvent.click(screen.getByRole("button", { name: /Aplicar regla de dotación/ }))

    await vi.waitFor(() => expect(mockApplyRule).toHaveBeenCalledWith({ programId: "program-1" }))
    // El mensaje del servidor se muestra tal cual: "sin cambios" y "aplicada en
    // 5 de 6" son resultados distintos y el usuario tiene que poder separarlos.
    await vi.waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith("Regla aplicada en 5 de 6 faena(s)."))
    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })

  it("muestra el rechazo del servidor y no refresca", async () => {
    mockApplyRule.mockResolvedValueOnce({
      ok: false,
      message: "El programa ya entró a revisión y su contenido está bloqueado.",
    })
    renderPanel()

    fireEvent.click(screen.getByRole("button", { name: /Aplicar regla de dotación/ }))

    await vi.waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      "El programa ya entró a revisión y su contenido está bloqueado.",
    ))
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
