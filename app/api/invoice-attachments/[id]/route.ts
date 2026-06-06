import { readFile } from "node:fs/promises"
import path from "node:path"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { canReadInvoiceAttachment } from "@/lib/actions/invoice-attachments"

const STORAGE_DIR = path.join(process.cwd(), "storage", "invoices")

export async function GET(_request: Request, context: RouteContext<"/api/invoice-attachments/[id]">) {
  const session = await auth()
  if (!session) return new Response("Unauthorized", { status: 401 })

  const { id } = await context.params
  const attachment = await canReadInvoiceAttachment(session, id)
  if (!attachment) notFound()

  const absolutePath = path.join(STORAGE_DIR, attachment.storageName)
  const file = await readFile(absolutePath).catch(() => null)
  if (!file) notFound()

  return new Response(file, {
    headers: {
      "Content-Type": attachment.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeHeaderValue(attachment.fileName)}"`,
      "Content-Length": String(file.length),
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  })
}

function encodeHeaderValue(value: string) {
  return value.replace(/["\\\r\n]/g, "_")
}
