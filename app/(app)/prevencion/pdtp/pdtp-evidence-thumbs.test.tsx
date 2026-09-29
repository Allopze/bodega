// @vitest-environment jsdom

/**
 * PREV-I05: la miniatura armaba un enlace PDTP para cualquier ruta y la
 * evidencia de integración respondía 404. D12: la de otro módulo se muestra
 * como un chip sin enlace, "En el módulo de origen".
 */
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PdtpEvidenceThumbs } from "./pdtp-evidence-thumbs"

afterEach(() => cleanup())

describe("PdtpEvidenceThumbs", () => {
  it("un archivo PDTP enlaza a la descarga PDTP", () => {
    render(<PdtpEvidenceThumbs evidenceUrl="storage/pdtp-evidence/abc.pdf" evidencePhotos={[]} evidenceText={null} />)
    expect(screen.getByRole("link", { name: /PDF/ }).getAttribute("href")).toBe("/api/prevencion/pdtp/evidence/abc.pdf")
  })

  it("la evidencia de otro módulo no enlaza a la ruta PDTP: muestra el chip del módulo de origen", () => {
    render(
      <PdtpEvidenceThumbs
        evidenceUrl="storage/prevention-training-evidence/acta.pdf"
        evidencePhotos={[]}
        evidenceText={null}
      />,
    )
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText("En el módulo de origen")).toBeTruthy()
  })

  it("un enlace externo se abre tal cual, en otra pestaña", () => {
    render(<PdtpEvidenceThumbs evidenceUrl="https://drive.example.com/acta" evidencePhotos={[]} evidenceText={null} />)
    const link = screen.getByRole("link", { name: /Enlace/ })
    expect(link.getAttribute("href")).toBe("https://drive.example.com/acta")
    expect(link.getAttribute("rel")).toContain("noopener")
  })

  it("las fotos PDTP y las de otro módulo conviven, cada una con su destino", () => {
    render(
      <PdtpEvidenceThumbs
        evidenceUrl={null}
        evidencePhotos={["storage/pdtp-evidence/f1.jpg", "storage/prevention-drill-evidence/f2.jpg"]}
        evidenceText={null}
      />,
    )
    expect(screen.getAllByRole("link")).toHaveLength(1)
    expect(screen.getByText("En el módulo de origen")).toBeTruthy()
  })

  it("un rótulo de integración se ve como automático y sin el id interno (C-03/C-04)", () => {
    render(<PdtpEvidenceThumbs evidenceUrl="Entrega EPP: bYpyCTc20gK9xQ1" evidencePhotos={[]} evidenceText="Acta cerrada: a1B2c3D4e5F6g7" origin="integration" />)
    expect(screen.getByText("Entrega EPP")).toBeTruthy()
    expect(screen.getByText("Acta cerrada")).toBeTruthy()
    expect(screen.getAllByText("Automático:")).toHaveLength(2)
    expect(screen.queryByText(/bYpyCTc20g/)).toBeNull()
  })

  it("la observación de una persona se sigue mostrando como cita", () => {
    render(<PdtpEvidenceThumbs evidenceUrl={null} evidencePhotos={[]} evidenceText="Se hizo en el comedor" origin="manual" />)
    expect(screen.getByText("“Se hizo en el comedor”")).toBeTruthy()
    expect(screen.queryByText("Automático:")).toBeNull()
  })
})
