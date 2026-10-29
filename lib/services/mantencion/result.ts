/** Resultado de una acción de escritura del módulo: los mensajes están en español y son mostrables. */
export type MantActionResult<T = undefined> =
  | ({ ok: true; message?: string } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; message: string; field?: string }
