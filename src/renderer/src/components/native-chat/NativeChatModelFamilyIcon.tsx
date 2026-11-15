import { ClaudeIcon, OpenAIIcon } from '@/components/status-bar/icons'
import { modelFamilyFromId } from '@/lib/model-family'

export function NativeChatModelFamilyIcon({
  modelId
}: {
  modelId: string | undefined
}): React.JSX.Element | null {
  const family = modelFamilyFromId(modelId)
  if (!family) {
    return null
  }
  return (
    <span
      aria-hidden="true"
      data-model-family={family}
      className="inline-flex size-4 shrink-0 items-center justify-center [&>svg]:size-full"
    >
      {family === 'claude' ? <ClaudeIcon /> : <OpenAIIcon />}
    </span>
  )
}
