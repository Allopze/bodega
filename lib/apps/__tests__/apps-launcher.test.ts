import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { getLauncherApps, groupLauncherApps } from "../launcher"

function session(permissions: string[], roles: string[] = []): Session {
  return { user: { id: "u1", name: "QA", email: "qa@example.com", permissions, roles }, expires: "2099-01-01" } as unknown as Session
}

describe("lanzador de apps", () => {
  it("sólo muestra apps con alguna pantalla visible", () => {
    const apps = getLauncherApps(session(["ti:view", "requests:view_own"]))
    const ids = apps.map((app) => app.id)
    expect(ids).toContain("ti")
    expect(ids).toContain("requests")
    expect(ids).not.toContain("combustibles")
    expect(ids).not.toContain("admin")
  })

  it("respeta los módulos apagados", () => {
    const apps = getLauncherApps(session(["ti:view"]), new Set(["requests"]))
    expect(apps.map((app) => app.id)).not.toContain("ti")
  })

  it("entra por la primera pantalla visible si la portada no lo es", () => {
    const all = getLauncherApps(session(["ti:view"]))
    expect(all.find((app) => app.id === "ti")?.href).toBe("/ti")
    const withoutSummary = getLauncherApps(session(["ti:view"]), undefined, new Set(["/ti"]))
    expect(withoutSummary.find((app) => app.id === "ti")?.href).toBe("/ti/reportes")
  })

  it("agrupa por área sin partir un área en dos bloques", () => {
    const groups = groupLauncherApps(getLauncherApps(session(["ti:view", "requests:view_own", "purchasing:view", "combustibles:view"])))
    const areaIds = groups.map((group) => group.areaId)
    expect(new Set(areaIds).size).toBe(areaIds.length)
  })

  it("junta en «Otras apps» las áreas cuya única app se llama igual", () => {
    const groups = groupLauncherApps(getLauncherApps(session(["ti:view", "requests:view_own"])))
    expect(groups.map((group) => group.areaLabel)).toEqual(["Adquisiciones", "Otras apps"])
    expect(groups.at(-1)?.apps.map((app) => app.id)).toEqual(["ti"])
  })
})
