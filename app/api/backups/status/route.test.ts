/**
 * backup-verify.sh sale con 1 (WARNING) o 2 (CRITICAL) exactamente cuando hay
 * algo que reportar, y execFile rechaza en esos casos. El endpoint descartaba
 * el error sin mirar `err.stdout` —donde viene el JSON—, así que el panel de
 * respaldos sólo sabía mostrar "todo bien".
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn(() => true))
const mockExecFile = vi.hoisted(() => vi.fn())
const mockStats = vi.hoisted(() => vi.fn())
const mockLatest = vi.hoisted(() => vi.fn())
const mockDrive = vi.hoisted(() => vi.fn())
const mockConfig = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("node:child_process", () => ({ execFile: mockExecFile }))
vi.mock("node:fs", () => ({ existsSync: () => true }))
vi.mock("@/lib/services/backups", () => ({
  getBackupStats: mockStats,
  getLatestBackup: mockLatest,
  getDriveHealth: mockDrive,
  getBackupConfig: mockConfig,
}))

import { GET } from "./route"

/** Simula backup-verify.sh: código != 0 ⇒ execFile rechaza, con el JSON en stdout. */
function verifyExits(exitCode: number, status: string) {
  mockExecFile.mockImplementation((_file, _args, _opts, cb) => {
    const stdout = JSON.stringify({ status, exit_code: exitCode, issues: [] })
    if (exitCode === 0) return cb(null, { stdout, stderr: "" })
    cb(Object.assign(new Error(`Command failed with exit code ${exitCode}`), { code: exitCode, stdout, stderr: "" }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCan.mockReturnValue(true)
  mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["admin:backups"] } })
  mockStats.mockResolvedValue({
    totalBackups: 3, successCount: 3, failedCount: 0, runningCount: 0, backupsLast7Days: 3,
  })
  mockLatest.mockResolvedValue({
    backupDate: "2026-08-20", status: "success", startedAt: new Date(), totalSizeBytes: 1024, driveUploaded: true,
  })
  mockConfig.mockResolvedValue({ backupHour: 3, retentionDays: 30, maxAgeHours: 36, manualTimeoutMinutes: 30 })
  mockDrive.mockResolvedValue({
    rcloneInstalled: true, remoteConfigured: true, saJsonPresent: true, reachable: true, lastChecked: null,
  })
  verifyExits(0, "OK")
})

describe("GET /api/backups/status", () => {
  it("exige sesión y permiso admin:backups", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)

    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } })
    mockCan.mockReturnValue(false)
    expect((await GET()).status).toBe(403)
  })

  it("reporta OK cuando backup-verify sale con 0", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe("ok")
  })

  it("degrada cuando backup-verify sale con 1 (WARNING)", async () => {
    verifyExits(1, "WARNING")
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe("degraded")
  })

  it("marca error 503 cuando backup-verify sale con 2 (CRITICAL)", async () => {
    verifyExits(2, "CRITICAL")
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).status).toBe("error")
  })

  it("no se cae si el script no existe o devuelve basura", async () => {
    mockExecFile.mockImplementation((_file, _args, _opts, cb) =>
      cb(Object.assign(new Error("ENOENT"), { code: "ENOENT" })))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe("ok")
  })
})
