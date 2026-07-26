// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PdtpComplianceCard } from "./pdtp-compliance-card"

describe("PdtpComplianceCard", () => {
  it("formats fractional compliance as a human percentage", () => {
    const { container } = render(
      <PdtpComplianceCard
        year={2026}
        worksiteId="ws-1"
        pendingCount={0}
        target={0.9}
        percent={0.92}
        integralPercent={88}
        planned={100}
        executed={92}
        expectedPercent={0.75}
        variancePercent={17}
        lastExecutionUpdatedAt="2026-07-25T12:00:00.000Z"
        month={7}
        week={2}
      />,
    )

    expect(screen.getByText("92%")).toBeDefined()
    expect(screen.getByText(/meta 90%/)).toBeDefined()
    expect(container.querySelector('[style="width: 92%;"]')).toBeTruthy()
  })

  it("does not present an aggregate compliance number without a selected worksite", () => {
    const { container } = render(
      <PdtpComplianceCard
        year={2026}
        requiresWorksiteSelection
        pendingCount={4}
        target={0.9}
        percent={null}
        integralPercent={null}
        planned={0}
        executed={0}
        expectedPercent={null}
        variancePercent={null}
        lastExecutionUpdatedAt={null}
        month={7}
        week={2}
      />,
    )

    expect(screen.getByText("Abrir PDTP y elegir faena →")).toBeDefined()
    expect(container.querySelector('[style="width: 0%;"]')).toBeTruthy()
  })
})
