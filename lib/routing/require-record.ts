import { notFound } from "next/navigation"
import { eq, sql } from "drizzle-orm"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"
import { db } from "@/db"

/**
 * Comprueba que un registro exista **antes** de que empiece el streaming.
 *
 * Una ruta de detalle con `loading.tsx` queda envuelta en Suspense, y Next
 * envía la cabecera de estado en cuanto empieza a transmitir el esqueleto. Para
 * cuando la página llega a su `notFound()`, el `200 OK` ya viaja por el cable:
 * el usuario ve la pantalla de "no encontrado" correcta, pero cualquier
 * consumidor que lea el código HTTP —un monitor, un crawler, una integración—
 * recibe la respuesta de que todo salió bien. Es comportamiento documentado de
 * Next, no un defecto suyo.
 *
 * Un `layout.tsx` del mismo segmento se renderiza por fuera de esa frontera, así
 * que la comprobación hecha ahí sí alcanza a fijar el 404 real. La consulta es
 * deliberadamente mínima —`select 1 ... limit 1`— para no duplicar el trabajo
 * que la página hará después con el registro completo.
 */
export async function requireRecord(table: PgTable, idColumn: PgColumn, id: string): Promise<void> {
  const [row] = await db
    .select({ exists: sql<number>`1` })
    .from(table)
    .where(eq(idColumn, id))
    .limit(1)

  if (!row) notFound()
}
