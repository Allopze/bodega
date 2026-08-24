import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { inspectEnvFiles } from "./check-env-files-core"

function getTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  return output.split("\0").filter(Boolean)
}

const inspection = inspectEnvFiles({
  trackedFiles: getTrackedFiles(),
  exampleExists: fs.existsSync(".env.example"),
  exampleContents: fs.existsSync(".env.example") ? fs.readFileSync(".env.example", "utf8") : "",
})

if (inspection.disallowedEnvFiles.length > 0) {
  console.error("No se deben trackear archivos de entorno con secretos:")
  for (const file of inspection.disallowedEnvFiles) console.error(`- ${file}`)
  process.exit(1)
}

if (inspection.missingExample) {
  console.error("Falta .env.example saneado para documentar variables requeridas.")
  process.exit(1)
}

if (inspection.leakedKeys.length > 0) {
  console.error(".env.example no debe incluir valores para secretos sensibles:")
  for (const key of inspection.leakedKeys) console.error(`- ${key}`)
  process.exit(1)
}

console.log("Env files check passed.")
