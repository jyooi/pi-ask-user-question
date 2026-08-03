const ESC_STRING_CONTROL_INTRODUCERS = new Set([
  0x50,
  0x58,
  0x5d,
  0x5e,
  0x5f,
])
const C1_STRING_CONTROL_INTRODUCERS = new Set([
  0x90,
  0x98,
  0x9d,
  0x9e,
  0x9f,
])

function skipControlString(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code === 0x07 || code === 0x9c) {
      return index + 1
    }
    if (code === 0x1b && text.charCodeAt(index + 1) === 0x5c) {
      return index + 2
    }
    index += 1
  }

  return text.length
}

function skipControlSequence(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const code = text.charCodeAt(index)
    index += 1
    if (code >= 0x40 && code <= 0x7e) {
      break
    }
  }

  return index
}

export function sanitizeTerminalText(text: string): string {
  let sanitized = ""
  let index = 0

  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      sanitized += " "
      index += 1
      continue
    }
    if (code === 0x1b) {
      const next = text.charCodeAt(index + 1)
      if (next === 0x5b) {
        index = skipControlSequence(text, index + 2)
      } else if (ESC_STRING_CONTROL_INTRODUCERS.has(next)) {
        index = skipControlString(text, index + 2)
      } else {
        index = Math.min(text.length, index + 2)
      }
      continue
    }
    if (code === 0x9b) {
      index = skipControlSequence(text, index + 1)
      continue
    }
    if (C1_STRING_CONTROL_INTRODUCERS.has(code)) {
      index = skipControlString(text, index + 1)
      continue
    }
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      index += 1
      continue
    }

    sanitized += text[index]
    index += 1
  }

  return sanitized
}
