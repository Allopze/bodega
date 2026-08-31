import { describe, expect, it } from "vitest"
import { resolveTrustedClientIp } from "@/lib/security/login-rate-limit-ip"

describe("resolveTrustedClientIp", () => {
  it("ignora X-Forwarded-For manipulable al limitar intentos de inicio de sesión", () => {
    const firstAttempt = new Headers({
      "cf-connecting-ip": "198.51.100.24",
      "x-forwarded-for": "10.0.0.1",
    })
    const rotatedAttempt = new Headers({
      "cf-connecting-ip": "198.51.100.24",
      "x-forwarded-for": "10.0.0.2",
    })

    expect(resolveTrustedClientIp(firstAttempt)).toBe("198.51.100.24")
    expect(resolveTrustedClientIp(rotatedAttempt)).toBe("198.51.100.24")
  })

  it("no usa X-Forwarded-For como fallback cuando falta la identidad de Cloudflare", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.17" })

    expect(resolveTrustedClientIp(headers)).toBe("unresolved")
  })

  it("rechaza un CF-Connecting-IP que no contiene una dirección IP individual", () => {
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.17, 198.51.100.4" })

    expect(resolveTrustedClientIp(headers)).toBe("unresolved")
  })

  it("falla cerrado ante una subsolicitud Worker que puede alterar x-real-ip", () => {
    const headers = new Headers({
      "cf-connecting-ip": "198.51.100.24",
      "x-real-ip": "10.0.0.4",
    })

    expect(resolveTrustedClientIp(headers)).toBe("unresolved")
  })

  it("prefiere el IPv6 real cuando Cloudflare sobrescribe la cabecera con Pseudo IPv4", () => {
    const headers = new Headers({
      "cf-connecting-ip": "240.0.0.4",
      "cf-connecting-ipv6": "2001:db8:1234::4",
    })

    expect(resolveTrustedClientIp(headers)).toBe("2001:db8:1234::4")
  })

  it("no acepta CF-Connecting-IPv6 fuera del modo Pseudo IPv4", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.24",
      "cf-connecting-ipv6": "2001:db8::24",
    })

    expect(resolveTrustedClientIp(headers)).toBe("203.0.113.24")
  })

  it("no confía en la IP centinela de subsolicitudes Worker cross-zone", () => {
    const headers = new Headers({
      "cf-connecting-ip": "2a06:98c0:3600::103",
    })

    expect(resolveTrustedClientIp(headers)).toBe("unresolved")
  })
})
