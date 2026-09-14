/**
 * HALLAZGO OBS-001 (S3/P1) — «El filtro de telemetría sólo depura dos
 * cabeceras: URL, cuerpo y usuario viajan completos».
 *
 * Antes de esta remediación el `beforeSend` de Sentry quitaba `cookie` y
 * `authorization` y dejaba pasar todo lo demás. Con RUT de trabajadores, datos
 * de salud y payloads de Server Actions circulando por la plataforma, cada
 * error no controlado era una fuga hacia el proveedor de telemetría.
 *
 * Cada caso de abajo describe algo que ANTES sí salía del servidor.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { depurarEventoTelemetria, despojarQueryString } from "@/lib/security/telemetry-scrub"

function eventoRealista() {
  return {
    request: {
      url: "https://app.chome.cl/prevencion/incidentes?rut=11111111-1&caso=reservado",
      method: "POST",
      query_string: "rut=11111111-1",
      data: { rut: "11111111-1", diagnostico: "lesión lumbar" },
      cookies: { "authjs.session-token": "abc" },
      headers: {
        "content-type": "text/x-component",
        "user-agent": "Mozilla/5.0",
        cookie: "authjs.session-token=abc",
        authorization: "Bearer xyz",
        "x-forwarded-for": "190.1.2.3",
        "next-action": "7f3a",
      },
    },
    user: { id: "usr-1", email: "trabajador@chome.cl", username: "jperez", ip_address: "190.1.2.3" },
    extra: { payload: { rut: "11111111-1" } },
    contexts: { trace: { trace_id: "t1" }, os: { name: "Linux" }, solicitud: { rut: "11111111-1" } },
    breadcrumbs: [
      { category: "fetch", data: { url: "/api/x?rut=11111111-1", body: "{\"rut\":\"11111111-1\"}", status_code: 500 } },
    ],
  }
}

describe("Depuración de eventos de telemetría (OBS-001)", () => {
  it("borra el cuerpo de la petición, que en Next es la carga de la Server Action", () => {
    const evento = depurarEventoTelemetria(eventoRealista())
    expect(evento.request?.data).toBeUndefined()
    expect(JSON.stringify(evento)).not.toContain("lesión lumbar")
  })

  it("recorta la query de la URL, donde viajaban RUT e identificadores de caso", () => {
    const evento = depurarEventoTelemetria(eventoRealista())
    expect(evento.request?.url).toBe("https://app.chome.cl/prevencion/incidentes")
    expect(evento.request?.query_string).toBeUndefined()
  })

  it("conserva sólo las cabeceras inocuas, en vez de quitar dos y dejar el resto", () => {
    const evento = depurarEventoTelemetria(eventoRealista())
    expect(Object.keys(evento.request?.headers ?? {}).sort()).toEqual(["content-type", "user-agent"])
  })

  it("descarta las cookies parseadas, que el filtro antiguo ni miraba", () => {
    const evento = depurarEventoTelemetria(eventoRealista())
    expect(evento.request?.cookies).toBeUndefined()
  })

  it("reduce el usuario a su identificador opaco: sin correo, nombre ni IP", () => {
    const evento = depurarEventoTelemetria(eventoRealista())
    expect(evento.user).toEqual({ id: "usr-1" })
  })

  it("descarta `extra`, el saco arbitrario de `captureException(error, contexto)`", () => {
    const evento = depurarEventoTelemetria(eventoRealista())
    expect(evento.extra).toBeUndefined()
  })

  it("deja pasar los contextos estándar del SDK y descarta los que puso la aplicación", () => {
    const evento = depurarEventoTelemetria(eventoRealista())
    expect(Object.keys(evento.contexts ?? {}).sort()).toEqual(["os", "trace"])
  })

  it("limpia las migas de pan: sin cuerpo y sin query en la URL", () => {
    const evento = depurarEventoTelemetria(eventoRealista())
    const miga = evento.breadcrumbs?.[0]
    expect(miga?.data?.body).toBeUndefined()
    expect(miga?.data?.url).toBe("/api/x")
    expect(miga?.data?.status_code).toBe(500)
  })

  it("no revienta con un evento sin petición, sin usuario y sin migas", () => {
    expect(depurarEventoTelemetria({ message: "boom" })).toEqual({ message: "boom" })
  })

  it("despojarQueryString también corta el fragmento", () => {
    expect(despojarQueryString("/ruta?a=1#b")).toBe("/ruta")
    expect(despojarQueryString("/ruta")).toBe("/ruta")
  })
})

describe("Los tres runtimes comparten el mismo filtro (OBS-001)", () => {
  // El defecto original estaba copiado tres veces; si alguien vuelve a escribir
  // un `beforeSend` a mano en cualquiera de los tres, esta prueba lo detiene.
  const configuraciones = ["sentry.server.config.ts", "sentry.edge.config.ts", "instrumentation-client.ts"]

  it.each(configuraciones)("%s delega en el módulo compartido", (archivo) => {
    const fuente = readFileSync(path.join(process.cwd(), archivo), "utf-8")
    expect(fuente).toContain("depurarEventoTelemetria")
    // El filtro antiguo desestructuraba las dos cabeceras a mano; se busca esa
    // forma exacta y no la palabra, que el comentario de la remediación cita.
    expect(fuente).not.toMatch(/const \{ cookie, authorization/)
  })
})
