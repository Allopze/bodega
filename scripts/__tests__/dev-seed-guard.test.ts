import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { assertDevSeedTarget, formatDevSeedTarget } from "../dev-seed/guard"

describe("assertDevSeedTarget", () => {
  beforeEach(() => {
    vi.stubEnv("SEED_DEV_ALLOW_DEPLOYED", "")
    vi.stubEnv("DEPLOY_LABEL", "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("acepta una base local terminada en _dev", () => {
    const target = assertDevSeedTarget("postgres://bodega_dev:secreto@127.0.0.1:5433/bodega_dev")
    expect(target.database).toBe("bodega_dev")
    expect(formatDevSeedTarget(target)).toBe("127.0.0.1:5433/bodega_dev")
  })

  it("acepta el socket local y _test/_e2e", () => {
    expect(assertDevSeedTarget("postgres:///bodega_test?host=/var/run/postgresql").database).toBe("bodega_test")
    expect(assertDevSeedTarget("postgres:///bodega_e2e").database).toBe("bodega_e2e")
    expect(formatDevSeedTarget(assertDevSeedTarget("postgres:///bodega_dev"))).toBe("socket local:5432/bodega_dev")
  })

  it("rechaza producción aunque sea local", () => {
    expect(() => assertDevSeedTarget("postgres://bodega:secreto@127.0.0.1:5432/bodega")).toThrow(/producción/)
    expect(() => assertDevSeedTarget("postgres://bodega_prod:secreto@127.0.0.1:5432/bodega_prod")).toThrow(/producción/)
    expect(() => assertDevSeedTarget("postgres://bodega:secreto@127.0.0.1:5432/prod")).toThrow(/producción/)
  })

  it("rechaza hosts remotos", () => {
    expect(() => assertDevSeedTarget("postgres://bodega_dev:secreto@db.example.com:5432/bodega_dev")).toThrow(/no local/)
  })

  it("acepta el host db del compose dev con opt-in explícito", () => {
    vi.stubEnv("SEED_DEV_ALLOW_DEPLOYED", "true")
    vi.stubEnv("DEPLOY_LABEL", "dev")
    expect(assertDevSeedTarget("postgres://bodega_dev:secreto@db:5432/bodega_dev").database).toBe("bodega_dev")
  })

  it("rechaza el host db si el deploy no es dev", () => {
    vi.stubEnv("SEED_DEV_ALLOW_DEPLOYED", "true")
    vi.stubEnv("DEPLOY_LABEL", "producción")
    expect(() => assertDevSeedTarget("postgres://bodega_dev:secreto@db:5432/bodega_dev")).toThrow(/no local/)
  })

  it("rechaza una base de producción aunque el opt-in esté activo", () => {
    vi.stubEnv("SEED_DEV_ALLOW_DEPLOYED", "true")
    vi.stubEnv("DEPLOY_LABEL", "dev")
    expect(() => assertDevSeedTarget("postgres://bodega:secreto@db:5432/bodega")).toThrow(/producción/)
  })

  it("rechaza nombres que no parecen de desarrollo", () => {
    expect(() => assertDevSeedTarget("postgres://127.0.0.1:5432/bodega_clone")).toThrow(/_dev, _test o _e2e/)
  })

  it("rechaza una URL ausente", () => {
    expect(() => assertDevSeedTarget(undefined)).toThrow(/DATABASE_URL es obligatorio/)
  })
})
