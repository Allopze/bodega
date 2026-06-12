import { sql } from "drizzle-orm"
import type { DB } from "@/db"
import { codeSequences } from "@/db/schema"
import { generateCode } from "@/lib/id"

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0]

export async function nextCodeTx(tx: Tx, prefix: string, year = new Date().getFullYear()) {
  await tx
    .insert(codeSequences)
    .values({ prefix, year, nextValue: 2 })
    .onConflictDoUpdate({
      target: [codeSequences.prefix, codeSequences.year],
      set: {
        nextValue: sql`${codeSequences.nextValue} + 1`,
        updatedAt: sql`now()`,
      },
    })

  const [row] = await tx
    .select({ nextValue: codeSequences.nextValue })
    .from(codeSequences)
    .where(sql`${codeSequences.prefix} = ${prefix} and ${codeSequences.year} = ${year}`)

  const nextValue = typeof row?.nextValue === "number" ? row.nextValue : 2
  return generateCode(prefix, nextValue - 1, year)
}
