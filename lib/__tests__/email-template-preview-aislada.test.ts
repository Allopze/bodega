/**
 * HALLAZGO SEC-003 (S4/P2) — «La vista previa de plantillas de correo inyecta
 * HTML sin sanear».
 *
 * La vista previa de `/admin/plantillas` tenía dos caminos: un documento HTML
 * completo se mostraba en un `iframe` con `sandbox` —correcto—, pero un cuerpo
 * suelto se inyectaba con `dangerouslySetInnerHTML` directamente en el DOM de
 * la página de administración. La CSP con nonce impedía ejecutar el script
 * inyectado, no inyectar marcado engañoso dentro del panel.
 *
 * Aquí se fija que el fragmento se envuelve en un documento —para el mismo
 * `iframe` aislado— y que la pantalla ya no tiene ninguna inyección directa.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { buildTemplatePreviewDocument } from "@/lib/services/email-template-render"

const PANTALLA = path.join(process.cwd(), "app/(app)/admin/plantillas/template-list.tsx")

describe("Vista previa de plantillas de correo (SEC-003)", () => {
  it("envuelve un fragmento suelto en un documento propio, en vez de dejarlo suelto para el DOM de la app", () => {
    const documento = buildTemplatePreviewDocument("<p>Hola</p><img src=x onerror=alert(1)>")
    expect(documento.startsWith("<!DOCTYPE html>")).toBe(true)
    expect(documento).toContain("<p>Hola</p>")
  })

  it("no reescribe una plantilla que ya es un documento completo", () => {
    const completo = "<!DOCTYPE html><html><body>Correo</body></html>"
    expect(buildTemplatePreviewDocument(completo)).toBe(completo)
  })

  it("respeta el <html> sin doctype, que también es un documento completo", () => {
    const completo = "<html><body>Correo</body></html>"
    expect(buildTemplatePreviewDocument(completo)).toBe(completo)
  })

  it("la pantalla de plantillas ya no inyecta HTML en el DOM de la aplicación", () => {
    const fuente = readFileSync(PANTALLA, "utf-8")
    // Se busca el uso (`dangerouslySetInnerHTML={`), no la palabra: el
    // comentario que explica la remediación la menciona a propósito.
    expect(fuente).not.toMatch(/dangerouslySetInnerHTML=\{/)
  })

  it("la vista previa se renderiza en un iframe con sandbox", () => {
    const fuente = readFileSync(PANTALLA, "utf-8")
    expect(fuente).toContain("<iframe")
    expect(fuente).toMatch(/sandbox=/)
    // Ningún camino de vista previa puede pedir `allow-scripts`: el marcado de
    // la plantilla lo escribe quien administra plantillas, no la plataforma.
    expect(fuente).not.toContain("allow-scripts")
  })
})
