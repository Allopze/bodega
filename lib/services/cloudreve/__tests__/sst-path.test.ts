import { describe, expect, it } from "vitest"
import {
  ARCHIVED_PREFIX,
  DEFAULT_SST_PATH,
  normalizeCloudreveSstPath,
  remoteSegment,
  remoteSstKey,
  sstLogicalName,
  sstLogicalSegments,
  sstPrefixReplace,
  sstRelativePath,
} from "@/lib/services/cloudreve/sst-path"

describe("sstLogicalSegments", () => {
  it("divide el path lógico anidado en segmentos", () => {
    expect(sstLogicalSegments("storage/sst-documents/Procedimientos/abc.pdf"))
      .toEqual(["Procedimientos", "abc.pdf"])
    expect(sstLogicalSegments("storage/sst-documents/a/b/c.pdf"))
      .toEqual(["a", "b", "c.pdf"])
  })

  it("rechaza rutas fuera del espacio SST", () => {
    expect(() => sstLogicalSegments("storage/flota/x.pdf")).toThrow(/fuera del espacio/)
  })

  it("rechaza traversal y segmentos inválidos", () => {
    expect(() => sstLogicalSegments("storage/sst-documents/../x.pdf")).toThrow(/inválido/)
    expect(() => sstLogicalSegments("storage/sst-documents/")).toThrow(/inválido/)
    expect(() => sstLogicalSegments("storage/sst-documents/a//b.pdf")).toThrow(/inválido/)
    expect(() => sstLogicalSegments("storage/sst-documents/a\\b.pdf")).toThrow(/inválido/)
  })
})

describe("sstLogicalName", () => {
  it("devuelve el último segmento (el nombre de archivo)", () => {
    expect(sstLogicalName("storage/sst-documents/abc.pdf")).toBe("abc.pdf")
    expect(sstLogicalName("storage/sst-documents/Procedimientos/abc.pdf")).toBe("abc.pdf")
  })
})

describe("remoteSegment", () => {
  it("sanea separadores y control chars", () => {
    expect(remoteSegment("Procedimientos de Trabajo")).toBe("Procedimientos de Trabajo")
    expect(remoteSegment("a/b\\c")).toBe("a-b-c")
    expect(remoteSegment("  nombre  ")).toBe("nombre")
    expect(remoteSegment("")).toBe("carpeta")
  })
})

describe("normalizeCloudreveSstPath", () => {
  it("usa el default cuando la variable no está definida (cuenta sin acotar)", () => {
    expect(normalizeCloudreveSstPath(undefined)).toBe(DEFAULT_SST_PATH)
    expect(normalizeCloudreveSstPath(null)).toBe(DEFAULT_SST_PATH)
  })

  it("mapea '/' y '' a la raíz de la cuenta (cuenta WebDAV acotada)", () => {
    expect(normalizeCloudreveSstPath("/")).toBe("")
    expect(normalizeCloudreveSstPath("")).toBe("")
  })

  it("normaliza slashes de los bordes y preserva mayúsculas/espacios", () => {
    expect(normalizeCloudreveSstPath("/Prevención/Plataforma/")).toBe("Prevención/Plataforma")
    expect(normalizeCloudreveSstPath("  Prevención/Plataforma  ")).toBe("Prevención/Plataforma")
  })

  it("rechaza rutas inseguras", () => {
    expect(() => normalizeCloudreveSstPath("../fuera")).toThrow(/inválida/)
    expect(() => normalizeCloudreveSstPath("Prevención/..")).toThrow(/inválida/)
    expect(() => normalizeCloudreveSstPath("a\\b")).toThrow(/inválida/)
    expect(() => normalizeCloudreveSstPath("a\u0000b")).toThrow(/inválida/)
  })
})

describe("remoteSstKey", () => {
  it("mapea el archivo lógico anidado a la carpeta remota", () => {
    expect(remoteSstKey("Prevención/Plataforma", "storage/sst-documents/Procedimientos/abc.pdf"))
      .toBe("Prevención/Plataforma/Procedimientos/abc.pdf")
  })

  it("mapea la raíz del espacio para listados PROPFIND", () => {
    expect(remoteSstKey("Prevención/Plataforma", "storage/sst-documents"))
      .toBe("Prevención/Plataforma")
  })

  it("con sstPath vacío (cuenta acotada) la clave es la ruta relativa", () => {
    expect(remoteSstKey("", "storage/sst-documents/Procedimientos/abc.pdf"))
      .toBe("Procedimientos/abc.pdf")
    expect(remoteSstKey("", "storage/sst-documents")).toBe("")
  })

  it("rechaza paths lógicos ajenos al espacio SST", () => {
    expect(() => remoteSstKey("x", "storage/otra/cosa.pdf")).toThrow(/fuera del espacio/)
  })
})

describe("sstRelativePath", () => {
  it("sanea y une segmentos de carpeta", () => {
    expect(sstRelativePath([])).toBe("")
    expect(sstRelativePath(["Faena A", "Evaluaciones SST"])).toBe("Faena A/Evaluaciones SST")
  })
})

describe("sstPrefixReplace", () => {
  it("reescribe el prefijo de una ruta", () => {
    expect(sstPrefixReplace("storage/sst-documents/Viejo/a.pdf", "Viejo", "Nuevo"))
      .toBe("storage/sst-documents/Nuevo/a.pdf")
  })

  it("conserva subcarpetas internas", () => {
    expect(sstPrefixReplace("storage/sst-documents/Viejo/sub/b.pdf", "Viejo", "Nuevo"))
      .toBe("storage/sst-documents/Nuevo/sub/b.pdf")
  })

  it("soporta archivar con prefijo anidado", () => {
    expect(sstPrefixReplace(
      "storage/sst-documents/Faena A/Evaluaciones SST/a.pdf",
      "Faena A/Evaluaciones SST",
      `${ARCHIVED_PREFIX}/Faena A/Evaluaciones SST`,
    )).toBe(`storage/sst-documents/${ARCHIVED_PREFIX}/Faena A/Evaluaciones SST/a.pdf`)
  })

  it("soporta mover a la raíz (prefijo vacío)", () => {
    expect(sstPrefixReplace("storage/sst-documents/Viejo/a.pdf", "Viejo", ""))
      .toBe("storage/sst-documents/a.pdf")
    expect(sstPrefixReplace("storage/sst-documents/a.pdf", "", "Carpeta"))
      .toBe("storage/sst-documents/Carpeta/a.pdf")
  })

  it("devuelve null si la ruta no cae bajo el prefijo", () => {
    expect(sstPrefixReplace("storage/sst-documents/Otra/a.pdf", "Viejo", "Nuevo")).toBeNull()
  })
})
