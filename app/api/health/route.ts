import { NextResponse } from "next/server"
import { db } from "@/db"
import { sql } from "drizzle-orm"

export async function GET() {
  try {
    await db.select({ one: sql`1` }).from(sql`(SELECT 1) AS t`)
    return NextResponse.json({ status: "ok", db: "connected" })
  } catch {
    return NextResponse.json({ status: "error", db: "disconnected" }, { status: 503 })
  }
}
