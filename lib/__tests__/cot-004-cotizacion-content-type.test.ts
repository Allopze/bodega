/**
 * `COT-004` (auditoría 2026-09-14) — las cotizaciones JPG y PNG se sirven como
 * imagen, no como binario genérico.
 *
 * Antes: la carga aceptaba y validaba PDF/JPG/PNG por bytes mágicos, pero la
 * descarga respondía `application/pdf` **sólo** si la ruta interna terminaba en
 * `.pdf` y `application/octet-stream` en cualquier otro caso. Como esa ruta se
 * construía con la extensión del nombre que mandó el cliente, toda imagen
 * legítima salía como binario y el navegador la descargaba en vez de mostrarla.
 *
 * Se ejercitan los dos handlers reales (sólo auth/db/fs/almacenamiento están
 * mockeados) porque el defecto vivía en la respuesta, no en el resolvedor.
 */

import type { Session } from "next-auth"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockFindRepuestoQuotation = vi.hoisted(() => vi.fn())
const mockFindServiceQuotation = vi.hoisted(() => vi.fn())
const mockFindPurchaseRequest = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())
const mockResolveQuotationAttachmentFile = vi.hoisted(() => vi.fn())
const mockResolveServiceQuotationFile = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/db", () => ({
  db: {
    query: {
      repuestoQuotations: { findFirst: mockFindRepuestoQuotation },
      serviceQuotations: { findFirst: mockFindServiceQuotation },
      purchaseRequests: { findFirst: mockFindPurchaseRequest },
    },
  },
}))
vi.mock("node:fs", () => ({ promises: { readFile: mockReadFile } }))
vi.mock("@/lib/storage/config", () => ({
  resolveQuotationAttachmentFile: mockResolveQuotationAttachmentFile,
  resolveServiceQuotationFile: mockResolveServiceQuotationFile,
}))
// El encabezado importa por su disposición, no por el escape del nombre.
vi.mock("@/lib/utils", () => ({
  encodeContentDisposition: (fileName: string, disposition: string) => `${disposition}; filename="${fileName}"`,
}))

import { GET as getRepuestoQuotation } from "@/app/api/repuestos/quotaciones/[id]/route"
import { GET as getServiceQuotation } from "@/app/api/servicios/cotizaciones/[id]/route"

function makeSession(): Session {
  return {
    user: {
      id: "user-cot004",
      name: "Test",
      email: "cot004@chome.cl",
      roles: [],
      permissions: ["repuestos:view_all", "servicios:view_all"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: null,
      isActive: true,
      isGlobal: true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session
}

function makeReq() {
  return new NextRequest(new URL("http://localhost/api/x/y/q-1"))
}

const routes = [
  {
    label: "repuestos",
    GET: getRepuestoQuotation,
    findQuotation: mockFindRepuestoQuotation,
    resolveFile: mockResolveQuotationAttachmentFile,
  },
  {
    label: "servicios",
    GET: getServiceQuotation,
    findQuotation: mockFindServiceQuotation,
    resolveFile: mockResolveServiceQuotationFile,
  },
] as const

describe.each(routes)("COT-004 — descarga de cotización ($label)", ({ GET, findQuotation, resolveFile }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(makeSession())
    mockFindPurchaseRequest.mockResolvedValue({ worksiteId: "ws-1", requesterId: "user-cot004" })
    resolveFile.mockReturnValue("/tmp/archivo")
    mockReadFile.mockResolvedValue(Buffer.from("contenido"))
  })

  async function serve(row: Record<string, unknown>) {
    findQuotation.mockResolvedValue({
      id: "q-1", requestId: "req-1", fileName: "cotizacion", ...row,
    })
    return GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })
  }

  it("sirve un JPG validado como image/jpeg y no como binario genérico", async () => {
    const response = await serve({ filePath: "q-1.jpg", mimeType: "image/jpeg" })
    expect(response.headers.get("Content-Type")).toBe("image/jpeg")
    expect(response.headers.get("Content-Disposition")).toContain("inline")
  })

  it("sirve un PNG validado como image/png", async () => {
    const response = await serve({ filePath: "q-1.png", mimeType: "image/png" })
    expect(response.headers.get("Content-Type")).toBe("image/png")
  })

  it("sigue sirviendo el PDF como application/pdf", async () => {
    const response = await serve({ filePath: "q-1.pdf", mimeType: "application/pdf" })
    expect(response.headers.get("Content-Type")).toBe("application/pdf")
  })

  it("manda el MIME persistido incluso si la extensión de la ruta lo desmiente", async () => {
    // El nombre del cliente decía ".pdf" pero los bytes eran PNG: antes se
    // servía como PDF, que es justo el desacuerdo que el hallazgo describe.
    const response = await serve({ filePath: "q-1.pdf", mimeType: "image/png" })
    expect(response.headers.get("Content-Type")).toBe("image/png")
  })

  it("una fila legacy sin MIME se resuelve por extensión interna", async () => {
    const response = await serve({ filePath: "q-1.jpeg", mimeType: null })
    expect(response.headers.get("Content-Type")).toBe("image/jpeg")
  })

  it("un tipo fuera del catálogo aceptado nunca se sirve en línea", async () => {
    const response = await serve({ filePath: "q-1.html", mimeType: null })
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream")
    expect(response.headers.get("Content-Disposition")).toContain("attachment")
  })

  it("declara nosniff para que el navegador no olfatee una carga de usuario", async () => {
    const response = await serve({ filePath: "q-1.png", mimeType: "image/png" })
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })
})
