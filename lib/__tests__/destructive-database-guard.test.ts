import { describe, expect, it } from "vitest"

import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  getRedactedDatabaseIdentifier,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

describe("destructive database guard", () => {
  it("requires an explicit allow flag before destructive reset", () => {
    expect(() =>
      assertSafeDestructiveDatabase({
        databaseUrl: "postgres:///bodega_e2e",
        allowDestructiveReset: false,
        context: "E2E",
      }),
    ).toThrow(/E2E_ALLOW_DESTRUCTIVE_RESET=true/)
  })

  it("rejects the development database even when reset is explicitly allowed", () => {
    expect(() =>
      assertSafeDestructiveDatabase({
        databaseUrl: "postgres:///bodega",
        allowDestructiveReset: true,
        context: "E2E",
      }),
    ).toThrow(/not disposable/)
  })

  it("rejects non-Postgres connection strings", () => {
    expect(() =>
      assertSafeDestructiveDatabase({
        databaseUrl: "./.tmp/e2e.sqlite",
        allowDestructiveReset: true,
        context: "E2E",
      }),
    ).toThrow(/Postgres/)
  })

  it("accepts clearly disposable Postgres databases", () => {
    expect(() =>
      assertSafeDestructiveDatabase({
        databaseUrl: "postgres://tester:secret@localhost:5432/bodega_capture?sslmode=disable",
        allowDestructiveReset: true,
        context: "CAPTURE",
      }),
    ).not.toThrow()
  })

  it("redacts credentials while preserving the disposable database identifier", () => {
    expect(
      getRedactedDatabaseIdentifier("postgres://tester:secret@localhost:5432/bodega_capture?sslmode=disable"),
    ).toBe("postgres://localhost:5432/bodega_capture")
  })

  it("derives a maintenance URL without losing connection options", () => {
    expect(
      getMaintenanceDatabaseUrl("postgres://tester:secret@localhost:5432/bodega_e2e?sslmode=disable"),
    ).toBe("postgres://tester:secret@localhost:5432/postgres?sslmode=disable")
  })

  it("extracts and quotes database names for create database statements", () => {
    expect(getDatabaseNameFromUrl("postgres:///bodega_e2e")).toBe("bodega_e2e")
    expect(quotePostgresIdentifier('bodega_"e2e')).toBe('"bodega_""e2e"')
  })
})
