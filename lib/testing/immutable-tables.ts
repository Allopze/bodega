import { sql } from "drizzle-orm"

/**
 * Tablas de evidencia protegidas por un trigger que rechaza UPDATE y DELETE.
 * La clave es el nombre de la tabla y el valor, el trigger que la custodia.
 */
const IMMUTABLE_TABLE_GUARDS: Record<string, string> = {
  worker_position_history: "worker_position_history_immutable",
}

type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }

/**
 * Vacía una tabla inmutable desactivando su trigger durante la operación.
 *
 * Existe solo para los fixtures: en producción el trigger es la garantía de
 * que el historial es evidencia y ningún camino de la aplicación lo relaja.
 * Sin esto, un `beforeEach` que reinicia el padrón choca con el guard y el
 * fallo se confunde con una regresión del código bajo prueba.
 */
export async function truncateImmutableTable(client: Executor, table: keyof typeof IMMUTABLE_TABLE_GUARDS | string): Promise<void> {
  const trigger = IMMUTABLE_TABLE_GUARDS[table]
  if (!trigger) throw new Error(`"${table}" no está registrada como tabla inmutable`)
  await client.execute(sql.raw(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`))
  try {
    await client.execute(sql.raw(`DELETE FROM ${table}`))
  } finally {
    await client.execute(sql.raw(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`))
  }
}
