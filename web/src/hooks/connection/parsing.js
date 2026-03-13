import { SERVER_COMMANDS } from './constants'

export function isServerCommand(line) {
  const t = (line || '').trim()
  if (!t.startsWith('/')) return false
  const first = t.split(/\s+/)[0]
  return SERVER_COMMANDS.includes(first)
}

/**
 * Parse optional [ts:...] [burn:...] prefix for BAR.
 * Returns { line, burnTs } (burnTs null = always show).
 */
export function parseBARLine(rawLine) {
  const match = rawLine.match(/^\[ts:\d+\]\s*\[burn:(\d+)\]\s*(.*)$/s)
  if (match) {
    const burnTs = parseInt(match[1], 10)
    const line = (match[2] != null ? match[2] : rawLine).trim()
    return {
      line: line || rawLine,
      burnTs: Number.isFinite(burnTs) ? burnTs : null,
    }
  }
  return { line: rawLine, burnTs: null }
}
