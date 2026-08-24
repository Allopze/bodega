const allowedEnvFiles = new Set([".env.example"])

const sensitiveKeys = new Set([
  "AUTH_SECRET",
  "SMTP_PASS",
  "POSTGRES_PASSWORD",
  "PREVENTION_DATA_ENCRYPTION_KEY",
])

/** Environment-like basenames include both `.env.*` and provider exports such as `doc.env`. */
export function isEnvironmentFile(file: string): boolean {
  const basename = file.split(/[\\/]/).pop() ?? file
  return basename === ".env"
    || basename.startsWith(".env.")
    || basename.endsWith(".env")
    || basename.includes(".env.")
}

export interface EnvFilesInspectionInput {
  trackedFiles: string[]
  exampleExists: boolean
  exampleContents: string
}

export interface EnvFilesInspection {
  disallowedEnvFiles: string[]
  missingExample: boolean
  leakedKeys: string[]
}

export function inspectEnvFiles(input: EnvFilesInspectionInput): EnvFilesInspection {
  const disallowedEnvFiles = input.trackedFiles
    .filter(isEnvironmentFile)
    .filter((file) => !allowedEnvFiles.has(file))

  const leakedKeys = input.exampleContents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .flatMap((line) => {
      const [key, ...rest] = line.split("=")
      const value = rest.join("=").trim()
      return key && sensitiveKeys.has(key) && value ? [key] : []
    })

  return {
    disallowedEnvFiles,
    missingExample: !input.exampleExists,
    leakedKeys,
  }
}
