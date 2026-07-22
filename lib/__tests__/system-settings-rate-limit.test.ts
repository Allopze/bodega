import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_OPS_SETTINGS,
  OPS_SETTING_KEYS,
  getOperationalSettings,
} from "@/lib/services/system-settings"

const mockFindFirst = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: {
      systemSettings: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}))

describe("System Settings & Operational Parameters (system-settings.ts)", () => {
  it("exports valid operational parameter keys and default values", () => {
    expect(OPS_SETTING_KEYS.exportMaxRows).toBe("ops.export.max_rows")
    expect(DEFAULT_OPS_SETTINGS.exportMaxRows).toBe(10000)
    expect(DEFAULT_OPS_SETTINGS.pdtpEvidenceMaxMb).toBe(25)
  })

  it("returns default operational settings when DB has no custom records", async () => {
    mockFindFirst.mockResolvedValue(null)

    const settings = await getOperationalSettings()

    expect(settings).toEqual(DEFAULT_OPS_SETTINGS)
  })

  it("clamps operational settings within min-max bounds", async () => {
    // Return an out-of-range value (e.g. 500,000 for exportMaxRows which has max 100,000)
    mockFindFirst.mockResolvedValueOnce({ value: "500000" }) // exportMaxRows -> clamped to 100,000
    mockFindFirst.mockResolvedValueOnce({ value: "1" })      // notificationRetentionDays -> clamped to min 7
    mockFindFirst.mockResolvedValue(null)

    const settings = await getOperationalSettings()

    expect(settings.exportMaxRows).toBe(100_000)
    expect(settings.notificationRetentionDays).toBe(7)
  })
})
