import type { ProductOption } from "./request-form.types"
import { parseAttributeOptions } from "./request-form.helpers"

export interface SizeVariantChoice {
  id: string
  label: string
}

export interface SizeVariantPicker {
  attributeName: string
  choices: SizeVariantChoice[]
}

function isSizeAttribute(name: string) {
  return /\btalla\b|\bsize\b/i.test(name)
}

/**
 * A product family can be stored as one catalog row per size. Convert that
 * representation into the single choice a requester needs to make.
 */
export function getSizeVariantPicker(variants: ProductOption[]): SizeVariantPicker | null {
  if (variants.length < 2) return null

  const choices = variants.map((variant) => {
    const attribute = variant.attributes.find((candidate) => isSizeAttribute(candidate.name))
    const size = attribute ? parseAttributeOptions(attribute.options)[0] : undefined
    return attribute && size ? { id: variant.id, attributeName: attribute.name, label: size } : null
  })

  if (choices.some((choice) => choice === null)) return null

  const resolvedChoices = choices as Array<SizeVariantChoice & { attributeName: string }>
  const attributeNames = new Set(resolvedChoices.map((choice) => choice.attributeName))
  const labels = new Set(resolvedChoices.map((choice) => choice.label))
  if (attributeNames.size !== 1 || labels.size !== resolvedChoices.length) return null

  return {
    attributeName: resolvedChoices[0]!.attributeName,
    choices: resolvedChoices.map(({ id, label }) => ({ id, label })),
  }
}
