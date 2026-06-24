/**
 * Integration tests for GET /api/reportes/export/route.ts.
 *
 * Tests authentication, authorization, report type validation,
 * filter parsing, XLSX response format, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockCanFn = vi.hoisted(() => vi.fn())
const mockCanAnyFn = vi.hoisted(() => vi.fn())
const mockGetReportData = vi.hoisted(() => vi.fn())
const mockBuildXlsxBuffer = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({ error: vi.fn() }))
const mockEncodeContentDisposition = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("@/lib/auth/can", () => ({
  can: mockCanFn,
  canAny: mockCanAnyFn,
}))
vi.mock("@/lib/reports/export", () => ({
  getReportData: mockGetReportData,
  buildXlsxBuffer: mockBuildXlsxBuffer,
}))
vi.mock("@/lib/logger", () => ({ logger: mockLogger }))
vi.mock("@/lib/utils", () => ({
  encodeContentDisposition: mockEncodeContentDisposition,
}))

// ── Import handler AFTER mocks ─────────────────────────────────────────────
const { GET } = await import("@/app/api/reportes/export/route")

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["administrador"],
      permissions: ["reports:view"],
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
      ...overrides,
    },
  }
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

const MOCK_REPORT = {
  filenameBase: "gasto-por-faena",
  worksheetName: "Gasto por faena",
  headers: ["OC", "Faena"],
  rows: [["OC-1", "Faena Uno"]],
}

const MOCK_XLSX_BUFFER = new Uint8Array([0x50, 0x4B, 0x03, 0x04]).buffer as ArrayBuffer

// ── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/reportes/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthFn.mockResolvedValue(makeSession())
    mockCanFn.mockReturnValue(true)
    mockCanAnyFn.mockReturnValue(true)
    mockGetReportData.mockResolvedValue(MOCK_REPORT)
    mockBuildXlsxBuffer.mockResolvedValue(MOCK_XLSX_BUFFER)
    mockEncodeContentDisposition.mockReturnValue(
      'attachment; filename="gasto-por-faena.xlsx"',
    )
  })

  // ── Authentication ────────────────────────────────────────────────────

  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuthFn.mockResolvedValueOnce(null)

      const res = await GET(makeRequest("/api/reportes/export?tipo=gasto_faena"))

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe("No autenticado")
    })
  })

  // ── Authorization ─────────────────────────────────────────────────────

  describe("authorization", () => {
    it("returns 403 when user lacks reports:view permission", async () => {
      mockCanAnyFn.mockReturnValueOnce(false)

      const res = await GET(makeRequest("/api/reportes/export?tipo=gasto_faena"))

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe("Sin permisos")
      expect(mockGetReportData).not.toHaveBeenCalled()
    })
  })

  // ── Report type validation ────────────────────────────────────────────

  describe("report type validation", () => {
    it("returns 400 for invalid report type", async () => {
      const res = await GET(makeRequest("/api/reportes/export?tipo=invalid_type"))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe("Tipo de reporte inválido")
    })

    it("defaults to gasto_faena when tipo is missing", async () => {
      const res = await GET(makeRequest("/api/reportes/export"))

      expect(res.status).toBe(200)
      expect(mockGetReportData).toHaveBeenCalledWith(
        "gasto_faena",
        expect.anything(),
        {},
        10_000,
      )
    })

    it("accepts valid report types", async () => {
      for (const tipo of ["gasto_faena", "items_sin_oc", "oc_por_estado"]) {
        vi.clearAllMocks()
        mockAuthFn.mockResolvedValue(makeSession())
        mockCanFn.mockReturnValue(true)
        mockCanAnyFn.mockReturnValue(true)
        mockGetReportData.mockResolvedValue(MOCK_REPORT)
        mockBuildXlsxBuffer.mockResolvedValue(MOCK_XLSX_BUFFER)

        const res = await GET(makeRequest(`/api/reportes/export?tipo=${tipo}`))
        expect(res.status).toBe(200)
        expect(mockGetReportData).toHaveBeenCalledWith(
          tipo,
          expect.anything(),
          {},
          10_000,
        )
      }
    })
  })

  // ── Filter parsing ────────────────────────────────────────────────────

  describe("filter parsing", () => {
    it("parses from/to date filters", async () => {
      const res = await GET(
        makeRequest("/api/reportes/export?tipo=gasto_faena&from=2026-01-01&to=2026-06-30"),
      )

      expect(res.status).toBe(200)
      expect(mockGetReportData).toHaveBeenCalledWith(
        "gasto_faena",
        expect.anything(),
        { fromDate: "2026-01-01", toDate: "2026-06-30" },
        10_000,
      )
    })

    it("parses faena (worksite) filter", async () => {
      const res = await GET(
        makeRequest("/api/reportes/export?tipo=gasto_faena&faena=ws-1"),
      )

      expect(res.status).toBe(200)
      expect(mockGetReportData).toHaveBeenCalledWith(
        "gasto_faena",
        expect.anything(),
        { worksiteId: "ws-1" },
        10_000,
      )
    })

    it("parses status filter", async () => {
      const res = await GET(
        makeRequest("/api/reportes/export?tipo=gasto_faena&status=sent"),
      )

      expect(res.status).toBe(200)
      expect(mockGetReportData).toHaveBeenCalledWith(
        "gasto_faena",
        expect.anything(),
        { status: "sent" },
        10_000,
      )
    })

    it("parses all filters combined", async () => {
      const res = await GET(
        makeRequest(
          "/api/reportes/export?tipo=items_sin_oc&from=2026-01-01&to=2026-12-31&faena=ws-2&status=approved",
        ),
      )

      expect(res.status).toBe(200)
      expect(mockGetReportData).toHaveBeenCalledWith(
        "items_sin_oc",
        expect.anything(),
        {
          fromDate: "2026-01-01",
          toDate: "2026-12-31",
          worksiteId: "ws-2",
          status: "approved",
        },
        10_000,
      )
    })
  })

  // ── Successful response ───────────────────────────────────────────────

  describe("successful response", () => {
    it("returns XLSX with correct content type and disposition", async () => {
      const res = await GET(makeRequest("/api/reportes/export?tipo=gasto_faena"))

      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="gasto-por-faena.xlsx"',
      )
    })

    it("returns XLSX buffer as response body", async () => {
      const res = await GET(makeRequest("/api/reportes/export?tipo=gasto_faena"))

      const body = await res.arrayBuffer()
      expect(body.byteLength).toBeGreaterThan(0)
    })

    it("sets X-Row-Limit-Applied header when truncation occurs", async () => {
      mockGetReportData.mockResolvedValueOnce({
        ...MOCK_REPORT,
        rowLimitApplied: true,
      })

      const res = await GET(makeRequest("/api/reportes/export?tipo=gasto_faena"))

      expect(res.headers.get("X-Row-Limit-Applied")).toBe("true")
    })

    it("does not set X-Row-Limit-Applied header when no truncation", async () => {
      const res = await GET(makeRequest("/api/reportes/export?tipo=gasto_faena"))

      expect(res.headers.get("X-Row-Limit-Applied")).toBeNull()
    })
  })

  // ── Error handling ────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when getReportData throws", async () => {
      mockGetReportData.mockRejectedValueOnce(new Error("DB connection failed"))

      const res = await GET(makeRequest("/api/reportes/export?tipo=gasto_faena"))

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe("Error al generar el reporte")
      expect(mockLogger.error).toHaveBeenCalledWith(
        "[reportes/export]",
        expect.any(Error),
      )
    })

    it("returns 500 when buildXlsxBuffer throws", async () => {
      mockBuildXlsxBuffer.mockRejectedValueOnce(new Error("XLSX generation failed"))

      const res = await GET(makeRequest("/api/reportes/export?tipo=gasto_faena"))

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe("Error al generar el reporte")
    })
  })
})
