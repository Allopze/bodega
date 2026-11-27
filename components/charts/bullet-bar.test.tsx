// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { BulletBar } from "./bullet-bar"

afterEach(cleanup)

describe("BulletBar · variante compacta de lista", () => {
  it("sin leyenda de marcas, con la nota en gris y la razón de un «—» en su title", () => {
    render(
      <BulletBar
        compact
        label="RBYD98"
        value={6_856}
        max={10_000}
        valueText="Faltan 3.144 km"
        tone="warning"
        markers={[{ value: 8_500, label: "85 % del intervalo" }]}
        note="—"
        noteTitle="El equipo no registra uso"
      />,
    )
    expect(screen.queryByText("85 % del intervalo")).toBeNull()
    expect(screen.getByText("—").getAttribute("title")).toBe("El equipo no registra uso")
    const meter = screen.getByRole("meter", { name: "RBYD98" })
    expect(meter.getAttribute("aria-valuetext")).toBe("Faltan 3.144 km. —")
    expect(screen.getByText("Faltan 3.144 km").className).toContain("text-[var(--color-warning-ink)]")
  })

  it("una barra vencida se llena entera sin pasarse del máximo", () => {
    render(<BulletBar compact label="KA-1" value={21_801} max={10_000} valueText="Vencida por 11.801 km" tone="danger" />)
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("10000")
  })

  it("la variante normal conserva la leyenda de marcas", () => {
    render(<BulletBar label="Estanque" value={1} max={2} valueText="1 L" markers={[{ value: 1, label: "Reposición" }]} />)
    expect(screen.getByText("Reposición")).toBeTruthy()
  })
})
