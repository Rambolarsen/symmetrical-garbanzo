export interface SpecSection {
  heading: string  // e.g. "User Prompt", "Pre-Planning Analysis"; empty string for headerless content
  content: string  // trimmed body text
}

export function parseSpec(spec: string): SpecSection[] {
  if (!spec.trim()) return []
  const normalized = spec.replace(/\r\n/g, '\n')
  const chunks = normalized.split(/\n(?=## )/)
  return chunks.flatMap(chunk => {
    const lines = chunk.split('\n')
    const first = lines[0].trim()
    if (first.startsWith('## ')) {
      return [{ heading: first.slice(3).trim(), content: lines.slice(1).join('\n').trim() }]
    }
    return first ? [{ heading: '', content: chunk.trim() }] : []
  })
}

export function reconstructSpec(sections: SpecSection[]): string {
  return sections
    .map(s => s.heading ? `## ${s.heading}\n\n${s.content}` : s.content)
    .join('\n\n')
    .trim()
}

export function upsertSpecSection(spec: string, sectionBlock: string): string {
  const incomingSections = parseSpec(sectionBlock)
  if (incomingSections.length === 0) return spec.trim()

  let sections = parseSpec(spec)

  for (const incoming of incomingSections) {
    if (!incoming.heading) {
      sections = [...sections, incoming]
      continue
    }

    const firstMatchIndex = sections.findIndex(section => section.heading === incoming.heading)
    const withoutMatches = sections.filter(section => section.heading !== incoming.heading)

    if (firstMatchIndex === -1) {
      sections = [...withoutMatches, incoming]
      continue
    }

    sections = [
      ...withoutMatches.slice(0, firstMatchIndex),
      incoming,
      ...withoutMatches.slice(firstMatchIndex),
    ]
  }

  return reconstructSpec(sections)
}

export function extractUserPrompt(spec: string): string {
  const up = parseSpec(spec).find(s => s.heading === 'User Prompt')
  return up?.content ?? spec.replace(/^##[^\n]*\n*/gm, '').trim()
}
