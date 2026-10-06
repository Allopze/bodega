// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PdtpComplianceCard } from "./pdtp-compliance-card"

describe("PdtpComplianceCard", () => {
  // PREV-C05-C (T6): tras una revisión a mitad de año el anual suma todas las
  // versiones, y la tarjeta lo dice.
  it("rotula el anual consolidado cuando el año tiene más de una versión", () => {
    render(
      <PdtpComplianceCard
        year={2026}
        worksiteCount={2}
        pendingCount={0}
        target={0.9}
        percent={0.8}
        integralPercent={null}
        planned={10}
        executed={8}
        expectedPercent={0.7}
        variancePercent={10}
        lastExecutionUpdatedAt={null}
        month={10}
        week={2}
        versionLabels={["v1", "v2"]}
      />,
    )
    expect(screen.getByText(/Incluye las versiones v1 y v2 del programa/)).toBeDefined()
    // A6: la sigla "pp" lleva su nombre completo.
    expect(screen.getByText("pp").getAttribute("title")).toMatch(/puntos porcentuales/)
  })

  it("no rotula versiones con una sola", () => {
    render(
      <PdtpComplianceCard
        year={2026}
        worksiteCount={2}
        pendingCount={0}
        target={0.9}
        percent={0.8}
        integralPercent={null}
        planned={10}
        executed={8}
        expectedPercent={0.7}
        variancePercent={10}
        lastExecutionUpdatedAt={null}
        month={10}
        week={2}
        versionLabels={["v1"]}
      />,
    )
    expect(screen.queryByText(/Incluye las versiones/)).toBeNull()
  })

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

  // PREV-C03.7 (D23): el 1 de enero el resultado del año anterior no desaparece.
  it("muestra una línea de cierre pendiente con enlace al año que se está cerrando", () => {
    render(
      <PdtpComplianceCard
        year={2027}
        closingYear={2026}
        worksiteCount={3}
        pendingCount={0}
        target={0.9}
        percent={0.1}
        integralPercent={null}
        planned={100}
        executed={10}
        expectedPercent={0.08}
        variancePercent={2}
        lastExecutionUpdatedAt={null}
        month={1}
        week={2}
      />,
    )
    expect(screen.getByText("PDTP 2027")).toBeDefined()
    const link = screen.getByRole("link", { name: /PDTP 2026 · cierre pendiente/ })
    expect(link.getAttribute("href")).toBe("/prevencion/pdtp?anio=2026")
  })

  it("sin año en cierre no agrega la línea", () => {
    render(
      <PdtpComplianceCard
        year={2026}
        worksiteCount={1}
        worksiteId="ws-1"
        pendingCount={0}
        target={0.9}
        percent={0.5}
        integralPercent={null}
        planned={10}
        executed={5}
        expectedPercent={0.5}
        variancePercent={0}
        lastExecutionUpdatedAt={null}
        month={7}
        week={2}
      />,
    )
    expect(screen.queryByText(/cierre pendiente/)).toBeNull()
  })
})
