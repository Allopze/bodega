import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { db } from "@/db"
import { fuelTaeEvidence } from "@/db/schema"
import { resolveFuelTaeEvidenceFile } from "@/lib/storage/config"
import { readBuffer } from "@/lib/storage/helpers"
import { logEvidenceAccess } from "@/lib/combustibles/evidence-management"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const runtime = "nodejs"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!can(session, "combustibles:tae_view")) return new NextResponse("Forbidden", { status: 403 })
  if (!await isRouteOperational("/combustibles/tae")) {
    return new NextResponse("Service unavailable", { status: 503 })
  }
  const { id } = await params
  const evidence = await db.query.fuelTaeEvidence.findFirst({
    where: eq(fuelTaeEvidence.id, id),
    with: { submission: { columns: { worksiteId: true } } },
  })
  if (!evidence || !evidence.submission || !canAccessWorksite(session, evidence.submission.worksiteId)) return new NextResponse("Not found", { status: 404 })
  void logEvidenceAccess(id, session!.user.id, "view")
  if (!evidence.filePath) {
    if (!evidence.externalUrl) return new NextResponse("Evidence not found", { status: 404 })
    try {
      const url = new URL(evidence.externalUrl)
      if (url.protocol !== "https:" && url.protocol !== "http:") return new NextResponse("Invalid evidence URL", { status: 400 })
      return NextResponse.redirect(url)
    } catch { return new NextResponse("Invalid evidence URL", { status: 400 }) }
  }
  const filePath = resolveFuelTaeEvidenceFile(evidence.filePath)
  if (!filePath) return new NextResponse("Invalid evidence path", { status: 400 })
  try {
    const buffer = await readBuffer(filePath)
    return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": evidence.mimeType ?? "application/octet-stream", "Cache-Control": "private, no-store" } })
  } catch {
    return new NextResponse("Evidence not found", { status: 404 })
  }
}
