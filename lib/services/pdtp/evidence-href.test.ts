/**
 * PREV-I05 (auditoría 2026-09-26): cada evidencia se enlaza según de dónde
 * viene. La miniatura armaba `/api/prevencion/pdtp/evidence/<basename>` para
 * cualquier ruta, así que la evidencia de capacitación, alcotest o simulacros
 * —que vive en el directorio de su módulo— respondía 404. D12: esa evidencia se
 * abre en el módulo de origen y aquí se muestra como un chip sin enlace.
 */
import { describe, expect, it } from "vitest"
import { pdtpEvidenceHref, pdtpSyntheticEvidenceLabel } from "./evidence-href"

describe("pdtpEvidenceHref", () => {
  it("una ruta del directorio PDTP se descarga por la ruta PDTP", () => {
    expect(pdtpEvidenceHref("storage/pdtp-evidence/abc123.pdf")).toEqual({
      kind: "pdtp",
      name: "abc123.pdf",
      href: "/api/prevencion/pdtp/evidence/abc123.pdf",
    })
  })

  it("la evidencia de otro módulo no arma un enlace PDTP que daría 404 (D12)", () => {
    expect(pdtpEvidenceHref("storage/prevention-training-evidence/xyz.pdf")).toEqual({
      kind: "source_module",
      path: "storage/prevention-training-evidence/xyz.pdf",
    })
    expect(pdtpEvidenceHref("storage/prevention-alcotest-evidence/a.jpg")?.kind).toBe("source_module")
    expect(pdtpEvidenceHref("storage/prevention-drill-evidence/b.png")?.kind).toBe("source_module")
  })

  it("la evidencia de un módulo con descarga propia se enlaza a esa ruta (PRV-21)", () => {
    expect(pdtpEvidenceHref("storage/hygiene-evidence/lab_01.pdf")).toEqual({
      kind: "module_file",
      name: "lab_01.pdf",
      href: "/api/prevencion/higiene/evidence/lab_01.pdf",
    })
    expect(pdtpEvidenceHref("storage/cgrd-evidence/acta.pdf")?.kind).toBe("module_file")
    expect(pdtpEvidenceHref("storage/campaign-evidence/foto.jpg")?.kind).toBe("module_file")
    // Un nombre con traversal no se vuelve enlace.
    expect(pdtpEvidenceHref("storage/hygiene-evidence/../x.pdf")?.kind).toBe("source_module")
  })

  it("una URL http(s) se abre tal cual", () => {
    expect(pdtpEvidenceHref("https://drive.example.com/acta")).toEqual({
      kind: "external",
      href: "https://drive.example.com/acta",
    })
  })

  it("un esquema que no es http(s) nunca se vuelve enlace", () => {
    expect(pdtpEvidenceHref("javascript:alert(1)")).toEqual({ kind: "note", text: "javascript:alert(1)" })
  })

  it("un rótulo o texto libre es una nota, no un archivo", () => {
    expect(pdtpEvidenceHref("Sesión de capacitación cerrada: s-1")).toEqual({
      kind: "note",
      text: "Sesión de capacitación cerrada: s-1",
    })
  })

  it("una ruta PDTP con subdirectorios o traversal no se enlaza", () => {
    expect(pdtpEvidenceHref("storage/pdtp-evidence/../secreto.pdf")?.kind).toBe("note")
    expect(pdtpEvidenceHref("storage/pdtp-evidence/sub/a.pdf")?.kind).toBe("note")
    expect(pdtpEvidenceHref("storage/pdtp-evidence/")?.kind).toBe("note")
  })

  it("vacío o nulo no produce nada", () => {
    expect(pdtpEvidenceHref(null)).toBeNull()
    expect(pdtpEvidenceHref(undefined)).toBeNull()
    expect(pdtpEvidenceHref("   ")).toBeNull()
  })
})

describe("pdtpSyntheticEvidenceLabel (C-03)", () => {
  it("quita el id interno del final", () => {
    expect(pdtpSyntheticEvidenceLabel("Entrega EPP: bYpyCTc20gK9xQ1")).toBe("Entrega EPP")
  })
  it("no toca un texto sin id ni una palabra larga sin dígitos", () => {
    expect(pdtpSyntheticEvidenceLabel("Acta firmada: conforme")).toBe("Acta firmada: conforme")
    expect(pdtpSyntheticEvidenceLabel("Motivo: responsabilidades")).toBe("Motivo: responsabilidades")
  })
})
