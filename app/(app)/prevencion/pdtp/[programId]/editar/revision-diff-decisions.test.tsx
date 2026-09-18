// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock("../../actions", () => ({ decidePdtpRevisionDiffAction: vi.fn() }))

import { RevisionDiffDecisions } from "./revision-diff-decisions"

const item = {
  identity: "catalog:PDT-001",
  activityNumber: 1,
  kind: "content_changed" as const,
}

describe("RevisionDiffDecisions", () => {
  it("muestra una decisión aplicada y desactiva repetirla", () => {
    render(
      <RevisionDiffDecisions
        programId="pdtp-v2"
        items={[item]}
        decisions={[{ activityIdentity: item.identity, decision: "applied", decidedAt: "2026-09-17T00:00:00.000Z" }]}
      />,
    )

    expect(screen.getByText("Aplicada desde la Base")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Aplicar Base" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Conservar" })).toBeDisabled()
  })

  it("mantiene visible y bloqueada la decisión conservada", () => {
    render(
      <RevisionDiffDecisions
        programId="pdtp-v2"
        items={[item]}
        decisions={[{ activityIdentity: item.identity, decision: "kept", decidedAt: "2026-09-17T00:00:00.000Z" }]}
      />,
    )

    expect(screen.getByText("Conservada")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Conservar" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Aplicar Base" })).toBeDisabled()
  })
})
