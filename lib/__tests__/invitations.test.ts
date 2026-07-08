import { describe, expect, it } from "vitest"

import {
  buildInvitationUrl,
  getInvitationStatus,
  isInvitationUsable,
  parseInvitationJson,
} from "@/lib/auth/invitations"

describe("invitation helpers", () => {
  const now = new Date("2026-07-08T12:00:00.000Z")
  const future = new Date("2026-07-08T12:01:00.000Z").toISOString()
  const past = new Date("2026-07-08T11:59:00.000Z").toISOString()

  it("derives pending status before expiry", () => {
    const invitation = {
      acceptedAt: null,
      cancelledAt: null,
      replacedAt: null,
      expiresAt: future,
    }

    expect(getInvitationStatus(invitation, now)).toBe("pending")
    expect(isInvitationUsable(invitation, now)).toBe(true)
  })

  it("prioritizes accepted, cancelled, replaced, then expired", () => {
    expect(
      getInvitationStatus({
        acceptedAt: future,
        cancelledAt: future,
        replacedAt: future,
        expiresAt: past,
      }, now),
    ).toBe("accepted")
    expect(
      getInvitationStatus({
        acceptedAt: null,
        cancelledAt: future,
        replacedAt: future,
        expiresAt: past,
      }, now),
    ).toBe("cancelled")
    expect(
      getInvitationStatus({
        acceptedAt: null,
        cancelledAt: null,
        replacedAt: future,
        expiresAt: past,
      }, now),
    ).toBe("replaced")
    expect(
      getInvitationStatus({
        acceptedAt: null,
        cancelledAt: null,
        replacedAt: null,
        expiresAt: past,
      }, now),
    ).toBe("expired")
  })

  it("returns a fallback array for invalid JSON", () => {
    expect(parseInvitationJson<string[]>("not-json", ["fallback"])).toEqual(["fallback"])
  })

  it("builds registro invitation URLs", () => {
    expect(buildInvitationUrl("https://app.chome.cl", "abc 123")).toBe(
      "https://app.chome.cl/registro?token=abc%20123",
    )
    expect(buildInvitationUrl("https://app.chome.cl/", "abc 123")).toBe(
      "https://app.chome.cl/registro?token=abc%20123",
    )
  })
})
