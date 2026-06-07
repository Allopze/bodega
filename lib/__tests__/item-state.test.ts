/**
 * Unit tests for the item state machine.
 * These are pure tests against ALLOWED_TRANSITIONS and canTransition —
 * no database calls, no Next.js context required.
 */

import { describe, it, expect } from "vitest"
import {
  ALLOWED_TRANSITIONS,
  TERMINAL_STATES,
  canTransition,
  type ItemStatus,
} from "@/lib/services/item-state"

const ALL_STATES: ItemStatus[] = [
  "draft", "requested", "approved", "rejected", "returned", "postponed",
  "pending_purchase", "in_purchase_order", "purchased",
  "partially_received", "received", "partially_delivered", "delivered",
]

describe("ALLOWED_TRANSITIONS", () => {
  it("covers every ItemStatus key", () => {
    for (const state of ALL_STATES) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(state)
    }
  })

  it("has no unknown states as transition targets", () => {
    const validSet = new Set<string>(ALL_STATES)
    for (const [, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const t of targets) {
        expect(validSet.has(t), `Unknown target state: "${t}"`).toBe(true)
      }
    }
  })
})

describe("TERMINAL_STATES", () => {
  it("rejected and delivered have no outbound transitions (hard terminal)", () => {
    // rejected and delivered are truly terminal — no transitions allowed.
    // Note: postponed is in TERMINAL_STATES but CAN transition to pending_purchase
    // (it represents a soft pause, not a permanent end state).
    const hardTerminal: ItemStatus[] = ["rejected", "delivered"]
    for (const state of hardTerminal) {
      expect(TERMINAL_STATES).toContain(state)
      const targets = ALLOWED_TRANSITIONS[state] ?? []
      expect(targets, `State "${state}" should have no outbound transitions`).toHaveLength(0)
    }
  })

  it("postponed can transition to pending_purchase (soft pause, not hard terminal)", () => {
    // This documents the intentional design: postponed items can be un-postponed.
    expect(canTransition("postponed", "pending_purchase")).toBe(true)
  })
})

describe("canTransition", () => {
  it("allows draft → requested", () => {
    expect(canTransition("draft", "requested")).toBe(true)
  })

  it("allows requested → approved", () => {
    expect(canTransition("requested", "approved")).toBe(true)
  })

  it("allows requested → rejected", () => {
    expect(canTransition("requested", "rejected")).toBe(true)
  })

  it("allows requested → returned", () => {
    expect(canTransition("requested", "returned")).toBe(true)
  })

  it("allows approved → pending_purchase", () => {
    expect(canTransition("approved", "pending_purchase")).toBe(true)
  })

  it("allows pending_purchase → in_purchase_order", () => {
    expect(canTransition("pending_purchase", "in_purchase_order")).toBe(true)
  })

  it("allows in_purchase_order → purchased", () => {
    expect(canTransition("in_purchase_order", "purchased")).toBe(true)
  })

  it("allows purchased → partially_received", () => {
    expect(canTransition("purchased", "partially_received")).toBe(true)
  })

  it("allows purchased → received", () => {
    expect(canTransition("purchased", "received")).toBe(true)
  })

  it("allows received → delivered", () => {
    expect(canTransition("received", "delivered")).toBe(true)
  })

  it("allows returned → requested (re-submission)", () => {
    expect(canTransition("returned", "requested")).toBe(true)
  })

  it("allows postponed → pending_purchase (un-postpone)", () => {
    expect(canTransition("postponed", "pending_purchase")).toBe(true)
  })

  // ── Disallowed transitions ──────────────────────────────────────────────

  it("disallows draft → approved (must go through requested)", () => {
    expect(canTransition("draft", "approved")).toBe(false)
  })

  it("disallows delivered → any other state (terminal)", () => {
    for (const state of ALL_STATES) {
      expect(canTransition("delivered", state as ItemStatus)).toBe(false)
    }
  })

  it("disallows rejected → any other state (terminal)", () => {
    for (const state of ALL_STATES) {
      expect(canTransition("rejected", state as ItemStatus)).toBe(false)
    }
  })

  it("disallows received → draft (going backwards)", () => {
    expect(canTransition("received", "draft")).toBe(false)
  })

  it("disallows approved → draft (going backwards)", () => {
    expect(canTransition("approved", "draft")).toBe(false)
  })

  it("handles unknown states gracefully (returns false)", () => {
    expect(canTransition("unknown_state" as ItemStatus, "draft")).toBe(false)
    expect(canTransition("draft", "unknown_state" as ItemStatus)).toBe(false)
  })
})

describe("Full lifecycle — happy path", () => {
  const happyPath: ItemStatus[] = [
    "draft", "requested", "approved", "pending_purchase",
    "in_purchase_order", "purchased", "received", "delivered",
  ]

  it("every consecutive pair in the happy path is a valid transition", () => {
    for (let i = 0; i < happyPath.length - 1; i++) {
      const from = happyPath[i]
      const to   = happyPath[i + 1]
      expect(
        canTransition(from, to),
        `Expected ${from} → ${to} to be valid`,
      ).toBe(true)
    }
  })
})

describe("Partial receipt path", () => {
  it("purchased → partially_received → received → delivered is valid", () => {
    const path: ItemStatus[] = ["purchased", "partially_received", "received", "delivered"]
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true)
    }
  })
})
