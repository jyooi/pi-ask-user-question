import type { Theme } from "@earendil-works/pi-coding-agent"
import { Text, type Component } from "@earendil-works/pi-tui"

import type { AnswerDetails, Ask, AskResultDetails } from "./schema.js"
import { sanitizeTerminalText } from "./terminal-text.js"

function displayText(value: unknown): string {
  return typeof value === "string" ? sanitizeTerminalText(value) : ""
}

function headerChip(header: unknown, theme: Theme): string {
  const text = displayText(header) || "Question"
  return theme.fg(
    "accent",
    theme.inverse(` ${text} `),
  )
}

function textComponent(
  content: string,
  lastComponent: Component | undefined,
): Text {
  const text = lastComponent instanceof Text
    ? lastComponent
    : new Text("", 0, 0)
  text.setText(content)
  return text
}

function formatAnswer(answer: AnswerDetails, theme: Theme): string {
  const parts: string[] = []
  if (answer.selectedLabels.length > 0) {
    parts.push(
      theme.fg(
        "toolOutput",
        answer.selectedLabels.map(displayText).join(", "),
      ),
    )
  }
  if (answer.otherText !== undefined) {
    const other = JSON.stringify(displayText(answer.otherText))
    parts.push(
      `${theme.fg("toolOutput", other)} ${theme.fg("muted", "(other)")}`,
    )
  }

  return parts.length > 0
    ? parts.join(", ")
    : theme.fg("warning", "No Answer")
}

function hasAnswerDetails(details: unknown): details is AskResultDetails {
  if (typeof details !== "object" || details === null) {
    return false
  }

  const answers = (details as { answers?: unknown }).answers
  return Array.isArray(answers) && answers.every((answer) => {
    if (typeof answer !== "object" || answer === null) {
      return false
    }

    const candidate = answer as Partial<AnswerDetails>
    return (
      typeof candidate.header === "string" &&
      Array.isArray(candidate.selectedLabels) &&
      candidate.selectedLabels.every((label) => typeof label === "string") &&
      (candidate.otherText === undefined ||
        typeof candidate.otherText === "string")
    )
  })
}

function resultText(
  content: readonly { readonly type: string; readonly text?: string }[],
): string {
  return content
    .filter(
      (item): item is { readonly type: string; readonly text: string } =>
        item.type === "text" && typeof item.text === "string",
    )
    .map((item) => displayText(item.text))
    .join("\n")
}

export function renderAskCall(
  ask: Ask,
  theme: Theme,
  lastComponent: Component | undefined,
): Component {
  const title = theme.fg(
    "toolTitle",
    theme.bold("Ask User Question"),
  )
  const questions = Array.isArray(ask.questions)
    ? ask.questions.map((question) => {
        const text = displayText(question?.question)
        return `${headerChip(question?.header, theme)} ${theme.fg("text", text)}`
      })
    : []
  const content = questions.length > 0
    ? [title, ...questions].join("\n")
    : title

  return textComponent(content, lastComponent)
}

export function renderAskResult(
  result: {
    readonly content: readonly {
      readonly type: string
      readonly text?: string
    }[]
    readonly details: unknown
  },
  isPartial: boolean,
  isError: boolean,
  theme: Theme,
  lastComponent: Component | undefined,
): Component {
  let content: string
  if (isPartial) {
    content = theme.fg("warning", "Answers pending...")
  } else if (isError) {
    content = theme.fg("error", resultText(result.content) || "Ask failed.")
  } else if (hasAnswerDetails(result.details)) {
    content = result.details.answers
      .map(
        (answer) =>
          `${headerChip(answer.header, theme)} ${formatAnswer(answer, theme)}`,
      )
      .join("\n")
  } else {
    content = theme.fg("toolOutput", resultText(result.content) || "Ask complete.")
  }

  return textComponent(content, lastComponent)
}
