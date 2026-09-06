// @vitest-environment jsdom

import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DetailItem } from "./detail-item"

describe("DetailItem", () => {
  it("layout inline: etiqueta a la izquierda, valor a la derecha", () => {
    const { getByText } = render(<DetailItem label="Proveedor" value="Acme SpA" />)
    expect(getByText("Proveedor").tagName).toBe("DT")
    expect(getByText("Acme SpA").tagName).toBe("DD")
  })

  it("layout stacked: etiqueta text-eyebrow arriba, valor debajo", () => {
    const { getByText } = render(<DetailItem layout="stacked" label="Faena" value="Mininco" />)
    expect(getByText("Faena").className).toContain("text-eyebrow")
    expect(getByText("Mininco").tagName).toBe("DD")
  })

  it("mono aplica font-mono tabular-nums al valor", () => {
    const { getByText } = render(<DetailItem label="Total" value="$1.000" mono />)
    expect(getByText("$1.000").className).toContain("font-mono")
    expect(getByText("$1.000").className).toContain("tabular-nums")
  })

  it("muted atenua el valor", () => {
    const { getByText } = render(<DetailItem label="IVA" value="$190" muted />)
    expect(getByText("$190").className).toContain("text-[var(--color-text-subtle)]")
  })

  it("valor ausente (null/undefined) se dice con —, no con $0 ni vacío", () => {
    const { getByText } = render(
      <>
        <DetailItem label="A" value={null} />
        <DetailItem label="B" value={undefined} />
      </>,
    )
    expect(getByText("A").nextElementSibling?.textContent).toBe("—")
    expect(getByText("B").nextElementSibling?.textContent).toBe("—")
  })

  it("value=\"\" se respeta (vacío explícito, no el marcador de valor ausente)", () => {
    const { getByText } = render(<DetailItem label="C" value="" />)
    expect(getByText("C").nextElementSibling?.textContent).toBe("")
  })

  it("className cae en el contenedor (separadores del caller)", () => {
    const { getByText } = render(
      <DetailItem label="D" value="x" className="border-b border-[var(--color-border)]" />,
    )
    expect(getByText("D").parentElement?.className).toContain("border-b")
  })
})
