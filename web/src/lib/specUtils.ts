export interface SpecSection {
  heading: string  // e.g. "User Prompt", "Pre-Planning Analysis"; empty string for headerless content
  content: string  // trimmed body text
}

export function sanitizeSectionContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/^#\s+/gm, '### ')
    .replace(/^##\s+/gm, '### ')
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

export function upsertClarificationsSection(spec: string, clarification: string): string {
  const trimmed = sanitizeSectionContent(clarification).trim()
  if (!trimmed) return spec.trim()

  const sections = parseSpec(spec)
  const normalized = trimmed.replace(/\r\n/g, '\n')
  const existing = sections.find(section => section.heading === 'Clarifications')

  if (!existing) {
    return reconstructSpec([
      ...sections,
      { heading: 'Clarifications', content: normalized },
    ])
  }

  if (existing.content.includes(normalized)) {
    return reconstructSpec(sections)
  }

  const updated = sections.map(section =>
    section.heading === 'Clarifications'
      ? { ...section, content: `${section.content.trim()}\n\n${normalized}`.trim() }
      : section
  )

  return reconstructSpec(updated)
}

export function extractClarificationDraft(content: string): string | null {
  const match = content.match(/Clarification Draft:\s*([\s\S]*)$/i)
  if (!match) return null

  const draft = match[1].trim()
  return draft.length > 0 ? draft : null
}

export function extractUserPrompt(spec: string): string {
  const up = parseSpec(spec).find(s => s.heading === 'User Prompt')
  return up?.content ?? spec.replace(/^##[^\n]*\n*/gm, '').trim()
}
