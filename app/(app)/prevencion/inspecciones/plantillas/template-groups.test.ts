import { describe, expect, it } from "vitest"
import { countHiddenVersions, groupTemplatesByInstrument } from "./template-groups"

const t = (id: string, code: string, status: string) => ({ id, code, status })

describe("groupTemplatesByInstrument", () => {
  it("una fila por instrumento: la aprobada es la principal y las reemplazadas no aparecen", () => {
    const groups = groupTemplatesByInstrument([
      t("c-v3", "contenedores", "approved"),
      t("c-v2", "contenedores", "superseded"),
      t("c-v1", "contenedores", "superseded"),
      t("e-v1", "extintores", "approved"),
    ])
    expect(groups.map((group) => [group.primary.id, group.pendingDraft])).toEqual([["c-v3", null], ["e-v1", null]])
  })

  it("un borrador nuevo convive con la aprobada como subfila, no como otra fila principal", () => {
    const groups = groupTemplatesByInstrument([
      t("c-v4", "contenedores", "draft"),
      t("c-v3", "contenedores", "approved"),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: "contenedores", primary: { id: "c-v3" }, pendingDraft: { id: "c-v4" } })
  })

  it("sin aprobada, el último borrador es la fila principal y no hay subfila", () => {
    const groups = groupTemplatesByInstrument([
      t("c-v2", "contenedores", "draft"),
      t("c-v1", "contenedores", "draft"),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ primary: { id: "c-v2" }, pendingDraft: null })
  })

  it("con varios borradores junto a una aprobada, la subfila es el más reciente", () => {
    const [group] = groupTemplatesByInstrument([
      t("c-v5", "contenedores", "draft"),
      t("c-v4", "contenedores", "draft"),
      t("c-v3", "contenedores", "approved"),
    ])
    expect(group!.pendingDraft!.id).toBe("c-v5")
  })

  it("un instrumento que sólo tiene versiones reemplazadas o retiradas no tiene fila", () => {
    expect(groupTemplatesByInstrument([t("x-v1", "x", "superseded")])).toEqual([])
  })

  it("conserva el orden de los instrumentos tal como llegan", () => {
    const groups = groupTemplatesByInstrument([
      t("a1", "a", "approved"),
      t("b1", "b", "draft"),
      t("c1", "c", "approved"),
    ])
    expect(groups.map((group) => group.key)).toEqual(["a", "b", "c"])
  })

  describe("con un estado pedido la lista es plana", () => {
    const all = [
      t("c-v4", "contenedores", "draft"),
      t("c-v3", "contenedores", "approved"),
      t("c-v2", "contenedores", "superseded"),
      t("c-v1", "contenedores", "superseded"),
    ]

    it("estado=superseded lista cada versión reemplazada o retirada, sin agrupar", () => {
      const groups = groupTemplatesByInstrument(all, "superseded")
      expect(groups.map((group) => group.primary.id)).toEqual(["c-v2", "c-v1"])
      expect(groups.every((group) => group.pendingDraft === null)).toBe(true)
    })

    it("estado=draft lista los borradores y no los esconde bajo una aprobada", () => {
      expect(groupTemplatesByInstrument(all, "draft").map((group) => group.primary.id)).toEqual(["c-v4"])
    })

    it("estado=approved lista sólo las aprobadas, sin subfila de borrador", () => {
      const groups = groupTemplatesByInstrument(all, "approved")
      expect(groups.map((group) => group.primary.id)).toEqual(["c-v3"])
      expect(groups[0]!.pendingDraft).toBeNull()
    })
  })

  it("countHiddenVersions cuenta lo que la tabla deja fuera sólo en la vista agrupada", () => {
    const all = [t("a", "x", "approved"), t("b", "x", "superseded"), t("c", "y", "superseded")]
    expect(countHiddenVersions(all, "all")).toBe(2)
    expect(countHiddenVersions(all, "superseded")).toBe(0)
  })
})
