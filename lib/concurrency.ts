/**
 * Recorre `values` con como máximo `concurrency` tareas en vuelo.
 *
 * Vive suelto porque lo comparten la sincronización del portal DTE y la acción
 * que analiza líneas a demanda: dejarlo dentro de `sync.ts` obligaba a la
 * acción a importar el módulo de sincronización entero para usar doce líneas.
 */
export async function runWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const value = values[cursor]
      cursor += 1
      if (value !== undefined) await task(value)
    }
  }))
}
