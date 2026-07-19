// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("../actions", () => ({
  addPpaEvidenceAction: vi.fn(), authorizePpaRestartAction: vi.fn(), cancelPpaAction: vi.fn(),
  closePpaAction: vi.fn(), declarePpaCorrectionAction: vi.fn(), verifyPpaCorrectionAction: vi.fn(),
}))

import { PpaWorkflowPanel } from "./ppa-workflow-panel"

describe("PpaWorkflowPanel permission visibility", () => {
  it("renders no transition control when the user lacks dedicated permissions", () => {
    const { container } = render(<PpaWorkflowPanel
      ppaId="p1" ppaVersion={2} status="en_correccion" verified={false}
      capa={{ id: "c1", version: 2, status: "in_progress", evidenceCount: 1 }}
      canCorrect={false} canVerify={false} canAuthorize={false} canCancel={false} canClose={false}
    />)
    expect(container).toBeEmptyDOMElement()
  })

  it("does not expose restart authorization before verification", () => {
    render(<PpaWorkflowPanel
      ppaId="p1" ppaVersion={2} status="pendiente_verificacion" verified={false}
      capa={{ id: "c1", version: 3, status: "pending_verification", evidenceCount: 1 }}
      canCorrect={false} canVerify={true} canAuthorize={true} canCancel={false} canClose={false}
    />)
    expect(screen.queryByText("Autorizar reinicio de la tarea")).not.toBeInTheDocument()
    expect(screen.getByText("Verificar controles")).toBeInTheDocument()
  })
})
