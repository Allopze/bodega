type ManifestEntry = {
  id: string
  legacyNumber: number
  description: string
  executionGuidance: string
}

type AnnualActivity = {
  id: string
  programId: string
  n: number
  activity: string
  program: string
  catalogActivityId: string | null
}

export function planAnnualCatalogMappings(input: {
  manifest: readonly ManifestEntry[]
  annualActivities: readonly AnnualActivity[]
}) {
  const byNumber = new Map(input.manifest.map((entry) => [entry.legacyNumber, entry]))
  const mappings: Array<{ annualActivityId: string; programId: string; n: number; catalogActivityId: string }> = []
  const issues: string[] = []
  const seenProgramIdentity = new Map<string, string>()

  for (const annual of input.annualActivities) {
    if (annual.catalogActivityId) {
      const key = `${annual.programId}:${annual.catalogActivityId}`
      const previous = seenProgramIdentity.get(key)
      if (previous && previous !== annual.id) issues.push(`Programa ${annual.programId}: identidad ${annual.catalogActivityId} duplicada.`)
      else seenProgramIdentity.set(key, annual.id)
      continue
    }
    const candidate = byNumber.get(annual.n)
    if (!candidate || candidate.description !== annual.activity || candidate.executionGuidance !== annual.program) {
      issues.push(`Actividad ${annual.id} N°${annual.n}: sin coincidencia literal en la manifestación.`)
      continue
    }
    const key = `${annual.programId}:${candidate.id}`
    const previous = seenProgramIdentity.get(key)
    if (previous && previous !== annual.id) {
      issues.push(`Programa ${annual.programId}: identidad ${candidate.id} duplicada por ${previous} y ${annual.id}.`)
      continue
    }
    seenProgramIdentity.set(key, annual.id)
    mappings.push({
      annualActivityId: annual.id,
      programId: annual.programId,
      n: annual.n,
      catalogActivityId: candidate.id,
    })
  }
  return { mappings, issues }
}
