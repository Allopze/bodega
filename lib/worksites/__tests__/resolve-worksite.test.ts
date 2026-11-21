import { describe, expect, it } from "vitest"
import { resolveWorksiteId, worksiteAliasKey } from "../resolve-worksite"

const sites = [
  { id: "bio", name: "Biodiversa" },
  { id: "cho", name: "Cholguan - Arauco" },
  { id: "ara", name: "Arauco" },
  { id: "pac", name: "Pacifico" },
]
const aliases = [
  { worksiteId: "ara", aliasKey: worksiteAliasKey("Horcones") },
  { worksiteId: "cho", aliasKey: worksiteAliasKey("CHOLGUAN") },
  { worksiteId: "pac", aliasKey: worksiteAliasKey("Mininco") },
]

describe("resolveWorksiteId", () => {
  it("resuelve el nombre exacto sin tildes ni mayúsculas", () => {
    expect(resolveWorksiteId("BIODIVERSA", sites, aliases)).toBe("bio")
    expect(resolveWorksiteId("Pacífico", sites, aliases)).toBe("pac")
  })

  it("resuelve por alias", () => {
    expect(resolveWorksiteId("HORCONES", sites, aliases)).toBe("ara")
    expect(resolveWorksiteId("Cholguán", sites, aliases)).toBe("cho")
    expect(resolveWorksiteId("MININCO", sites, aliases)).toBe("pac")
  })

  it("el nombre exacto gana al alias", () => {
    const withConflict = [...aliases, { worksiteId: "pac", aliasKey: worksiteAliasKey("Arauco") }]
    expect(resolveWorksiteId("Arauco", sites, withConflict)).toBe("ara")
  })

  it("no adivina", () => {
    expect(resolveWorksiteId("ENAP", sites, aliases)).toBeNull()
    expect(resolveWorksiteId("Cholguan Residuos", sites, aliases)).toBeNull()
    expect(resolveWorksiteId("", sites, aliases)).toBeNull()
    expect(resolveWorksiteId(null, sites, aliases)).toBeNull()
  })

  it("dos faenas con el mismo nombre no se resuelven", () => {
    expect(resolveWorksiteId("Arauco", [...sites, { id: "ara2", name: "ARAUCO" }], aliases)).toBeNull()
  })

  it("un alias a una faena que ya no está en la lista no resuelve", () => {
    expect(resolveWorksiteId("Horcones", sites.filter((site) => site.id !== "ara"), aliases)).toBeNull()
  })
})
