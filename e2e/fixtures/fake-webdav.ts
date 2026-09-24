/**
 * Un WebDAV en memoria que se hace pasar por Cloudreve en las pruebas E2E.
 *
 * El servidor E2E apunta sus credenciales de Cloudreve acá
 * (`e2e/start-server.sh`), así que el archivado de documentos generados se
 * prueba de punta a punta sin tocar jamás el drive real de la empresa.
 *
 * Implementa lo que usa el cliente (`lib/services/cloudreve/client.ts`): MKCOL,
 * PUT, PROPFIND Depth 0 y GET, con autenticación Basic, y responde 409 si se
 * sube a una carpeta que no existe, como un WebDAV real.
 */
import http from "node:http"

export const FAKE_WEBDAV_PORT = 3198
export const FAKE_WEBDAV_USER = "e2e-webdav"
export const FAKE_WEBDAV_PASSWORD = "e2e-webdav"

export interface FakeWebdav {
  files: Map<string, Buffer>
  close: () => Promise<void>
}

function keyFromUrl(url: string | undefined): string | null {
  const pathname = new URL(url ?? "/", "http://fake").pathname
  if (!pathname.startsWith("/dav/")) return null
  return pathname.slice("/dav/".length).split("/").filter(Boolean).map(decodeURIComponent).join("/")
}

function parentOf(key: string): string {
  return key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : ""
}

/**
 * `files` se comparte entre arranques: detener y volver a levantar el servidor
 * (para simular a Cloudreve caído) no borra lo que ya se había subido.
 */
export async function startFakeWebdav(files = new Map<string, Buffer>(), port = FAKE_WEBDAV_PORT): Promise<FakeWebdav> {
  const collections = new Set<string>([""])
  for (const key of files.keys()) {
    const parts = key.split("/")
    for (let i = 1; i < parts.length; i += 1) collections.add(parts.slice(0, i).join("/"))
  }
  const expectedAuth = `Basic ${Buffer.from(`${FAKE_WEBDAV_USER}:${FAKE_WEBDAV_PASSWORD}`).toString("base64")}`

  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== expectedAuth) {
      res.writeHead(401).end()
      return
    }
    const key = keyFromUrl(req.url)
    if (key === null) {
      res.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      switch (req.method) {
        case "MKCOL":
          if (collections.has(key)) res.writeHead(405).end()
          else if (!collections.has(parentOf(key))) res.writeHead(409).end()
          else {
            collections.add(key)
            res.writeHead(201).end()
          }
          return
        case "PUT":
          if (!collections.has(parentOf(key))) {
            res.writeHead(409).end()
            return
          }
          files.set(key, Buffer.concat(chunks))
          res.writeHead(201).end()
          return
        case "PROPFIND": {
          const file = files.get(key)
          if (file) {
            res.writeHead(207, { "Content-Type": "application/xml" })
              .end(`<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:getcontentlength>${file.length}</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>`)
          } else if (collections.has(key)) {
            res.writeHead(207, { "Content-Type": "application/xml" })
              .end(`<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`)
          } else {
            res.writeHead(404).end()
          }
          return
        }
        case "GET": {
          const file = files.get(key)
          if (file) res.writeHead(200).end(file)
          else res.writeHead(404).end()
          return
        }
        default:
          res.writeHead(405).end()
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve())
  })

  return {
    files,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}
