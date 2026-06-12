import { describe, expect, it } from "vitest"
import { formatDate, formatDateTime } from "@/lib/utils"

describe("formatting helpers", () => {
  it("formats plain ISO dates without shifting the day by timezone", () => {
    expect(formatDate("2026-06-11")).toBe("11-06-2026")
  })

  it("formats datetimes without locale-dependent AM/PM whitespace", () => {
    expect(formatDateTime("2026-06-10T21:14:00.000Z")).toMatch(
      /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/,
    )
  })
})
