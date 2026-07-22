/**
 * Unit tests for catalog Excel export API route — auth gates only.
 * Valid export responses are validated by typecheck and existing excel-builder tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCanAny = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ canAny: mockCanAny }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/utils", () => ({
  encodeContentDisposition: vi.fn(),
}))
vi.mock("@/lib/reports/export", () => ({
  buildXlsxBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
}))
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => Promise.resolve([])),
        orderBy: vi.fn(() => Promise.resolve([])),
      })),
    })),
  },
}))

import { NextRequest } from "next/server"
import { GET } from "@/app/api/admin/catalogos/export/route"

function makeReq(tipo?: string): NextRequest {
  const url = new URL("http://localhost/api/admin/catalogos/export")
  if (tipo) url.searchParams.set("tipo", tipo)
  return new NextRequest(url)
}

describe("catalog Excel export — auth gates", () => {
  beforeEach(() => vi.resetAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET(makeReq("productos"))
    expect(res.status).toBe(401)
  })

  it("returns 400 for unknown tipo", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "x" } })
    const res = await GET(makeReq("invalido"))
    expect(res.status).toBe(400)
  })

  it("returns 403 without permission for productos", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "x" } })
    mockCanAny.mockReturnValue(false)
    const res = await GET(makeReq("productos"))
    expect(res.status).toBe(403)
  })

  it("returns 403 without permission for proveedores", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "x" } })
    mockCanAny.mockReturnValue(false)
    const res = await GET(makeReq("proveedores"))
    expect(res.status).toBe(403)
  })

  it("returns 403 without permission for trabajadores", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "x" } })
    mockCanAny.mockReturnValue(false)
    const res = await GET(makeReq("trabajadores"))
    expect(res.status).toBe(403)
  })

  it("returns 400 for empty tipo", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "x" } })
    const res = await GET(makeReq())
    expect(res.status).toBe(400)
  })
})
