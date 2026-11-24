import { describe, expect, it } from "vitest"
import { driveLink } from "./drive-link"

describe("driveLink", () => {
  it("acepta enlaces https de Google Drive y Docs", () => {
    expect(driveLink("https://drive.google.com/open?id=abc")).toBe("https://drive.google.com/open?id=abc")
    expect(driveLink("https://docs.google.com/document/d/abc/edit")).toBe("https://docs.google.com/document/d/abc/edit")
  })

  it("rechaza esquemas que ejecutan o incrustan contenido", () => {
    expect(driveLink("javascript:alert(document.cookie)")).toBeNull()
    expect(driveLink("JaVaScRiPt:alert(1)")).toBeNull()
    expect(driveLink("data:text/html,<script>alert(1)</script>")).toBeNull()
    expect(driveLink("vbscript:msgbox(1)")).toBeNull()
  })

  it("rechaza http, otros hosts y trucos de host", () => {
    expect(driveLink("http://drive.google.com/open?id=abc")).toBeNull()
    expect(driveLink("https://evil.example/open?id=abc")).toBeNull()
    expect(driveLink("https://drive.google.com.evil.example/open")).toBeNull()
    // Con credenciales en la URL el host real es el que sigue a la `@`.
    expect(driveLink("https://drive.google.com@evil.example/open")).toBeNull()
  })

  it("rechaza texto que no es una URL y valores vacíos", () => {
    expect(driveLink("ver en Drive")).toBeNull()
    expect(driveLink("")).toBeNull()
    expect(driveLink(null)).toBeNull()
    expect(driveLink(undefined)).toBeNull()
  })
})
