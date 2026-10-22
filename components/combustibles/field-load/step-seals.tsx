"use client"

import { BigButton, BigField, BigInput, StepNotice } from "./big-controls"
import { PhotoTile } from "./photo-tile"
import type { StepViewProps } from "./step-props"
import type { FieldLoadDraft } from "./types"

type SealSide = "removed" | "installed"

const SIDES: Record<SealSide, { numberKey: "removedSealNumber" | "installedSealNumber"; noKey: "noRemovedSeal" | "noInstalledSeal"; title: string; label: string; none: string; kind: "removed_seal" | "installed_seal"; photo: string }> = {
  removed: { numberKey: "removedSealNumber", noKey: "noRemovedSeal", title: "Sello que sacaste", label: "Número del sello retirado", none: "No había sello", kind: "removed_seal", photo: "Tomar foto del sello retirado" },
  installed: { numberKey: "installedSealNumber", noKey: "noInstalledSeal", title: "Sello nuevo que pusiste", label: "Número del sello nuevo", none: "No puse sello", kind: "installed_seal", photo: "Tomar foto del sello nuevo" },
}

/** Paso 4: los dos sellos. El número se exige con su foto; sin sello, hay que decir por qué. */
export function StepSeals(props: StepViewProps) {
  const { draft, photos, errors, patch, selectPhoto, compressing } = props
  const anyMissing = draft.noRemovedSeal || draft.noInstalledSeal
  return (
    <div className="space-y-8">
      {(Object.keys(SIDES) as SealSide[]).map((side) => {
        const spec = SIDES[side]
        const none = draft[spec.noKey]
        const hasNumber = !none && draft[spec.numberKey].trim().length > 0
        return (
          <section key={side} className="space-y-3" aria-labelledby={`seal-${side}-title`}>
            <h3 id={`seal-${side}-title`} className="text-lg font-semibold">{spec.title}</h3>
            {none ? (
              <StepNotice tone="info">{spec.none}. Cuéntanos por qué más abajo.</StepNotice>
            ) : (
              <BigField id={`tae-${side === "removed" ? "removed" : "installed"}`} label={spec.label} hint="El número grabado en el sello. No uses 000000 ni números repetidos." error={errors[spec.numberKey]}>
                <BigInput id={`tae-${side === "removed" ? "removed" : "installed"}`} name={spec.numberKey} value={draft[spec.numberKey]} autoComplete="off" autoCapitalize="characters" onChange={(event) => patch({ [spec.numberKey]: event.target.value } as Partial<FieldLoadDraft>)} error={Boolean(errors[spec.numberKey])} />
              </BigField>
            )}
            {hasNumber && <PhotoTile kind={spec.kind} label={spec.photo} file={photos[spec.kind]} compressing={Boolean(compressing[spec.kind])} error={errors[spec.kind]} onSelect={(file) => selectPhoto(spec.kind, file)} />}
            <BigButton type="button" variant="secondary" aria-pressed={none} onClick={() => patch({ [spec.noKey]: !none } as Partial<FieldLoadDraft>)}>
              {none ? "Sí hay sello: escribir el número" : `No hay sello (${spec.none.toLocaleLowerCase("es-CL")})`}
            </BigButton>
          </section>
        )
      })}
      {anyMissing && (
        <BigField id="tae-seal-reason" label="¿Por qué falta un sello?" hint="Ej.: el sello venía cortado, no había sellos en la faena." error={errors.noSealReason}>
          <BigInput id="tae-seal-reason" name="noSealReason" value={draft.noSealReason} onChange={(event) => patch({ noSealReason: event.target.value })} error={Boolean(errors.noSealReason)} />
        </BigField>
      )}
    </div>
  )
}
