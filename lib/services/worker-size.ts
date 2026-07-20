import { db } from "@/db"
import { workers } from "@/db/schema"
import { eq } from "drizzle-orm"

const NAME_TO_WORKER_FIELD: Record<string, keyof typeof workers.$inferSelect> = {
  Talla: "sizeTop",
  "Talla calzado": "sizeShoe",
}

export async function getSuggestedSize(
  workerId: string,
  attributeName: string,
): Promise<string | null> {
  const field = NAME_TO_WORKER_FIELD[attributeName]
  if (!field) return null

  const worker = await db.query.workers.findFirst({
    where: eq(workers.id, workerId),
    columns: { [field]: true },
  })
  if (!worker) return null
  return (worker as Record<string, string | null>)[field] ?? null
}
