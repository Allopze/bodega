import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getCompanyProfile,
  setCompanyProfile,
  getEmailsEnabled,
  setEmailsEnabled,
  getPdfMaxSizeMb,
  setPdfMaxSizeMb,
} from "@/lib/services/system-settings"
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
      name:             "Servicios Industriales Chome Limitada",
      rut:              "78.023.530-6",
      businessActivity: "Servicios Industrial",
      address:          "Camino de Luna 91 Villa Portal del Sol - Panguipulli - Panguipulli - Chile",
      branchAddress:    "Pedro Aguirre Cerda 1156 Block 4to, Concepcion",
      phone:            "41-3251368",
      email:            "",
      website:          "",
    })
  })

  it("reads configured company profile fields", async () => {
    mocks.findFirst
      .mockResolvedValueOnce({ key: "company_name", value: "Chome SpA" })
      .mockResolvedValueOnce({ key: "company_rut", value: "76123456-7" })
      .mockResolvedValueOnce({ key: "company_business_activity", value: "Servicios industriales" })
      .mockResolvedValueOnce({ key: "company_address", value: "Av. Principal 457" })
      .mockResolvedValueOnce({ key: "company_branch_address", value: "Sucursal Concepcion" })
      .mockResolvedValueOnce({ key: "company_phone", value: "+56 9 8765 4321" })
      .mockResolvedValueOnce({ key: "company_email", value: "compras@chome.cl" })
      .mockResolvedValueOnce({ key: "company_website", value: "www.chome.cl" })

    await expect(getCompanyProfile()).resolves.toEqual({
      name:             "Chome SpA",
      rut:              "76123456-7",
      businessActivity: "Servicios industriales",
      address:          "Av. Principal 457",
      branchAddress:    "Sucursal Concepcion",
      phone:            "+56 9 8765 4321",
      email:            "compras@chome.cl",
      website:          "www.chome.cl",
    })
  })

  it("saves all company profile fields and records audit", async () => {
    mocks.findFirst.mockResolvedValue(null)

    await setCompanyProfile(
      {
        name:             " Chome SpA ",
        rut:              " 76123456-7 ",
        businessActivity: " Servicios industriales ",
        address:          " Av. Principal 457 ",
        branchAddress:    " Sucursal Concepcion ",
        phone:            " +56 9 8765 4321 ",
        email:            " compras@chome.cl ",
        website:          " www.chome.cl ",
      },
      "usr-admin",
      "admin@chome.cl",
    )

    expect(mocks.insert).toHaveBeenCalledTimes(8)
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

describe("system settings emails enabled flag", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("defaults to enabled when the setting is missing", async () => {
    mocks.findFirst.mockResolvedValue(null)
    await expect(getEmailsEnabled()).resolves.toBe(true)
  })

  it("returns false only when explicitly disabled", async () => {
    mocks.findFirst.mockResolvedValueOnce({ key: "emails_enabled", value: "false" })
    await expect(getEmailsEnabled()).resolves.toBe(false)

    mocks.findFirst.mockResolvedValueOnce({ key: "emails_enabled", value: "true" })
    await expect(getEmailsEnabled()).resolves.toBe(true)
  })

  it("persists the flag and records an audit entry", async () => {
    mocks.findFirst.mockResolvedValue(null)

    await setEmailsEnabled(false, "usr-admin", "admin@chome.cl")

    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      key:   "emails_enabled",
      value: "false",
    }))
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action:     "update",
      entityType: "system_setting",
      entityId:   "emails_enabled",
      newState:   { value: false },
    }))
  })
})

describe("system settings pdf max size", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("defaults to 10MB when the setting is missing", async () => {
    mocks.findFirst.mockResolvedValue(null)
    await expect(getPdfMaxSizeMb()).resolves.toBe(10)
  })

  it("defaults to 10MB when the setting is invalid (NaN)", async () => {
    mocks.findFirst.mockResolvedValue({ key: "pdf_max_size_mb", value: "not-a-number" })
    await expect(getPdfMaxSizeMb()).resolves.toBe(10)
  })

  it("returns configured value when valid", async () => {
    mocks.findFirst.mockResolvedValue({ key: "pdf_max_size_mb", value: "25" })
    await expect(getPdfMaxSizeMb()).resolves.toBe(25)
  })

  it("persists the pdf limit and records an audit entry", async () => {
    mocks.findFirst.mockResolvedValue(null)

    await setPdfMaxSizeMb(15, "usr-admin", "admin@chome.cl")

    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      key:   "pdf_max_size_mb",
      value: "15",
    }))
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action:     "update",
      entityType: "system_setting",
      entityId:   "pdf_max_size_mb",
      newState:   { value: 15 },
    }))
  })
})

describe("system settings error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("getPdfMaxSizeMb catches error and returns default", async () => {
    mocks.findFirst.mockRejectedValue(new Error("DB failure"))
    await expect(getPdfMaxSizeMb()).resolves.toBe(10)
  })

  it("getEmailsEnabled catches error and returns default", async () => {
    mocks.findFirst.mockRejectedValue(new Error("DB failure"))
    await expect(getEmailsEnabled()).resolves.toBe(true)
  })

  it("getCompanyProfile catches error and returns default profile", async () => {
    mocks.findFirst.mockRejectedValue(new Error("DB failure"))
    const profile = await getCompanyProfile()
    expect(profile.name).toBe("Servicios Industriales Chome Limitada")
  })
})
