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
        worksiteCount={1}
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
    expect(screen.getByText(/gestión 88%/)).toBeDefined()
    expect(screen.queryByText(/integral 88%/)).toBeNull()
    expect(container.querySelector('[style="width: 92%;"]')).toBeTruthy()
  })

  // I-04 (auditoría 2026-08-05): sin faena única la tarjeta muestra el agregado
  // global —mismo motor que la sección Prevención— en vez de pedir elegir faena.
  it("presents the aggregate compliance number for a multi-worksite scope", () => {
    const { container } = render(
      <PdtpComplianceCard
        year={2026}
        worksiteCount={3}
        pendingCount={4}
        target={0.9}
        percent={0.5}
        integralPercent={null}
        planned={120}
        executed={60}
        expectedPercent={0.58}
        variancePercent={-8}
        lastExecutionUpdatedAt={null}
        month={7}
        week={2}
      />,
    )

    expect(screen.getByText("50%")).toBeDefined()
    expect(screen.getByText(/Global · 3 faenas/)).toBeDefined()
    expect(container.querySelector('[style="width: 50%;"]')).toBeTruthy()
  })
})
