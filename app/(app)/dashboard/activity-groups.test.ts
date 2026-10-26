import { describe, expect, it } from "vitest"
import type { OperationalActivityEntry } from "@/lib/services/operational-activity"
import { groupConsecutiveActivity } from "./activity-groups"

function entry(id: string, over: Partial<OperationalActivityEntry> = {}): OperationalActivityEntry {
  return {
    id,
    module: "pdtp",
    actionLabel: "Obligación PDTP reportada",
    entityCode: null,
    worksiteName: "Masisa",
    actorName: "Alejandro López",
    occurredAt: "2026-10-20T17:24:00.000Z",
    href: "/prevencion/pdtp",
    ...over,
  }
}

describe("groupConsecutiveActivity", () => {
  it("sin movimientos no hay grupos", () => {
    expect(groupConsecutiveActivity([])).toEqual([])
  })

  it("un movimiento suelto queda como grupo de uno", () => {
    const [group] = groupConsecutiveActivity([entry("a")])

    expect(group).toMatchObject({ id: "a", count: 1, ids: ["a"] })
  })

  it("junta los consecutivos idénticos, cuenta y conserva todos los ids", () => {
    const groups = groupConsecutiveActivity([entry("a"), entry("b"), entry("c")])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ count: 3, ids: ["a", "b", "c"] })
  })

  it("el grupo conserva los datos del primero, que es el más reciente", () => {
    const [group] = groupConsecutiveActivity([
      entry("a", { occurredAt: "2026-10-20T18:00:00.000Z", href: "/uno" }),
      entry("b", { occurredAt: "2026-10-20T17:00:00.000Z", href: "/dos" }),
    ])

    expect(group?.id).toBe("a")
    expect(group?.occurredAt).toBe("2026-10-20T18:00:00.000Z")
    expect(group?.href).toBe("/uno")
  })

  it("otro autor corta el grupo", () => {
    const groups = groupConsecutiveActivity([entry("a"), entry("b", { actorName: "Otra Persona" }), entry("c")])

    expect(groups.map((group) => group.count)).toEqual([1, 1, 1])
  })

  it("otra faena corta el grupo", () => {
    const groups = groupConsecutiveActivity([entry("a"), entry("b", { worksiteName: "Teno" })])

    expect(groups).toHaveLength(2)
  })

  it("otra acción corta el grupo", () => {
    const groups = groupConsecutiveActivity([entry("a"), entry("b", { actionLabel: "Recepción registrada" })])

    expect(groups).toHaveLength(2)
  })

  // Sólo lo contiguo se funde: A, B, A son tres renglones, no dos.
  it("no junta lo igual que no es contiguo", () => {
    const groups = groupConsecutiveActivity([
      entry("a"),
      entry("b", { actionLabel: "Recepción registrada" }),
      entry("c"),
    ])

    expect(groups.map((group) => group.ids)).toEqual([["a"], ["b"], ["c"]])
  })

  it("dos movimientos sin autor conocido sí son del mismo autor", () => {
    const groups = groupConsecutiveActivity([entry("a", { actorName: null }), entry("b", { actorName: null })])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.count).toBe(2)
  })

  it("no muta la lista que recibe", () => {
    const entries = [entry("a"), entry("b")]
    groupConsecutiveActivity(entries)

    expect(entries.map((item) => item.id)).toEqual(["a", "b"])
    expect(entries[0]).not.toHaveProperty("count")
  })

  it("marca si todos los movimientos del grupo llevan al mismo destino", () => {
    const [mismo] = groupConsecutiveActivity([entry("a"), entry("b")])
    const [distinto] = groupConsecutiveActivity([entry("a", { href: "/x/1" }), entry("b", { href: "/x/2" })])

    expect(mismo?.sameTarget).toBe(true)
    // El grupo enlaza al más reciente; el renglón tiene que decir que es sólo ése.
    expect(distinto).toMatchObject({ href: "/x/1", sameTarget: false, count: 2 })
  })
})
