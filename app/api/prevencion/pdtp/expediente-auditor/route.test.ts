import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.hoisted(() => vi.fn())
const mockDossier = vi.hoisted(() => vi.fn())
const mockAudit = vi.hoisted(() => vi.fn())
const mockIsActiveWorksite = vi.hoisted(() => vi.fn(async () => true))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockAudit }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/services/prevention-pdtp", () => ({
  getPdtpAuditDossier: mockDossier,
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
  return new NextRequest(`http://localhost/api/prevencion/pdtp/expediente-auditor${query}`)
}

const BASE_DOSSIER = {
  programId: "p1", programTitle: "Programa 2026", worksiteId: "w1", contentVersion: 2, contentDigest: "a".repeat(64), status: "active",
  executions: [], sourceLinks: [], obligations: [], actions: [], followupsByActionId: {}, approvalSteps: [], changes: [], importBatches: [],
}

beforeEach(() => {
  vi.resetAllMocks()
  mockDossier.mockResolvedValue(BASE_DOSSIER)
  mockIsActiveWorksite.mockResolvedValue(true)
})

describe("GET PDTP expediente auditor", () => {
  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(request("?programId=p1"))).status).toBe(401)
  })

  it("returns 403 without PDTP view permission", async () => {
    mockAuth.mockResolvedValue(session({ permissions: [] }))
    expect((await GET(request("?programId=p1"))).status).toBe(403)
    expect(mockDossier).not.toHaveBeenCalled()
  })

  it("returns 400 when no programId is provided", async () => {
    mockAuth.mockResolvedValue(session())
    expect((await GET(request())).status).toBe(400)
    expect(mockDossier).not.toHaveBeenCalled()
  })

  it("returns 403 when the session has no worksite scope", async () => {
    mockAuth.mockResolvedValue(session({ worksiteIds: [] }))
    expect((await GET(request("?programId=p1"))).status).toBe(403)
    expect(mockDossier).not.toHaveBeenCalled()
  })

  it("requires an explicit worksite when a scoped user has several", async () => {
    mockAuth.mockResolvedValue(session({ worksiteIds: ["w1", "w2"] }))
    expect((await GET(request("?programId=p1"))).status).toBe(400)
    expect(mockDossier).not.toHaveBeenCalled()
  })

  it("returns 403 for a worksite outside the authorized scope", async () => {
    mockAuth.mockResolvedValue(session({ worksiteIds: ["w1"] }))
    expect((await GET(request("?programId=p1&faena=w-ajena"))).status).toBe(403)
    expect(mockDossier).not.toHaveBeenCalled()
  })

  it("derives the only authorized worksite and returns a signed XLSX", async () => {
    mockAuth.mockResolvedValue(session())

    const response = await GET(request("?programId=p1"))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-disposition")).toContain("pdtp-expediente-auditor-p1.xlsx")
    expect(mockDossier).toHaveBeenCalledWith({ programId: "p1", worksiteId: "w1", scope: ["w1"] })
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "export", entityType: "prevention_pdtp_program" }))
  })

  it("returns 404 when the program does not exist", async () => {
    mockAuth.mockResolvedValue(session())
    mockDossier.mockResolvedValue(null)

    const response = await GET(request("?programId=p1"))
    expect(response.status).toBe(404)
  })
})
