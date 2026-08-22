// @vitest-environment jsdom

import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DegradedDataBanner } from "./degraded-data-banner"

describe("DegradedDataBanner", () => {
  it("no renderiza nada cuando no hay fuentes degradadas", () => {
    const { container } = render(<DegradedDataBanner degraded={[]} total={5} />)
    expect(container.firstChild).toBeNull()
  })

  it("muestra cuántas fuentes fallaron sobre el total cuando hay degradación", () => {
    const { getByRole } = render(<DegradedDataBanner degraded={["byEquipmentType", "scatterPoints"]} total={5} />)
    const alert = getByRole("alert")
    expect(alert.textContent).toContain("2 de 5 fuentes")
  })
})
