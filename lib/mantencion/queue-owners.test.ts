import { describe, expect, it } from "vitest"
import {
  ownsAnyWorksite, ownsWorksite, resolveOwnedWorksites,
  type OwnedResolution, type QueueDirection, type QueueHolder, type QueueViewer,
} from "./queue-owners"

/**
 * «De quién es esta faena» (brief de «Mis pendientes», §3.3, opción B): la tabla de dirección × quien mira ×
 * cobertura, sin base de datos. Es la regla que impide que la misma fila llegue a tres personas y que el jefe vea los
 * 93 registros de las faenas que ya tienen supervisor.
 */

const BIO = "ws-bio"
const CHO = "ws-cho"
const ARA = "ws-ara"
const ALL = [BIO, CHO, ARA]

const holder = (userId: string, extra: Partial<Omit<QueueHolder, "userId">> = {}): QueueHolder => ({
  userId, responsible: true, isGlobal: false, worksiteIds: [], ...extra,
})
const local = (userId: string, ...worksiteIds: string[]) => holder(userId, { worksiteIds })
const global = (userId: string) => holder(userId, { isGlobal: true })
/** El rol `administrador`: tiene todos los permisos pero no es responsable de nada. */
const admin = (userId = "u-admin") => holder(userId, { responsible: false, isGlobal: true })

const viewerLocal = (userId: string, ...worksiteIds: string[]): QueueViewer => ({ userId, isGlobal: false, worksiteIds, adminOnly: false })
const viewerGlobal = (userId = "u-jefe"): QueueViewer => ({ userId, isGlobal: true, worksiteIds: [], adminOnly: false })
const viewerAdmin = (userId = "u-admin"): QueueViewer => ({ userId, isGlobal: true, worksiteIds: [], adminOnly: true })

const resolve = (viewer: QueueViewer, holders: QueueHolder[], direction: QueueDirection): OwnedResolution =>
  resolveOwnedWorksites({ viewer, holders, direction })
const ownedOf = (resolution: OwnedResolution) => ALL.filter((worksiteId) => ownsWorksite(resolution, worksiteId))

describe("local_first: gana quien está en la faena; el global es el respaldo; el administrador, el último", () => {
  const supBio = local("u-sup-bio", BIO)
  const supCho = local("u-sup-cho", CHO)
  const jefe = global("u-jefe")

  it("el titular local es dueño de sus faenas, haya o no otros", () => {
    for (const holders of [[supBio], [supBio, jefe], [supBio, supCho, jefe, admin()]]) {
      const resolution = resolve(viewerLocal("u-sup-bio", BIO), holders, "local_first")
      expect(resolution).toEqual({ worksites: { kind: "only", worksiteIds: [BIO] }, tier: "primary" })
      expect(ownedOf(resolution)).toEqual([BIO])
    }
  })

  it("dos titulares locales de la misma faena la comparten", () => {
    const otro = local("u-sup-bio-2", BIO)
    expect(ownedOf(resolve(viewerLocal("u-sup-bio", BIO), [supBio, otro, jefe], "local_first"))).toEqual([BIO])
    expect(ownedOf(resolve(viewerLocal("u-sup-bio-2", BIO), [supBio, otro, jefe], "local_first"))).toEqual([BIO])
  })

  it("un titular local sin faenas asignadas no es dueño de nada", () => {
    const resolution = resolve(viewerLocal("u-sin-faena"), [local("u-sin-faena"), jefe], "local_first")
    expect(resolution.worksites).toEqual({ kind: "none" })
    expect(ownsAnyWorksite(resolution)).toBe(false)
  })

  it("el global recibe lo que ningún local cubre, con la marca de respaldo", () => {
    const resolution = resolve(viewerGlobal(), [supBio, supCho, jefe], "local_first")
    expect(resolution).toEqual({ worksites: { kind: "except", worksiteIds: [BIO, CHO] }, tier: "fallback" })
    expect(ownedOf(resolution)).toEqual([ARA])
  })

  it("sin ningún local, el global es dueño de todas", () => {
    const resolution = resolve(viewerGlobal(), [jefe], "local_first")
    expect(ownedOf(resolution)).toEqual(ALL)
    expect(ownsAnyWorksite(resolution)).toBe(true)
  })

  it("los locales del mismo permiso no tapan al global cuando cubren la misma faena dos veces", () => {
    const resolution = resolve(viewerGlobal(), [supBio, local("u-sup-bio-2", BIO), jefe], "local_first")
    expect(resolution.worksites).toEqual({ kind: "except", worksiteIds: [BIO] })
  })

  it("el administrador sólo recibe las faenas que nadie más cubre, y sólo si no hay global", () => {
    // Hay un global: el administrador no recibe nada.
    expect(resolve(viewerAdmin(), [supBio, jefe, admin()], "local_first").worksites).toEqual({ kind: "none" })
    // Sin global: las faenas sin local.
    const resolution = resolve(viewerAdmin(), [supBio, supCho, admin()], "local_first")
    expect(resolution).toEqual({ worksites: { kind: "except", worksiteIds: [BIO, CHO] }, tier: "last_resort" })
    expect(ownedOf(resolution)).toEqual([ARA])
    // Sin nadie más: todas.
    expect(ownedOf(resolve(viewerAdmin(), [admin()], "local_first"))).toEqual(ALL)
  })

  it("el administrador no cuenta como responsable de nadie (no tapa al global ni a los locales)", () => {
    // El rol `administrador` es global y tiene el permiso, pero con `responsible: false` no cuenta como nivel.
    const resolution = resolve(viewerGlobal(), [supBio, admin(), jefe], "local_first")
    expect(resolution.worksites).toEqual({ kind: "except", worksiteIds: [BIO] })
    // Una persona con el rol de administrador Y un permiso directo sí es responsable.
    const conPermisoDirecto = holder("u-admin-directo", { responsible: true, isGlobal: true })
    expect(resolve(viewerAdmin(), [conPermisoDirecto, admin()], "local_first").worksites).toEqual({ kind: "none" })
  })

  it("quien mira no se cuenta a sí mismo como el nivel más cercano", () => {
    // El jefe aparece en la lectura de titulares: su propia cobertura no le quita faenas.
    const resolution = resolve(viewerGlobal("u-jefe"), [jefe, supBio], "local_first")
    expect(resolution.worksites).toEqual({ kind: "except", worksiteIds: [BIO] })
  })
})

describe("global_first: gana el global; los locales sólo si no hay ninguno", () => {
  const supBio = local("u-sup-bio", BIO)
  const adminBio = local("u-admin-bio", BIO)
  const jefe = global("u-jefe")

  it("el global es dueño de todas las faenas, aunque haya locales", () => {
    const resolution = resolve(viewerGlobal(), [supBio, adminBio, jefe], "global_first")
    expect(resolution).toEqual({ worksites: { kind: "all" }, tier: "primary" })
    expect(ownedOf(resolution)).toEqual(ALL)
  })

  it("con un global, el local no recibe nada: la misma nota no llega a tres personas", () => {
    expect(resolve(viewerLocal("u-sup-bio", BIO), [supBio, adminBio, jefe], "global_first").worksites).toEqual({ kind: "none" })
    expect(resolve(viewerLocal("u-admin-bio", BIO), [supBio, adminBio, jefe], "global_first").worksites).toEqual({ kind: "none" })
  })

  it("sin ningún global, los locales reciben sus faenas como respaldo", () => {
    const resolution = resolve(viewerLocal("u-sup-bio", BIO), [supBio, adminBio, admin()], "global_first")
    expect(resolution).toEqual({ worksites: { kind: "only", worksiteIds: [BIO] }, tier: "fallback" })
    expect(ownedOf(resolution)).toEqual([BIO])
  })

  it("el administrador no cuenta como global: si el jefe falta, los locales reciben y el administrador sólo lo huérfano", () => {
    const holders = [supBio, admin()]
    expect(ownedOf(resolve(viewerLocal("u-sup-bio", BIO), holders, "global_first"))).toEqual([BIO])
    // Para el administrador, Biodiversa está cubierta por el supervisor: sólo recibe las demás.
    const resolution = resolve(viewerAdmin(), holders, "global_first")
    expect(resolution.tier).toBe("last_resort")
    expect(ownedOf(resolution)).toEqual([CHO, ARA])
  })

  it("con un global, el administrador no recibe nada", () => {
    expect(resolve(viewerAdmin(), [supBio, jefe, admin()], "global_first").worksites).toEqual({ kind: "none" })
  })
})

describe("la tabla completa: nadie recibe la misma faena por dos niveles a la vez", () => {
  const supBio = local("u-sup-bio", BIO)
  const supCho = local("u-sup-cho", CHO)
  const jefe = global("u-jefe")
  const holders = [supBio, supCho, jefe, admin()]

  it.each<QueueDirection>(["local_first", "global_first"])("%s: cada faena tiene al menos un dueño y no se repite entre niveles", (direction) => {
    const viewers: QueueViewer[] = [
      viewerLocal("u-sup-bio", BIO), viewerLocal("u-sup-cho", CHO), viewerGlobal("u-jefe"), viewerAdmin("u-admin"),
    ]
    const owners = (worksiteId: string) => viewers
      .filter((viewer) => ownsWorksite(resolve(viewer, holders, direction), worksiteId))
      .map((viewer) => viewer.userId)

    for (const worksiteId of ALL) expect(owners(worksiteId).length, `${direction} ${worksiteId}`).toBeGreaterThan(0)
    // local_first: Biodiversa es de su supervisor; Arauco (sin supervisor) cae al jefe. global_first: todo es del jefe.
    if (direction === "local_first") {
      expect(owners(BIO)).toEqual(["u-sup-bio"])
      expect(owners(CHO)).toEqual(["u-sup-cho"])
      expect(owners(ARA)).toEqual(["u-jefe"])
    } else {
      for (const worksiteId of ALL) expect(owners(worksiteId)).toEqual(["u-jefe"])
    }
  })

  it.each<QueueDirection>(["local_first", "global_first"])("%s: sin responsables, la faena es del administrador", (direction) => {
    expect(ownedOf(resolve(viewerAdmin(), [admin()], direction))).toEqual(ALL)
  })
})
