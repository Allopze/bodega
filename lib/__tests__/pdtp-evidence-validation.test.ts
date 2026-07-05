import { describe, expect, it } from "vitest"
import { pdtpExecutionSchema } from "@/lib/validation/prevention-module/pdtp"

describe("pdtpExecutionSchema — evidence URL validation", () => {
  const base = {
    activityId: "act-1",
    worksiteId: "ws-1",
    year: 2026,
    month: 1,
    week: 1,
    executedQuantity: 1,
  }

  it("acepta evidenceUrl con prefijo storage/pdtp-evidence/ y extensión válida", () => {
    const r = pdtpExecutionSchema.parse({ ...base, evidenceUrl: "storage/pdtp-evidence/abc123.pdf" })
    expect(r.evidenceUrl).toBe("storage/pdtp-evidence/abc123.pdf")
  })

  it("acepta evidenceUrl con extensiones .jpg, .jpeg, .png", () => {
    expect(pdtpExecutionSchema.parse({ ...base, evidenceUrl: "storage/pdtp-evidence/a.jpg" }).evidenceUrl).toMatch(/jpg$/)
    expect(pdtpExecutionSchema.parse({ ...base, evidenceUrl: "storage/pdtp-evidence/a.jpeg" }).evidenceUrl).toMatch(/jpeg$/)
    expect(pdtpExecutionSchema.parse({ ...base, evidenceUrl: "storage/pdtp-evidence/a.png" }).evidenceUrl).toMatch(/png$/)
  })

  it("acepta string vacío (sin archivo)", () => {
    const r = pdtpExecutionSchema.parse({ ...base, evidenceUrl: "" })
    expect(r.evidenceUrl).toBe("")
  })

  it("rechaza evidenceUrl que intenta path traversal", () => {
    expect(() => pdtpExecutionSchema.parse({ ...base, evidenceUrl: "../../etc/passwd" })).toThrow()
    expect(() => pdtpExecutionSchema.parse({ ...base, evidenceUrl: "storage/pdtp-evidence/../../../etc/passwd" })).toThrow()
  })

  it("rechaza evidenceUrl con protocolo http(s)://", () => {
    expect(() => pdtpExecutionSchema.parse({ ...base, evidenceUrl: "https://evil.com/x.pdf" })).toThrow()
    expect(() => pdtpExecutionSchema.parse({ ...base, evidenceUrl: "http://attacker.test/payload" })).toThrow()
  })

  it("rechaza evidenceUrl con prefijo storage incorrecto", () => {
    expect(() => pdtpExecutionSchema.parse({ ...base, evidenceUrl: "storage/sst-documents/abc.pdf" })).toThrow()
    expect(() => pdtpExecutionSchema.parse({ ...base, evidenceUrl: "storage/deliveries/abc.pdf" })).toThrow()
  })

  it("rechaza evidenceUrl con extensión no permitida", () => {
    expect(() => pdtpExecutionSchema.parse({ ...base, evidenceUrl: "storage/pdtp-evidence/script.exe" })).toThrow()
    expect(() => pdtpExecutionSchema.parse({ ...base, evidenceUrl: "storage/pdtp-evidence/doc.txt" })).toThrow()
    expect(() => pdtpExecutionSchema.parse({ ...base, evidenceUrl: "storage/pdtp-evidence/script.sh" })).toThrow()
  })

  it("rechaza evidencePhotos con items inválidos", () => {
    expect(() => pdtpExecutionSchema.parse({
      ...base,
      evidencePhotos: ["storage/pdtp-evidence/ok.jpg", "../../bad.exe"],
    })).toThrow()
  })

  it("acepta evidencePhotos vacíos", () => {
    const r = pdtpExecutionSchema.parse({ ...base, evidencePhotos: [] })
    expect(r.evidencePhotos).toEqual([])
  })
})
