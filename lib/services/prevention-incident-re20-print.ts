import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { users, workers } from "@/db/schema"
import { listIncidentFollowups, listIncidentOnePageDiffusions } from "@/lib/services/prevention-incidents"

export type Re20PrintPerson = { name: string; position: string | null }

/**
 * Lo que la impresión del expediente RE-20 necesita además del propio expediente: el seguimiento y la
 * difusión canónicos y el nombre y cargo de las personas que el expediente sólo guarda por id.
 * El alcance por faena ya lo verificó quien llama (la lectura del expediente); aquí sólo se lee.
 */
export async function getPreventionIncidentRe20PrintExtras(args: { incidentId: string; userIds: Array<string | null | undefined> }) {
  const [followups, diffusions] = await Promise.all([
    listIncidentFollowups(args.incidentId),
    listIncidentOnePageDiffusions(args.incidentId),
  ])
  const ids = [...new Set([...args.userIds, ...followups.map((item) => item.verifierUserId)].filter((id): id is string => Boolean(id)))]
  const rows = ids.length
    ? await db.select({ id: users.id, name: users.name, position: workers.position }).from(users)
      .leftJoin(workers, eq(workers.id, users.workerId)).where(inArray(users.id, ids))
    : []
  const people: Record<string, Re20PrintPerson> = Object.fromEntries(rows.map((row) => [row.id, { name: row.name, position: row.position }]))
  return { followups, diffusions, people }
}
