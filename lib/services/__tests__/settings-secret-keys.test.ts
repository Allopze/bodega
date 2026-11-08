import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

const { SHARED_KEYRING_SECRET_KEYS } = await import("../settings-secret-keys")
const { CHIPAX_SETTING_KEYS } = await import("@/lib/services/billing/chipax-settings")
const { ONWAY_SETTING_KEYS } = await import("@/lib/integrations/onway/onway-settings")
const { CLOUDREVE_SETTING_KEYS } = await import("@/lib/services/cloudreve/setting-keys")

/**
 * El re-cifrado del llavero sólo re-envuelve lo que está en esta lista. Si una
 * integración renombra una key o suma un secreto y la lista no se entera, ese
 * secreto queda ilegible el día que se retira la clave anterior.
 */
describe("SHARED_KEYRING_SECRET_KEYS", () => {
  it("cubre los secretos de las integraciones que ya existían", () => {
    const registered = new Set<string>(SHARED_KEYRING_SECRET_KEYS)
    for (const key of [
      CHIPAX_SETTING_KEYS.appId,
      CHIPAX_SETTING_KEYS.secretKey,
      ONWAY_SETTING_KEYS.username,
      ONWAY_SETTING_KEYS.password,
      CLOUDREVE_SETTING_KEYS.username,
      CLOUDREVE_SETTING_KEYS.password,
    ]) {
      expect(registered.has(key), key).toBe(true)
    }
  })

  it("no tiene repetidos ni keys del portal DTE (esas se rotan por prefijo)", () => {
    expect(new Set(SHARED_KEYRING_SECRET_KEYS).size).toBe(SHARED_KEYRING_SECRET_KEYS.length)
    expect(SHARED_KEYRING_SECRET_KEYS.some((key) => key.startsWith("dte."))).toBe(false)
  })
})
