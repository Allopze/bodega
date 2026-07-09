/**
 * Unit tests for email-templates service.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockFindFirst = vi.hoisted(() => vi.fn())
const mockFindMany = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: {
    query: {
      emailTemplates: {
        findFirst: mockFindFirst,
        findMany: mockFindMany,
      },
    },
    insert: mockInsert,
  },
}))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/id", () => ({ nanoid: vi.fn(() => "test-nanoid-123") }))

import {
  getTemplate,
  getAllTemplates,
  renderTemplate,
  updateTemplate,
  resetTemplate,
  seedDefaultTemplates,
  TEMPLATE_KEYS,
} from "@/lib/services/email-templates"

function setupInsertMock() {
  const setChain = vi.fn().mockResolvedValue(undefined)
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({ set: setChain }),
    }),
  })
}

describe("getTemplate", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns template when found", async () => {
    const row = { id: "1", key: "invitation", name: "Invitación", subject: "Hi", bodyHtml: "<p>Hi</p>", isDefault: true, updatedAt: "2026-01-01" }
    mockFindFirst.mockResolvedValue(row)
    const result = await getTemplate("invitation")
    expect(result).toEqual(row)
  })

  it("returns null when not found", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await getTemplate("nonexistent")
    expect(result).toBeNull()
  })
})

describe("getAllTemplates", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns all templates", async () => {
    mockFindMany.mockResolvedValue([{ key: "invitation" }, { key: "notification" }])
    const result = await getAllTemplates()
    expect(result).toHaveLength(2)
  })
})

describe("renderTemplate", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders variables from DB template", async () => {
    mockFindFirst.mockResolvedValue({
      id: "1", key: "notification", subject: "{{title}}", bodyHtml: "<p>{{user_name}}</p>", isDefault: true, updatedAt: "now",
    })
    const result = await renderTemplate("notification", { title: "Hola", user_name: "Juan" })
    expect(result.subject).toBe("Hola")
    expect(result.html).toContain("Juan")
  })

  it("falls back to hardcoded default if no DB template", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await renderTemplate("notification", { title: "Test Title", user_name: "Pedro" })
    expect(result.subject).toBe("Test Title")
    expect(result.html).toContain("Pedro")
  })

  it("renders conditional blocks when variable present", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await renderTemplate("notification", {
      title: "Test",
      user_name: "X",
      body: "Detalles aquí",
      href: "https://example.com",
      app_name: "Chome",
    })
    expect(result.html).toContain("Detalles aquí")
    expect(result.html).toContain("https://example.com")
  })

  it("removes conditional blocks when variable absent", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await renderTemplate("notification", { title: "Test", user_name: "X" })
    expect(result.html).not.toContain("Ver detalle")
  })

  it("renders inverted blocks ({{^var}}) when variable is absent", async () => {
    mockFindFirst.mockResolvedValue({
      id: "1", key: "invitation", subject: "Test", bodyHtml: "{{^sender_name}}<p>Fallback</p>{{/sender_name}}", isDefault: true, updatedAt: "now",
    })
    const result = await renderTemplate("invitation", { sender_name: "", app_name: "Chome" })
    expect(result.html).toContain("Fallback")
  })

  it("hides inverted blocks ({{^var}}) when variable is present", async () => {
    mockFindFirst.mockResolvedValue({
      id: "1", key: "invitation", subject: "Test", bodyHtml: "{{^sender_name}}<p>Fallback</p>{{/sender_name}}", isDefault: true, updatedAt: "now",
    })
    const result = await renderTemplate("invitation", { sender_name: "María", app_name: "Chome" })
    expect(result.html).not.toContain("Fallback")
  })

  it("escapes HTML in variable values", async () => {
    mockFindFirst.mockResolvedValue({
      id: "1", key: "test", subject: "{{name}}", bodyHtml: "{{name}}", isDefault: false, updatedAt: "now",
    })
    const result = await renderTemplate("test", { name: '<script>alert("xss")</script>' })
    expect(result.subject).toContain("&lt;script&gt;")
    expect(result.html).toContain("&lt;script&gt;")
  })

  it("throws for unknown template key", async () => {
    mockFindFirst.mockResolvedValue(null)
    await expect(renderTemplate("unknown_key_xyz", {})).rejects.toThrow("No template found")
  })

  it("replaces unknown variables with placeholder", async () => {
    mockFindFirst.mockResolvedValue({
      id: "1", key: "test", subject: "{{unknown}}", bodyHtml: "", isDefault: false, updatedAt: "now",
    })
    const result = await renderTemplate("test", {})
    expect(result.subject).toBe("{{unknown}}")
  })
})

describe("updateTemplate", () => {
  beforeEach(() => { vi.clearAllMocks(); setupInsertMock() })

  it("inserts or updates a template", async () => {
    mockFindFirst.mockResolvedValue({ id: "existing-1", subject: "Old", bodyHtml: "<p>Old</p>" })
    await updateTemplate("invitation", { subject: "New", bodyHtml: "<p>New</p>" }, "user-1", "test@test.cl")
    expect(mockInsert).toHaveBeenCalled()
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      oldState: { subject: "Old", bodyHtml: "<p>Old</p>" },
      newState: { subject: "New", bodyHtml: "<p>New</p>" },
    }))
  })

  it("works when template does not exist yet", async () => {
    mockFindFirst.mockResolvedValue(null)
    await updateTemplate("invitation", { subject: "New", bodyHtml: "<p>New</p>" }, "user-1")
    expect(mockInsert).toHaveBeenCalled()
  })
})

describe("resetTemplate", () => {
  beforeEach(() => { vi.clearAllMocks(); setupInsertMock() })

  it("resets to default template", async () => {
    mockFindFirst.mockResolvedValue({ id: "existing-1", subject: "Custom", bodyHtml: "<p>Custom</p>" })
    await resetTemplate("invitation", "user-1", "test@test.cl")
    expect(mockInsert).toHaveBeenCalled()
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      oldState: { subject: "Custom", bodyHtml: "<p>Custom</p>" },
      newState: expect.objectContaining({ bodyHtml: expect.any(String), isDefault: true }),
    }))
  })

  it("throws for unknown key", async () => {
    await expect(resetTemplate("unknown_key_xyz", "user-1")).rejects.toThrow("No default template")
  })
})

describe("seedDefaultTemplates", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("only inserts templates that don't exist", async () => {
    mockFindMany.mockResolvedValue([{ key: "invitation" }]) // notification is missing
    const valuesChain = vi.fn().mockResolvedValue(undefined)
    mockInsert.mockReturnValue({ values: valuesChain })

    await seedDefaultTemplates()
    expect(mockInsert).toHaveBeenCalledTimes(1) // only notification
  })

  it("skips all if all exist", async () => {
    mockFindMany.mockResolvedValue([{ key: "invitation" }, { key: "notification" }])
    await seedDefaultTemplates()
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

describe("TEMPLATE_KEYS", () => {
  it("exports expected keys", () => {
    expect(TEMPLATE_KEYS).toContain("invitation")
    expect(TEMPLATE_KEYS).toContain("notification")
  })
})

// ── Integration: render default templates with real data ──────────────────────

describe("default templates — invitation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders full HTML email with sender name", async () => {
    mockFindFirst.mockResolvedValue(null) // use hardcoded defaults
    const result = await renderTemplate("invitation", {
      sender_name: "María González",
      app_name:    "Plataforma Chome",
      invite_url:  "https://app.chome.cl/registro?token=abc123",
    })

    // Structure
    expect(result.html).toContain("<!DOCTYPE html>")
    expect(result.html).toContain('<html lang="es">')
    expect(result.html).toContain('role="presentation"')

    // Content
    expect(result.subject).toBe("Invitación a Plataforma Chome")
    expect(result.html).toContain("María González")
    expect(result.html).toContain("Plataforma Chome")
    expect(result.html).toContain("https://app.chome.cl/registro?token=abc123")
    expect(result.html).toContain("Aceptar invitación")
    expect(result.html).toContain("te ha invitado a")
    expect(result.html).not.toContain("Has sido invitado a")
  })

  it("renders fallback greeting when no sender name", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await renderTemplate("invitation", {
      sender_name: "",
      app_name:    "Chome",
      invite_url:  "https://app.chome.cl/invitar/xyz",
    })

    // Should show the generic greeting, not the personal one
    expect(result.html).toContain("Has sido invitado a")
    expect(result.html).not.toContain("te ha invitado a")
  })

  it("escapes XSS in sender_name", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await renderTemplate("invitation", {
      sender_name: '<script>alert("xss")</script>',
      app_name:    "Chome",
      invite_url:  "https://app.chome.cl/r",
    })

    expect(result.html).not.toContain("<script>")
    expect(result.html).toContain("&lt;script&gt;")
  })

  it("contains no unescaped angle brackets from variables", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await renderTemplate("invitation", {
      sender_name: "Test <User>",
      app_name:    "App & Co.",
      invite_url:  "https://example.cl",
    })

    // The only angle brackets should be from the HTML template itself, not from variable values
    // Variable values should be escaped
    expect(result.html).toContain("&lt;User&gt;")
    expect(result.html).toContain("App &amp; Co.")
  })
})

describe("default templates — notification", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders full HTML email with all variables", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await renderTemplate("notification", {
      user_name: "Juan Pérez",
      title:     "Solicitud aprobada",
      body:      "Tu solicitud de compra #042 ha sido aprobada por el jefe de mantención.",
      href:      "https://app.chome.cl/solicitudes/042",
      app_name:  "Plataforma Chome",
    })

    // Structure
    expect(result.html).toContain("<!DOCTYPE html>")
    expect(result.html).toContain('<html lang="es">')
    expect(result.html).toContain('role="presentation"')

    // Content
    expect(result.subject).toBe("Solicitud aprobada")
    expect(result.html).toContain("Juan Pérez")
    expect(result.html).toContain("Solicitud aprobada")
    expect(result.html).toContain("ha sido aprobada por el jefe de mantención")
    expect(result.html).toContain("https://app.chome.cl/solicitudes/042")
    expect(result.html).toContain("Ver detalle")
  })

  it("hides body and CTA when optional vars absent", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await renderTemplate("notification", {
      user_name: "Ana",
      title:     "Aviso",
      app_name:  "Chome",
    })

    expect(result.subject).toBe("Aviso")
    expect(result.html).toContain("Ana")
    expect(result.html).toContain("Aviso")
    expect(result.html).not.toContain("Ver detalle")
  })

  it("escapes XSS in title and body", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await renderTemplate("notification", {
      user_name: "Test",
      title:     '<img src=x onerror=alert(1)>',
      body:      '<script>document.cookie</script>',
      app_name:  "Chome",
    })

    expect(result.html).not.toContain("<img src=x onerror=")
    expect(result.html).not.toContain("<script>")
    expect(result.html).toContain("&lt;img")
    expect(result.html).toContain("&lt;script&gt;")
  })

  it("subject variables are escaped by the template engine", async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await renderTemplate("notification", {
      user_name: "X",
      title:     "Oferta & Descuento",
      app_name:  "Chome",
    })

    expect(result.subject).toBe("Oferta &amp; Descuento")
  })
})
