import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent"
import {
  type Component,
  type KeybindingsManager,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui"
import { Effect, Layer } from "effect"

import {
  AskUI,
  UserCancelled,
  type Answer,
  type AskUILayer,
} from "./ask-ui.js"
import type { Ask } from "./schema.js"

type Question = Ask["questions"][number]

interface SingleSelectComponentOptions {
  readonly question: Question
  readonly theme: Theme
  readonly keybindings: KeybindingsManager
  readonly requestRender: () => void
  readonly done: (answer: Answer | null) => void
}

class SingleSelectAskComponent implements Component {
  private selectedIndex = 0
  private cachedWidth: number | undefined
  private cachedLines: string[] | undefined

  constructor(private readonly options: SingleSelectComponentOptions) {}

  handleInput(data: string): void {
    const { keybindings, question } = this.options

    if (keybindings.matches(data, "tui.select.up")) {
      this.select(Math.max(0, this.selectedIndex - 1))
      return
    }

    if (keybindings.matches(data, "tui.select.down")) {
      this.select(
        Math.min(question.options.length - 1, this.selectedIndex + 1),
      )
      return
    }

    if (keybindings.matches(data, "tui.select.confirm")) {
      const selected = question.options[this.selectedIndex]
      if (selected) {
        this.options.done({ selectedLabels: [selected.label] })
      }
      return
    }

    if (keybindings.matches(data, "tui.select.cancel")) {
      this.options.done(null)
    }
  }

  render(width: number): string[] {
    const renderWidth = Math.max(1, width)
    if (this.cachedLines && this.cachedWidth === renderWidth) {
      return this.cachedLines
    }

    const { question, theme } = this.options
    const lines: string[] = []
    const addWrapped = (text: string) => {
      lines.push(...wrapTextWithAnsi(text, renderWidth))
    }
    const addWrappedWithPrefix = (prefix: string, text: string) => {
      const prefixWidth = visibleWidth(prefix)
      if (prefixWidth >= renderWidth) {
        addWrapped(prefix + text)
        return
      }

      const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth)
      const continuationPrefix = " ".repeat(prefixWidth)
      wrapped.forEach((line, index) => {
        lines.push(`${index === 0 ? prefix : continuationPrefix}${line}`)
      })
    }

    lines.push(theme.fg("borderAccent", "─".repeat(renderWidth)))
    addWrappedWithPrefix(
      " ",
      theme.bg(
        "selectedBg",
        theme.fg("accent", ` ${question.header} `),
      ),
    )
    lines.push("")
    addWrappedWithPrefix(" ", theme.fg("text", question.question))
    lines.push("")

    question.options.forEach((option, index) => {
      const selected = index === this.selectedIndex
      const marker = selected ? theme.fg("accent", "› ") : "  "
      const label = selected
        ? theme.fg("accent", option.label)
        : theme.fg("text", option.label)
      addWrappedWithPrefix(marker, label)
      addWrappedWithPrefix("    ", theme.fg("muted", option.description))
    })

    lines.push("")
    addWrappedWithPrefix(
      " ",
      theme.fg("dim", "↑↓ move • Enter select • Esc cancel"),
    )
    lines.push(theme.fg("borderAccent", "─".repeat(renderWidth)))

    this.cachedWidth = renderWidth
    this.cachedLines = lines
    return lines
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLines = undefined
  }

  private select(index: number): void {
    if (index === this.selectedIndex) {
      return
    }

    this.selectedIndex = index
    this.invalidate()
    this.options.requestRender()
  }
}

export function createLiveAskUILayer(
  ui: ExtensionUIContext,
): AskUILayer {
  return Layer.succeed(AskUI, {
    ask: (ask) => {
      const question = ask.questions[0]
      if (!question) {
        return Effect.die(new Error("AskUI received an Ask without a Question."))
      }
      if (ask.questions.length !== 1 || question.multiSelect) {
        return Effect.die(
          new Error("AskUI supports one single-select Question."),
        )
      }

      return Effect.promise(() =>
        ui.custom<Answer | null>((tui, theme, keybindings, done) =>
          new SingleSelectAskComponent({
            question,
            theme,
            keybindings,
            requestRender: () => tui.requestRender(),
            done,
          }),
        ),
      ).pipe(
        Effect.flatMap((answer) =>
          answer === null
            ? Effect.fail(new UserCancelled())
            : Effect.succeed([answer]),
        ),
      )
    },
  })
}
