import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.hoisted(() => vi.fn())
const mockBuild = vi.hoisted(() => vi.fn())
const mockBuildRe36Document = vi.hoisted(() => vi.fn())
const mockXlsx = vi.hoisted(() => vi.fn())
const mockRenderRe36Buffer = vi.hoisted(() => vi.fn())
const mockAudit = vi.hoisted(() => vi.fn())
const mockIsActiveWorksite = vi.hoisted(() => vi.fn(async () => true))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/reports/export", () => ({ buildXlsxBuffer: mockXlsx }))
vi.mock("@/lib/reports/pdtp-re36-workbook", () => ({ renderPdtpRe36Buffer: mockRenderRe36Buffer }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockAudit }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/services/prevention-pdtp", () => ({
  buildPdtpExport: mockBuild,
  buildPdtpRe36Document: mockBuildRe36Document,
  isActivePdtpWorksite: mockIsActiveWorksite,
  assertWorksiteAccess: (worksiteId: string, scope: string[] | "all") => {
    if (scope !== "all" && !scope.includes(worksiteId)) throw new Error("Sin acceso")
  },
}))

import { GET } from "./route"

function session({
  permissions = ["prevention:pdtp:view"],
  worksiteIds = ["w1"],
  isGlobal = false,
  roleSlug = isGlobal ? "administrador" : "prevencionista_faena",
}: {
  permissions?: string[]
  worksiteIds?: string[]
  isGlobal?: boolean
  roleSlug?: string
} = {}) {
  return { user: { id: "u1", permissions, roles: [roleSlug], worksiteIds, isGlobal } }
}

function request(query = "") {
  return new NextRequest(`http://localhost/api/prevencion/pdtp/export${query}`)
}

function re36Document(overrides: Partial<{ year: number; version: number; worksiteCode: string; sheets: unknown[] }> = {}) {
  return {
    program: { id: "p1", year: overrides.year ?? 2026, version: overrides.version ?? 3 },
    worksite: { id: "w1", name: "Faena Uno", code: overrides.worksiteCode ?? "F1" },
    sheets: overrides.sheets ?? [{ code: "pdtp_general" }],
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockBuild.mockResolvedValue({ filenameBase: "pdtp", worksheetName: "PDTP", headers: [], rows: [] })
  mockXlsx.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
  mockBuildRe36Document.mockResolvedValue(re36Document())
  mockRenderRe36Buffer.mockResolvedValue(new Uint8Array([4, 5, 6]).buffer)
  mockIsActiveWorksite.mockResolvedValue(true)
})

describe("GET PDTP Excel", () => {
  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
  })

  it("returns 403 without PDTP view permission", async () => {
    mockAuth.mockResolvedValue(session({ permissions: [] }))
    expect((await GET(request())).status).toBe(403)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("derives the only authorized worksite and exports with defense-in-depth scope (formato=plano)", async () => {
    mockAuth.mockResolvedValue(session())

    const response = await GET(request("?year=2026&hoja=cphs&programId=p1&formato=plano"))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mockBuild).toHaveBeenCalledWith({
      programId: "p1",
      year: 2026,
      sheetCode: "cphs",
      worksiteId: "w1",
      scope: ["w1"],
    })
    expect(mockBuildRe36Document).not.toHaveBeenCalled()
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1",
      entityType: "prevention_pdtp_program",
      entityId: "p1",
      newState: expect.objectContaining({ result: "success", requestedWorksiteId: "w1", formato: "plano" }),
    }))
  })

  it("defaults to formato=re36 and calls buildPdtpRe36Document + renderPdtpRe36Buffer", async () => {
    mockAuth.mockResolvedValue(session())

    const response = await GET(request("?programId=p1"))

    expect(response.status).toBe(200)
    expect(mockBuild).not.toHaveBeenCalled()
    expect(mockBuildRe36Document).toHaveBeenCalledWith({ programId: "p1", worksiteId: "w1", scope: ["w1"] })
    expect(mockRenderRe36Buffer).toHaveBeenCalledWith(re36Document())
    expect(response.headers.get("content-disposition")).toContain("RE-36-PDTP-2026-F1-v3.xlsx")
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      newState: expect.objectContaining({ result: "success", formato: "re36" }),
    }))
  })

  it("treats an explicit formato=re36 the same as the default", async () => {
    mockAuth.mockResolvedValue(session())

    const response = await GET(request("?programId=p1&formato=re36"))

    expect(response.status).toBe(200)
    expect(mockBuildRe36Document).toHaveBeenCalled()
  })

  it("falls back to formato=re36 for an unrecognized formato value instead of failing", async () => {
    mockAuth.mockResolvedValue(session())

    const response = await GET(request("?programId=p1&formato=cualquier-cosa"))

    expect(response.status).toBe(200)
    expect(mockBuildRe36Document).toHaveBeenCalled()
    expect(mockBuild).not.toHaveBeenCalled()
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      newState: expect.objectContaining({ formato: "re36" }),
    }))
  })

  it("rejects formato=re36 without programId instead of guessing the program", async () => {
    mockAuth.mockResolvedValue(session())

    const response = await GET(request("?faena=w1"))

    expect(response.status).toBe(400)
    expect(mockBuildRe36Document).not.toHaveBeenCalled()
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      newState: expect.objectContaining({ result: "invalid", formato: "re36" }),
    }))
  })

  it("requires an explicit worksite when a scoped user has several", async () => {
    mockAuth.mockResolvedValue(session({ worksiteIds: ["w1", "w2"] }))
    const response = await GET(request("?year=2026"))
    expect(response.status).toBe(400)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("requires an explicit worksite for global users instead of exporting all", async () => {
    mockAuth.mockResolvedValue(session({ isGlobal: true, worksiteIds: [] }))
    const response = await GET(request("?year=2026"))
    expect(response.status).toBe(400)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("returns 403 when the session has no worksite scope", async () => {
    mockAuth.mockResolvedValue(session({ worksiteIds: [] }))
    const response = await GET(request("?faena=w1"))
    expect(response.status).toBe(403)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("returns 403 for a worksite outside the authorized scope", async () => {
    mockAuth.mockResolvedValue(session({ worksiteIds: ["w1", "w2"] }))
    const response = await GET(request("?faena=w3"))
    expect(response.status).toBe(403)
    expect(mockBuild).not.toHaveBeenCalled()
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      newState: expect.objectContaining({ result: "denied", requestedWorksiteId: "w3" }),
    }))
  })

  it("returns 400 for an unknown or inactive worksite even for a global user", async () => {
    mockAuth.mockResolvedValue(session({ isGlobal: true, worksiteIds: [] }))
    mockIsActiveWorksite.mockResolvedValue(false)
    const response = await GET(request("?year=2026&faena=invalid"))
    expect(response.status).toBe(400)
    expect(mockBuild).not.toHaveBeenCalled()
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      newState: expect.objectContaining({ result: "invalid", requestedWorksiteId: "invalid" }),
    }))
  })

  it("lets global users export one explicitly selected worksite", async () => {
    mockAuth.mockResolvedValue(session({ isGlobal: true, worksiteIds: [] }))
    const response = await GET(request("?year=2026&faena=w9&formato=plano"))
    expect(response.status).toBe(200)
    expect(mockBuild).toHaveBeenCalledWith(expect.objectContaining({ worksiteId: "w9", scope: "all" }))
  })

  it.each([
    {
      caseName: "rol sin permiso aunque tenga faena",
      userSession: session({ roleSlug: "jefe_terreno", permissions: [], worksiteIds: ["w1"] }),
      query: "?faena=w1",
      worksiteExists: true,
      expectedStatus: 403,
    },
    {
      caseName: "rol de faena sin alcance habilitado",
      userSession: session({ roleSlug: "prevencionista_faena", worksiteIds: [] }),
      query: "?faena=w1",
      worksiteExists: true,
      expectedStatus: 403,
    },
    {
      caseName: "rol con varias faenas y parámetro omitido",
      userSession: session({ roleSlug: "prevencionista", worksiteIds: ["w1", "w2"] }),
      query: "",
      worksiteExists: true,
      expectedStatus: 400,
    },
    {
      caseName: "rol acotado y faena ajena",
      userSession: session({ roleSlug: "prevencionista_faena", worksiteIds: ["w1"] }),
      query: "?faena=w2",
      worksiteExists: true,
      expectedStatus: 403,
    },
    {
      caseName: "rol global y faena inexistente",
      userSession: session({ roleSlug: "administrador", isGlobal: true, worksiteIds: [] }),
      query: "?faena=invalid",
      worksiteExists: false,
      expectedStatus: 400,
    },
    {
      caseName: "rol global y parámetro omitido",
      userSession: session({ roleSlug: "administrador", isGlobal: true, worksiteIds: [] }),
      query: "",
      worksiteExists: true,
      expectedStatus: 400,
    },
    {
      caseName: "rol global y faena explícita válida",
      userSession: session({ roleSlug: "administrador", isGlobal: true, worksiteIds: [] }),
      // formato=plano porque este caso no pasa programId, y el formato RE-36
      // (default) lo exige explícitamente (ver test dedicado más arriba).
      query: "?faena=w9&formato=plano",
      worksiteExists: true,
      expectedStatus: 200,
    },
  ])("aplica matriz rol × faena × endpoint: $caseName", async ({ userSession, query, worksiteExists, expectedStatus }) => {
    mockAuth.mockResolvedValue(userSession)
    mockIsActiveWorksite.mockResolvedValue(worksiteExists)

    const response = await GET(request(query))

    expect(response.status).toBe(expectedStatus)
    if (expectedStatus !== 200) expect(mockBuild).not.toHaveBeenCalled()
  })
})
