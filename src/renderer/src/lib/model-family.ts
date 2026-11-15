export type ModelFamily = 'claude' | 'openai'

/** Match model IDs, not agent names or provider routes (a gateway can serve either family). */
export function modelFamilyFromId(modelId: string | null | undefined): ModelFamily | null {
  const id = modelId?.trim().toLowerCase()
  if (!id) {
    return null
  }
  // Bare aliases are the Claude catalog's own selectable model IDs.
  if (/^(opus|sonnet|haiku|fable)(\[1m\])?$/.test(id)) {
    return 'claude'
  }
  if (/(^|\/)claude-(opus|sonnet|haiku|fable|\d)[^/]*$/.test(id)) {
    return 'claude'
  }
  if (/(^|\/)(gpt-\d[^/]*|o[134](?:-[^/]+)?)$/.test(id)) {
    return 'openai'
  }
  return null
}
