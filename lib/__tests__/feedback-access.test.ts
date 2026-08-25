import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import {
  canAccessFeedbackIndex,
  canAccessFeedbackReport,
} from "@/lib/services/feedback-access"

function sessionWith(permissions: string[], userId = "user-1"): Session {
  return {
    expires: "9999-12-31",
    user: { id: userId, permissions, roles: [], worksiteIds: [], isGlobal: false },
  } as unknown as Session
}

describe("feedback access", () => {
  it.each([
    ["feedback:view_own"],
    ["feedback:view_all"],
    ["feedback:manage"],
  ])("allows %s into the support index", (permission) => {
    expect(canAccessFeedbackIndex(sessionWith([permission]))).toBe(true)
  })

  it("limits feedback:view_own to reports created by the current user", () => {
    const session = sessionWith(["feedback:view_own"])

    expect(canAccessFeedbackReport(session, { createdBy: "user-1" })).toBe(true)
    expect(canAccessFeedbackReport(session, { createdBy: "user-2" })).toBe(false)
  })

  it.each(["feedback:view_all", "feedback:manage"])("allows %s to read reports from other users", (permission) => {
    expect(canAccessFeedbackReport(sessionWith([permission]), { createdBy: "user-2" })).toBe(true)
  })
})
