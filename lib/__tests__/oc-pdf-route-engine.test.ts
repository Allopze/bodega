/**
 * Despacho de motor en la ruta del PDF de la OC. Los dos motores están
 * mockeados: lo que se prueba es cuál se elige y con qué respuesta, no el PDF.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const mockAuth = vi.hoisted(() => vi.fn())
const mockFindFirst = vi.hoisted(() => vi.fn())
const mockWithBrowserContext = vi.hoisted(() => vi.fn())
const mockRenderOcPdf = vi.hoisted(() => vi.fn())
const mockLoadOrNull = vi.hoisted(() => vi.fn())
const mockGetPdfEngineFor = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/db", () => ({
  db: { query: { purchaseOrders: { findFirst: mockFindFirst } } },
}))
vi.mock("@/lib/pdf/browser-pool", () => ({ withBrowserContext: mockWithBrowserContext }))
vi.mock("@/app/(print)/compras/[id]/print/oc-pdfcn-render", () => ({ renderOcPdf: mockRenderOcPdf }))
vi.mock("@/app/(print)/compras/[id]/print/oc-print-data", () => ({
  loadOcPrintDataOrNull: mockLoadOrNull,
}))
vi.mock("@/lib/services/system-settings", () => ({ getPdfEngineFor: mockGetPdfEngineFor }))

import { GET } from "@/app/(print)/compras/[id]/print/pdf/route"

const CHROMIUM_PDF = Buffer.from("%PDF-chromium")
const PDFCN_PDF = new Uint8Array(Buffer.from("%PDF-pdfcn"))

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u-1",
      name: "Admin",
      email: "admin@chome.cl",
      roles: [],
      permissions: ["purchasing:view"],
      worksiteIds: ["w-1"],
      primaryWorksiteId: "w-1",
      avatarColor: null,
      isActive: true,
      isGlobal: false,
      ...overrides,
    },
  } as unknown as Session
}

function makeReq(query = "") {
  return new Request(`http://localhost/compras/oc-1/print/pdf${query}`)
}

const params = { params: Promise.resolve({ id: "oc-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(makeSession())
  mockGetPdfEngineFor.mockResolvedValue("chromium")
  mockFindFirst.mockResolvedValue({ id: "oc-1", code: "OC-2026-0001", worksiteId: "w-1" })
  mockWithBrowserContext.mockResolvedValue(CHROMIUM_PDF)
  mockRenderOcPdf.mockResolvedValue(PDFCN_PDF)
  mockLoadOrNull.mockResolvedValue({
    order: { id: "oc-1", code: "OC-2026-0001" },
    suggestedFilename: "OC 2026-0001.pdf",
  })
})

describe("elección de motor", () => {
  it("con el ajuste por defecto usa Chromium", async () => {
    const res = await GET(makeReq(), params)

    expect(res.status).toBe(200)
    expect(mockWithBrowserContext).toHaveBeenCalledTimes(1)
    expect(mockRenderOcPdf).not.toHaveBeenCalled()
  })

  it("con el ajuste en pdfcn usa Takumi y no abre el navegador", async () => {
    mockGetPdfEngineFor.mockResolvedValue("pdfcn")

    const res = await GET(makeReq(), params)

    expect(res.status).toBe(200)
    expect(mockRenderOcPdf).toHaveBeenCalledTimes(1)
    expect(mockWithBrowserContext).not.toHaveBeenCalled()
  })
})

describe("override ?motor=", () => {
  const admin = () => makeSession({ permissions: ["purchasing:view", "admin:ops_settings"] })

  it("un administrador puede forzar pdfcn sobre un ajuste en chromium", async () => {
    mockAuth.mockResolvedValue(admin())
    await GET(makeReq("?motor=pdfcn"), params)

    expect(mockRenderOcPdf).toHaveBeenCalledTimes(1)
    expect(mockWithBrowserContext).not.toHaveBeenCalled()
  })

  it("y también forzar chromium sobre un ajuste en pdfcn", async () => {
    mockAuth.mockResolvedValue(admin())
    mockGetPdfEngineFor.mockResolvedValue("pdfcn")
    await GET(makeReq("?motor=chromium"), params)

    expect(mockWithBrowserContext).toHaveBeenCalledTimes(1)
    expect(mockRenderOcPdf).not.toHaveBeenCalled()
  })

  it("sin admin:ops_settings el override se ignora y manda el ajuste", async () => {
    await GET(makeReq("?motor=pdfcn"), params)

    expect(mockWithBrowserContext).toHaveBeenCalledTimes(1)
    expect(mockRenderOcPdf).not.toHaveBeenCalled()
  })

  it("un valor inválido cae al ajuste en vez de romper la descarga", async () => {
    mockAuth.mockResolvedValue(admin())
    mockGetPdfEngineFor.mockResolvedValue("pdfcn")
    const res = await GET(makeReq("?motor=basura"), params)

    expect(res.status).toBe(200)
    expect(mockRenderOcPdf).toHaveBeenCalledTimes(1)
  })
})

describe("autorización", () => {
  it("sin sesión responde 403", async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq(), params)

    expect(res.status).toBe(403)
    expect(mockWithBrowserContext).not.toHaveBeenCalled()
    expect(mockRenderOcPdf).not.toHaveBeenCalled()
  })

  it("sin purchasing:view ni receiving:view responde 403", async () => {
    mockAuth.mockResolvedValue(makeSession({ permissions: [] }))
    const res = await GET(makeReq(), params)

    expect(res.status).toBe(403)
    expect(mockRenderOcPdf).not.toHaveBeenCalled()
  })

  it("una OC de otra faena es 404 en la rama Chromium", async () => {
    mockFindFirst.mockResolvedValue({ id: "oc-1", code: "OC-2026-0001", worksiteId: "otra" })
    const res = await GET(makeReq(), params)

    expect(res.status).toBe(404)
    expect(mockWithBrowserContext).not.toHaveBeenCalled()
  })

  it("mapea a 404 cuando el cargador pdfcn no encuentra una OC autorizable", async () => {
    // El gate real de `loadOcPrintDataOrNull` tiene su prueba directa en
    // `oc-print-data.test.ts`; aquí se prueba que la ruta no convierte null en
    // una descarga ni en un 403.
    mockGetPdfEngineFor.mockResolvedValue("pdfcn")
    mockLoadOrNull.mockResolvedValue(null)
    const res = await GET(makeReq(), params)

    expect(res.status).toBe(404)
    expect(mockRenderOcPdf).not.toHaveBeenCalled()
  })

  it("una OC inexistente es 404 en la rama Chromium", async () => {
    mockFindFirst.mockResolvedValue(undefined)
    expect((await GET(makeReq(), params)).status).toBe(404)
  })
})

describe("respuesta", () => {
  it("los dos motores devuelven el mismo Content-Disposition y cabeceras", async () => {
    const chromium = await GET(makeReq(), params)
    mockGetPdfEngineFor.mockResolvedValue("pdfcn")
    const pdfcn = await GET(makeReq(), params)

    for (const res of [chromium, pdfcn]) {
      expect(res.headers.get("Content-Type")).toBe("application/pdf")
      expect(res.headers.get("Cache-Control")).toBe("no-store")
      expect(res.headers.get("Content-Disposition")).toContain("OC 2026-0001.pdf")
    }
    expect(chromium.headers.get("Content-Disposition"))
      .toBe(pdfcn.headers.get("Content-Disposition"))
  })

  it("entrega los bytes del motor elegido", async () => {
    mockGetPdfEngineFor.mockResolvedValue("pdfcn")
    const res = await GET(makeReq(), params)
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-pdfcn")
  })
})
