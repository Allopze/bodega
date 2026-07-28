import { describe, it, expect } from "vitest"
import {
  canTransition,
  getDeliveryTargetStatus,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATES,
  type ItemStatus,
} from "../services/item-state"

describe("Item State Machine", () => {
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

    it("allows approved → rejected", () => {
      expect(canTransition("approved", "rejected")).toBe(true)
    })

    it("allows approved → pending_purchase", () => {
      expect(canTransition("approved", "pending_purchase")).toBe(true)
    })

    it("allows approved → postponed", () => {
      expect(canTransition("approved", "postponed")).toBe(true)
    })

    it("allows returned → requested (re-submit)", () => {
      expect(canTransition("returned", "requested")).toBe(true)
    })

    it("allows pending_purchase → in_purchase_order", () => {
      expect(canTransition("pending_purchase", "in_purchase_order")).toBe(true)
    })

    it("allows pending_purchase → postponed", () => {
      expect(canTransition("pending_purchase", "postponed")).toBe(true)
    })

    it("allows in_purchase_order → purchased", () => {
      expect(canTransition("in_purchase_order", "purchased")).toBe(true)
    })

    it("allows in_purchase_order → pending_purchase (back)", () => {
      expect(canTransition("in_purchase_order", "pending_purchase")).toBe(true)
    })

    it("allows purchased → partially_received", () => {
      expect(canTransition("purchased", "partially_received")).toBe(true)
    })

    it("allows purchased → received", () => {
      expect(canTransition("purchased", "received")).toBe(true)
    })

    it("allows partially_received → received", () => {
      expect(canTransition("partially_received", "received")).toBe(true)
    })

    it("allows partially_received → partially_delivered", () => {
      expect(canTransition("partially_received", "partially_delivered")).toBe(true)
    })

    it("allows partially_received → delivered", () => {
      expect(canTransition("partially_received", "delivered")).toBe(true)
    })

    it("allows received → partially_delivered", () => {
      expect(canTransition("received", "partially_delivered")).toBe(true)
    })

    it("allows received → delivered", () => {
      expect(canTransition("received", "delivered")).toBe(true)
    })

    it("allows partially_delivered → delivered", () => {
      expect(canTransition("partially_delivered", "delivered")).toBe(true)
    })

    it("allows postponed → pending_purchase", () => {
      expect(canTransition("postponed", "pending_purchase")).toBe(true)
    })
  })

  describe("terminal states — no transitions out", () => {
    it("rejected cannot transition anywhere", () => {
      for (const target of Object.keys(ALLOWED_TRANSITIONS) as ItemStatus[]) {
        expect(canTransition("rejected" as ItemStatus, target)).toBe(false)
      }
    })

    it("delivered cannot transition anywhere", () => {
      for (const target of Object.keys(ALLOWED_TRANSITIONS) as ItemStatus[]) {
        expect(canTransition("delivered" as ItemStatus, target)).toBe(false)
      }
    })

    it("postponed cannot transition anywhere except pending_purchase", () => {
      expect(canTransition("postponed", "pending_purchase")).toBe(true)
      for (const target of Object.keys(ALLOWED_TRANSITIONS) as ItemStatus[]) {
        if (target === "pending_purchase") continue
        expect(canTransition("postponed" as ItemStatus, target)).toBe(false)
      }
    })
  })

  describe("no backward transitions where forbidden", () => {
    it("requested cannot go back to draft", () => {
      expect(canTransition("requested", "draft")).toBe(false)
    })

    it("approved cannot go back to requested", () => {
      expect(canTransition("approved", "requested")).toBe(false)
    })

    it("received cannot go back to purchased", () => {
      expect(canTransition("received", "purchased")).toBe(false)
    })

    it("delivered cannot go back to received", () => {
      expect(canTransition("delivered", "received")).toBe(false)
    })
  })

  describe("ALLOWED_TRANSITIONS completeness", () => {
    const allStates: ItemStatus[] = [
      "draft", "requested", "approved", "rejected", "returned",
      "postponed", "pending_purchase", "in_purchase_order", "purchased",
      "partially_received", "received", "partially_delivered", "delivered",
    ]

    it("every state has a defined transition list", () => {
      for (const state of allStates) {
        expect(ALLOWED_TRANSITIONS[state]).toBeDefined()
      }
    })

    it("ALLOWED_TRANSITIONS only references valid states", () => {
      for (const targets of Object.values(ALLOWED_TRANSITIONS)) {
        for (const target of targets) {
          expect(allStates).toContain(target)
        }
      }
    })
  })

  describe("terminal states registry", () => {
    it("TERMINAL_STATES matches states with empty transition lists", () => {
      const computedTerminal = (Object.keys(ALLOWED_TRANSITIONS) as ItemStatus[])
        .filter((s) => ALLOWED_TRANSITIONS[s].length === 0)
      expect(new Set(TERMINAL_STATES)).toEqual(new Set(computedTerminal))
    })
  })

  describe("getDeliveryTargetStatus", () => {
    it("returns 'delivered' when totalDelivered equals or exceeds itemQuantity", () => {
      expect(getDeliveryTargetStatus(10, 10)).toBe("delivered")
      expect(getDeliveryTargetStatus(10, 15)).toBe("delivered")
    })

    it("returns 'partially_delivered' when totalDelivered is less than itemQuantity", () => {
      expect(getDeliveryTargetStatus(10, 5)).toBe("partially_delivered")
    })

    it("returns 'delivered' when totalDelivered is undefined", () => {
      expect(getDeliveryTargetStatus(10)).toBe("delivered")
    })
  })
})
