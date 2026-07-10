import type { AttrRow } from "./request-form.types"

export function getEditableItemAttributes(attributes: AttrRow[]) {
  return attributes.flatMap((attribute, index) => {
    const isResolvedByVariant = attribute.type === "select"
      && attribute.options.length === 1
      && attribute.value === attribute.options[0]

    return isResolvedByVariant ? [] : [{ attribute, index }]
  })
}
