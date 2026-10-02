import { describe, expect, it } from "vitest"
import { sumIncomingByStock } from "@/lib/services/stock-availability"

describe("sumIncomingByStock", () => {
  it("counts what each approved item still lacks at the final worksite", () => {
    expect(sumIncomingByStock([
      { worksiteId: "ws-1", productId: "p-1", quantity: 10, receivedAtFaena: 4 },
    ])).toEqual([
      { worksiteId: "ws-1", productId: "p-1", incoming: 6 },
    ])
  })

  it("adds up every pending item of the same worksite and product", () => {
    expect(sumIncomingByStock([
      { worksiteId: "ws-1", productId: "p-1", quantity: 10, receivedAtFaena: 4 },
      { worksiteId: "ws-1", productId: "p-1", quantity: 2, receivedAtFaena: 0 },
      { worksiteId: "ws-2", productId: "p-1", quantity: 5, receivedAtFaena: 0 },
    ])).toEqual([
      { worksiteId: "ws-1", productId: "p-1", incoming: 8 },
      { worksiteId: "ws-2", productId: "p-1", incoming: 5 },
    ])
  })

  it("never lets an over-received item offset what another item still lacks", () => {
    expect(sumIncomingByStock([
      { worksiteId: "ws-1", productId: "p-1", quantity: 3, receivedAtFaena: 5 },
      { worksiteId: "ws-1", productId: "p-1", quantity: 4, receivedAtFaena: 0 },
    ])).toEqual([
      { worksiteId: "ws-1", productId: "p-1", incoming: 4 },
    ])
  })
})
