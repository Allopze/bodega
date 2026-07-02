import { eq } from "drizzle-orm"
import { db } from "@/db"
import type { RequestModuleConfig } from "../request-config"

export async function getQuotationsForRequest(
  config: Pick<RequestModuleConfig, "quotationsTable">,
  requestId: string,
) {
  const qt = config.quotationsTable
  return db
    .select()
    .from(qt)
    .where(eq(qt.requestId, requestId))
    .orderBy(qt.createdAt)
}
