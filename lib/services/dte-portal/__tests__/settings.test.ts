import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  readStoredDteSettings,
  saveDtePortalSettings,
  clearStoredDteSettings,
  hasStoredDteSettings,
} from "../settings"
import { recordAudit } from "@/lib/audit"

const mocks = vi.hoisted(() => {
  const selectWhere = vi.fn()     // db.select().from().where() → filas dte.*
  const insertDoUpdate = vi.fn()  // db.insert().values().onConflictDoUpdate()
  const deleteWhere = vi.fn()     // db.delete().where()
  return { selectWhere, insertDoUpdate, deleteWhere }
})

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mocks.selectWhere }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: mocks.insertDoUpdate }) }),
    delete: () => ({ where: mocks.deleteWhere }),
  },
}))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))

describe("readStoredDteSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns a partial map of known dte.* keys, ignoring unknown keys", async () => {
    mocks.selectWhere.mockResolvedValue([
      { key: "dte.rut_usr", value: "11111111-1" },
      { key: "dte.clave", value: "secret" },
      { key: "dte.future_unknown_key", value: "x" },
    ])

    await expect(readStoredDteSettings()).resolves.toEqual({
      rutUsr: "11111111-1",
      clave: "secret",
    })
  })

  it("returns {} when nothing is stored", async () => {
    mocks.selectWhere.mockResolvedValue([])
    await expect(readStoredDteSettings()).resolves.toEqual({})
  })

  it("returns {} on DB error so callers fall back to env", async () => {
    mocks.selectWhere.mockRejectedValue(new Error("db down"))
    await expect(readStoredDteSettings()).resolves.toEqual({})
  })
})

describe("hasStoredDteSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("is false when no dte.* keys exist", async () => {
    mocks.selectWhere.mockResolvedValue([])
    await expect(hasStoredDteSettings()).resolves.toBe(false)
  })

  it("is true when at least one dte.* key exists", async () => {
    mocks.selectWhere.mockResolvedValue([{ key: "dte.cod_emp", value: "433" }])
    await expect(hasStoredDteSettings()).resolves.toBe(true)
  })
})

describe("saveDtePortalSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectWhere.mockResolvedValue([])
  })

  it("writes only the provided fields and records an audit entry", async () => {
    await saveDtePortalSettings(
      { rutUsr: "11111111-1", codEmp: "433", syncEnabled: true, delayMs: 750 },
      { userId: "usr-admin" },
    )

    expect(mocks.insertDoUpdate).toHaveBeenCalledTimes(4)
    expect(mocks.deleteWhere).not.toHaveBeenCalled()
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "usr-admin",
      action: "update",
      entityType: "dte_portal_settings",
      entityId: "batch",
    }))
  })

  it("an empty text field deletes the stored key (falls back to env)", async () => {
    await saveDtePortalSettings({ rutUsr: "" }, { userId: "usr-admin" })
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1)
    expect(mocks.insertDoUpdate).not.toHaveBeenCalled()
  })

  it("an empty clave keeps the stored one unless clearClave is set", async () => {
    await saveDtePortalSettings({ clave: "" }, { userId: "usr-admin" })
    expect(mocks.insertDoUpdate).not.toHaveBeenCalled()
    expect(mocks.deleteWhere).not.toHaveBeenCalled()

    vi.clearAllMocks()
    mocks.selectWhere.mockResolvedValue([])
    await saveDtePortalSettings({ clave: "", clearClave: true }, { userId: "usr-admin" })
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1)
  })

  it("writes a non-empty clave", async () => {
    await saveDtePortalSettings({ clave: "new-pass" }, { userId: "usr-admin" })
    expect(mocks.insertDoUpdate).toHaveBeenCalledTimes(1)
  })

  it("validates the delayMs range", async () => {
    await expect(
      saveDtePortalSettings({ delayMs: 99_999 }, { userId: "usr-admin" }),
    ).rejects.toThrow("intervalo entre consultas")
  })

  it("never writes the password into the audit log", async () => {
    mocks.selectWhere
      .mockResolvedValueOnce([])                                            // before
      .mockResolvedValueOnce([{ key: "dte.clave", value: "new-pass" }])      // after

    await saveDtePortalSettings({ clave: "new-pass" }, { userId: "usr-admin" })

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      oldState: {},
      newState: { clave: "••••••••" },
    }))
  })

  it("does nothing (and does not audit) when no field changes", async () => {
    await saveDtePortalSettings({ clave: "" }, { userId: "usr-admin" })
    expect(recordAudit).not.toHaveBeenCalled()
  })
})

describe("clearStoredDteSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("deletes all dte.* keys and records the audit entry", async () => {
    mocks.selectWhere.mockResolvedValue([{ key: "dte.rut_usr", value: "11111111-1" }])

    await clearStoredDteSettings({ userId: "usr-admin" })

    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1)
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "delete",
      entityType: "dte_portal_settings",
    }))
  })

  it("is a no-op when nothing is stored", async () => {
    mocks.selectWhere.mockResolvedValue([])

    await clearStoredDteSettings({ userId: "usr-admin" })

    expect(mocks.deleteWhere).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })
})
