import { describe, expect, it } from "vitest"
import { splitSqlStatements } from "@/lib/testing/pglite-migrate"

describe("splitSqlStatements", () => {
  it("splits simple statements separated by semicolons", () => {
    const sql = "SELECT 1;\nSELECT 2;"
    expect(splitSqlStatements(sql)).toEqual(["SELECT 1;", "SELECT 2;"])
  })

  it("does not split inside dollar-quote blocks", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION test_fn()",
      "RETURNS int",
      "LANGUAGE plpgsql",
      "AS $$",
      "BEGIN",
      "  RETURN 1;",
      "END;",
      "$$;",
      "SELECT test_fn();",
    ].join("\n")

    const parts = splitSqlStatements(sql)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain("$$")
    expect(parts[0]).toContain("RETURN 1;")
    expect(parts[0]).toMatch(/;\s*$/)
    expect(parts[1]).toBe("SELECT test_fn();")
  })

  it("handles DO blocks with dollar-quoting", () => {
    const sql = [
      "DO $$",
      "DECLARE",
      "  r record;",
      "BEGIN",
      "  FOR r IN SELECT 1 AS id LOOP",
      "    RAISE NOTICE '%', r.id;",
      "  END LOOP;",
      "END;",
      "$$;",
    ].join("\n")

    const parts = splitSqlStatements(sql)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toContain("DECLARE")
    expect(parts[0]).toContain("RAISE NOTICE")
    expect(parts[0]).toMatch(/;\s*$/)
  })

  it("does not split inside tagged dollar-quotes", () => {
    const sql = [
      "CREATE FUNCTION foo()",
      "RETURNS text",
      "LANGUAGE plpgsql",
      "AS $func$",
      "BEGIN",
      "  RETURN 'hello';",
      "END;",
      "$func$;",
    ].join("\n")

    const parts = splitSqlStatements(sql)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toContain("$func$")
    expect(parts[0]).toContain("RETURN 'hello'")
  })

  it("splits the actual 0014 migration correctly", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION next_document_code(p_prefix text, p_year int)",
      "RETURNS int",
      "LANGUAGE plpgsql",
      "AS $$",
      "DECLARE",
      "  seq_name text;",
      "  next_val int;",
      "BEGIN",
      "  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I AS int MINVALUE 1 NO CYCLE', seq_name);",
      "  EXECUTE format('SELECT nextval(%L)', seq_name) INTO next_val;",
      "  RETURN next_val;",
      "END;",
      "$$;",
      "",
      "DO $$",
      "DECLARE",
      "  r record;",
      "  seq_name text;",
      "BEGIN",
      "  FOR r IN SELECT prefix, year, next_value FROM code_sequences LOOP",
      "    seq_name := 'code_seq_' || lower(r.prefix) || '_' || r.year::text;",
      "  END LOOP;",
      "END;",
      "$$;",
    ].join("\n")

    const parts = splitSqlStatements(sql)
    expect(parts).toHaveLength(2)
    // First statement: CREATE FUNCTION with $$ body
    expect(parts[0]).toMatch(/^CREATE OR REPLACE FUNCTION/)
    expect(parts[0]).toContain("RETURN next_val;")
    expect(parts[0]).toMatch(/;\s*$/)
    // Second statement: DO block
    expect(parts[1]).toMatch(/^DO \$\$/)
    expect(parts[1]).toContain("END LOOP;")
    expect(parts[1]).toMatch(/;\s*$/)
  })
})
