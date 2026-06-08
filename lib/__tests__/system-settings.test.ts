import { beforeEach, describe, expect, it, vi } from "vitest"
import { getCompanyProfile, setCompanyProfile } from "@/lib/services/system-settings"
import { recordAudit } from "@/lib/audit"

const mocks = vi.hoisted(() => {
  const findFirst = vi.fn()
  const values = vi.fn(() => ({
    onConflictDoUpdate: vi.fn(),
  }))
  const insert = vi.fn(() => ({ values }))

  return { findFirst, insert, values }
})

vi.mock("@/db", () => ({
  db: {
    query: {
      systemSettings: {
        findFirst: mocks.findFirst,
      },
    },
    insert: mocks.insert,
  },
}))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}))

describe("system settings company profile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns company defaults when settings are missing", async () => {
    mocks.findFirst.mockResolvedValue(null)

    await expect(getCompanyProfile()).resolves.toEqual({
      name:    "Chome",
      rut:     "",
      address: "",
      phone:   "",
      email:   "",
      website: "",
    })
  })

  it("reads configured company profile fields", async () => {
    mocks.findFirst
      .mockResolvedValueOnce({ key: "company_name", value: "Chome SpA" })
      .mockResolvedValueOnce({ key: "company_rut", value: "76123456-7" })
      .mockResolvedValueOnce({ key: "company_address", value: "Av. Principal 457" })
      .mockResolvedValueOnce({ key: "company_phone", value: "+56 9 8765 4321" })
      .mockResolvedValueOnce({ key: "company_email", value: "compras@chome.cl" })
      .mockResolvedValueOnce({ key: "company_website", value: "www.chome.cl" })

    await expect(getCompanyProfile()).resolves.toEqual({
      name:    "Chome SpA",
      rut:     "76123456-7",
      address: "Av. Principal 457",
      phone:   "+56 9 8765 4321",
      email:   "compras@chome.cl",
      website: "www.chome.cl",
    })
  })

  it("saves all company profile fields and records audit", async () => {
    mocks.findFirst.mockResolvedValue(null)

    await setCompanyProfile(
      {
        name:    " Chome SpA ",
        rut:     " 76123456-7 ",
        address: " Av. Principal 457 ",
        phone:   " +56 9 8765 4321 ",
        email:   " compras@chome.cl ",
        website: " www.chome.cl ",
      },
      "usr-admin",
      "admin@chome.cl",
    )

    expect(mocks.insert).toHaveBeenCalledTimes(6)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      key:   "company_name",
      value: "Chome SpA",
    }))
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      key:   "company_email",
      value: "compras@chome.cl",
    }))
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId:     "usr-admin",
      userEmail:  "admin@chome.cl",
      action:     "update",
      entityType: "system_setting",
      entityId:   "company_profile",
    }))
  })
})
