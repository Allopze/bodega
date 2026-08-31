import { describe, it, expect } from "vitest"
import JSZip from "jszip"
import { validateFileBuffer, MimeType, friendlyName } from "../file-validation"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBuf(buf: number[]): Uint8Array {
  return new Uint8Array(buf)
}

async function officePackage(kind: "word" | "excel", extraEntries: string[] = []) {
  const zip = new JSZip()
  zip.file("[Content_Types].xml", "<Types />")
  zip.file("_rels/.rels", "<Relationships />")
  zip.file(kind === "word" ? "word/document.xml" : "xl/workbook.xml", "<document />")
  for (const entry of extraEntries) zip.file(entry, "unsafe")
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }))
}

// ── Magic byte signatures ────────────────────────────────────────────────────

const PDF_HEADER  = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37] // %PDF-1.7
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46] // JFIF
const PNG_HEADER  = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]
const XML_HEADER  = [0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x20, 0x76, 0x65] // <?xml ve
const XML_BOM     = [0xef, 0xbb, 0xbf, 0x3c, 0x3f, 0x78, 0x6d, 0x6c]
const HTML_MIME   = [0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50] // <!DOCTYP

// ── Tests ────────────────────────────────────────────────────────────────────

describe("validateFileBuffer", () => {
  // ── Positive: detected type matches ──────────────────────────────────────

  it("accepts a real PDF", () => {
    const buf = makeBuf(PDF_HEADER)
    const result = validateFileBuffer(buf, buf.length, MimeType.PROOF)
    expect(result.error).toBeUndefined()
    expect(result.mimeType).toBe("application/pdf")
  })

  it("accepts a real JPEG", () => {
    const buf = makeBuf(JPEG_HEADER)
    const result = validateFileBuffer(buf, buf.length, MimeType.PROOF)
    expect(result.error).toBeUndefined()
    expect(result.mimeType).toBe("image/jpeg")
  })

  it("accepts a real PNG", () => {
    const buf = makeBuf(PNG_HEADER)
    const result = validateFileBuffer(buf, buf.length, MimeType.PROOF)
    expect(result.error).toBeUndefined()
    expect(result.mimeType).toBe("image/png")
  })

  it("accepts XML with <?xml header for invoices", () => {
    const buf = makeBuf(XML_HEADER)
    const result = validateFileBuffer(buf, buf.length, MimeType.INVOICE)
    expect(result.error).toBeUndefined()
    expect(result.mimeType).toBe("application/xml")
  })

  it("accepts XML with UTF-8 BOM for invoices", () => {
    const buf = makeBuf(XML_BOM)
    const result = validateFileBuffer(buf, buf.length, MimeType.INVOICE)
    expect(result.error).toBeUndefined()
    expect(result.mimeType).toBe("application/xml")
  })

  it("accepts structurally valid DOCX and XLSX with matching extensions", async () => {
    const docx = await officePackage("word")
    const xlsx = await officePackage("excel")
    expect(validateFileBuffer(docx, docx.length, MimeType.DOCUMENT_LIBRARY, "form.docx")).toEqual({ mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    expect(validateFileBuffer(xlsx, xlsx.length, MimeType.DOCUMENT_LIBRARY, "form.xlsx")).toEqual({ mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  })

  it("rejects Office macros, unsafe ZIP paths and mislabeled extensions", async () => {
    const macro = await officePackage("word", ["word/vbaProject.bin"])
    const traversal = await officePackage("word", ["/escape.txt"])
    const xlsx = await officePackage("excel")
    expect(validateFileBuffer(macro, macro.length, MimeType.DOCUMENT_LIBRARY, "form.docx").error).toContain("macros")
    expect(validateFileBuffer(traversal, traversal.length, MimeType.DOCUMENT_LIBRARY, "form.docx").error).toContain("insegura")
    expect(validateFileBuffer(xlsx, xlsx.length, MimeType.DOCUMENT_LIBRARY, "form.docx").error).toContain("no coincide")
  })

  it("rejects malformed OOXML even when it starts as ZIP", () => {
    const malformed = makeBuf([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
    expect(validateFileBuffer(malformed, malformed.length, MimeType.DOCUMENT_LIBRARY, "form.docx").error).toContain("directorio ZIP")
  })

  // ── Rejection: wrong content type ────────────────────────────────────────

  it("rejects HTML file disguised as PDF", () => {
    const buf = makeBuf(HTML_MIME)
    const result = validateFileBuffer(buf, buf.length, MimeType.PROOF)
    expect(result.error).toContain("No se pudo identificar")
    expect(result.mimeType).toBe("")
  })

  it("rejects unknown file type for quotation upload", () => {
    const buf = makeBuf([0x52, 0x61, 0x72, 0x21]) // Rar!
    const result = validateFileBuffer(buf, buf.length, MimeType.QUOTATION)
    expect(result.error).toContain("No se pudo identificar")
    expect(result.mimeType).toBe("")
  })

  it("rejects XML for proof (not in allowed set)", () => {
    const buf = makeBuf(XML_HEADER)
    const result = validateFileBuffer(buf, buf.length, MimeType.PROOF)
    expect(result.error).toContain("Tipo de archivo no permitido")
    expect(result.mimeType).toBe("")
  })

  it("rejects PDF for quotation when file bytes are not PDF", () => {
    const buf = makeBuf(HTML_MIME)
    const result = validateFileBuffer(buf, buf.length, MimeType.QUOTATION)
    expect(result.error).toContain("No se pudo identificar")
    expect(result.mimeType).toBe("")
  })

  // ── Edge cases ───────────────────────────────────────────────────────────

  it("rejects file smaller than 4 bytes", () => {
    const buf = makeBuf([0x25, 0x50])
    const result = validateFileBuffer(buf, 2, MimeType.PROOF)
    expect(result.error).toContain("demasiado pequeño")
    expect(result.mimeType).toBe("")
  })

  it("rejects empty file", () => {
    const result = validateFileBuffer(makeBuf([]), 0, MimeType.PROOF)
    expect(result.error).toContain("vacío")
    expect(result.mimeType).toBe("")
  })

  // ── MimeType sets ────────────────────────────────────────────────────────

  it("PROOF allows pdf, jpeg, png", () => {
    expect(MimeType.PROOF.has("application/pdf")).toBe(true)
    expect(MimeType.PROOF.has("image/jpeg")).toBe(true)
    expect(MimeType.PROOF.has("image/png")).toBe(true)
    expect(MimeType.PROOF.has("application/xml")).toBe(false)
  })

  it("INVOICE allows pdf, jpeg, png, xml", () => {
    expect(MimeType.INVOICE.has("application/pdf")).toBe(true)
    expect(MimeType.INVOICE.has("image/jpeg")).toBe(true)
    expect(MimeType.INVOICE.has("image/png")).toBe(true)
    expect(MimeType.INVOICE.has("application/xml")).toBe(true)
  })

  it("QUOTATION allows pdf, jpeg, png", () => {
    expect(MimeType.QUOTATION.has("application/pdf")).toBe(true)
    expect(MimeType.QUOTATION.has("image/jpeg")).toBe(true)
    expect(MimeType.QUOTATION.has("image/png")).toBe(true)
  })

  it("friendlyName fallback matches default switch cases and handles custom MIME types", () => {
    expect(friendlyName("application/pdf")).toBe("PDF")
    expect(friendlyName("image/jpeg")).toBe("JPG")
    expect(friendlyName("image/png")).toBe("PNG")
    expect(friendlyName("application/xml")).toBe("XML")
    expect(friendlyName("text/plain")).toBe("text/plain")
  })
})
