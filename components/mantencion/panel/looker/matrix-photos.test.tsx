// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { MatrixPhotos } from "./matrix-photos"

afterEach(cleanup)

const render_ = (links: Array<{ label: string; url: string }>) =>
  render(<MatrixPhotos photos={[]} links={links} equipment="KA-141" />)

describe("MatrixPhotos · enlaces del histórico", () => {
  it("ofrece los enlaces de Google Drive", () => {
    render_([{ label: "Filtros usados", url: "https://drive.google.com/open?id=abc" }])
    const link = screen.getByRole("link", { name: "Filtros usados" })
    expect(link.getAttribute("href")).toBe("https://drive.google.com/open?id=abc")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  })

  // Las URLs vienen de una celda del Excel importado: lo que no sea https a Drive no se pinta
  // como enlace, aunque ya esté guardado en la base.
  it("no pinta como enlace un esquema que ejecuta o incrusta contenido, ni un host ajeno", () => {
    render_([
      { label: "Filtros usados", url: "javascript:alert(document.cookie)" },
      { label: "Sticker", url: "data:text/html,<script>alert(1)</script>" },
      { label: "Otro", url: "https://evil.example/open" },
    ])
    expect(screen.queryAllByRole("link")).toHaveLength(0)
    expect(screen.getByText("Sin foto")).toBeTruthy()
  })

  it("conserva el enlace válido y descarta sólo el inseguro", () => {
    render_([
      { label: "Filtros usados", url: "javascript:alert(1)" },
      { label: "Sticker", url: "https://drive.google.com/open?id=xyz" },
    ])
    const links = screen.getAllByRole("link")
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["https://drive.google.com/open?id=xyz"])
  })
})
