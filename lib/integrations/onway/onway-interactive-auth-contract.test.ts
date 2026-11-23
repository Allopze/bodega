import { describe, expect, it } from "vitest"
import {
  ONWAY_CHALLENGE_TTL_MS,
  isAllowedOnwayChallengeNavigation,
  isOnwayChallengeSolvedUrl,
  onwayChallengeRemainingMs,
  parseOnwayChallengeInput,
} from "./onway-interactive-auth-contract"

const viewport = { width: 1_280, height: 720 }

describe("parseOnwayChallengeInput", () => {
  it("convierte coordenadas normalizadas a píxeles del viewport y las acota", () => {
    expect(parseOnwayChallengeInput({ kind: "down", x: 0.5, y: 0.25 }, viewport))
      .toEqual({ kind: "down", x: 640, y: 180 })
    expect(parseOnwayChallengeInput({ kind: "up", x: -1, y: 2 }, viewport))
      .toEqual({ kind: "up", x: 0, y: 719 })
  })

  it("rechaza coordenadas no finitas, tipos desconocidos y un viewport inválido", () => {
    expect(parseOnwayChallengeInput({ kind: "move", x: Number.NaN, y: 0 }, viewport)).toBeNull()
    expect(parseOnwayChallengeInput({ kind: "click", x: 0, y: 0 }, viewport)).toBeNull()
    expect(parseOnwayChallengeInput({ kind: "move", x: 0, y: 0 }, { width: 0, height: 720 })).toBeNull()
    expect(parseOnwayChallengeInput(null, viewport)).toBeNull()
  })

  it("acepta texto imprimible y teclas de la lista; rechaza controles y atajos", () => {
    expect(parseOnwayChallengeInput({ kind: "text", text: "123456" }, viewport))
      .toEqual({ kind: "text", text: "123456" })
    expect(parseOnwayChallengeInput({ kind: "text", text: "\u0007" }, viewport)).toBeNull()
    expect(parseOnwayChallengeInput({ kind: "text", text: "x".repeat(201) }, viewport)).toBeNull()
    expect(parseOnwayChallengeInput({ kind: "key", key: "Enter" }, viewport))
      .toEqual({ kind: "key", key: "Enter" })
    expect(parseOnwayChallengeInput({ kind: "key", key: "Control+V" }, viewport)).toBeNull()
  })
})

describe("isOnwayChallengeSolvedUrl", () => {
  it("cualquier página autenticada del portal cuenta como resuelta; el login y otros orígenes no", () => {
    expect(isOnwayChallengeSolvedUrl("https://onway.enteldigital.cl/OnlineTracking/Index/es")).toBe(true)
    expect(isOnwayChallengeSolvedUrl("https://onway.enteldigital.cl/")).toBe(true)
    expect(isOnwayChallengeSolvedUrl("https://onway.enteldigital.cl/home/login")).toBe(false)
    expect(isOnwayChallengeSolvedUrl("https://onway.enteldigital.cl.evil.example/OnlineTracking/Index/es")).toBe(false)
    expect(isOnwayChallengeSolvedUrl("no-es-url")).toBe(false)
  })
})

describe("navegación permitida y vencimiento", () => {
  it("el marco principal sólo puede ir al portal o al tenant exacto de Auth0", () => {
    expect(isAllowedOnwayChallengeNavigation("https://onway.enteldigital.cl/OnlineTracking/Index/es")).toBe(true)
    expect(isAllowedOnwayChallengeNavigation("https://lw-fleet-entel-cl.us.auth0.com/u/login")).toBe(true)
    expect(isAllowedOnwayChallengeNavigation("https://lw-fleet-entel-cl.us.auth0.com.evil.example/u/login")).toBe(false)
    expect(isAllowedOnwayChallengeNavigation("https://evil.example/")).toBe(false)
  })

  it("el reloj del desafío sólo corre mientras espera a la persona", () => {
    expect(ONWAY_CHALLENGE_TTL_MS).toBeGreaterThan(60_000)
    expect(onwayChallengeRemainingMs(10_000, "awaiting", 9_000)).toBe(1_000)
    expect(onwayChallengeRemainingMs(10_000, "awaiting", 11_000)).toBe(0)
    expect(onwayChallengeRemainingMs(10_000, "solved", 0)).toBe(0)
  })
})
