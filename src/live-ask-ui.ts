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
  readonly getViewportHeight: () => number
  readonly requestRender: () => void
  readonly done: (answer: Answer | null) => void
}

interface QuestionLayout {
  readonly full: readonly string[]
  readonly header: readonly string[]
  readonly question: readonly string[]
  readonly options: readonly (readonly string[])[]
  readonly help: readonly string[]
  readonly bottomBorder: string
}

function fitContext(
  header: readonly string[],
  question: readonly string[],
  height: number,
): string[] {
  if (height <= 0) {
    return []
  }
  if (height === 1 || question.length === 0) {
    return header.slice(0, height)
  }

  const headerHeight = Math.min(
    header.length,
    Math.max(1, height - question.length),
  )
  return [
    ...header.slice(0, headerHeight),
    ...question.slice(0, height - headerHeight),
  ]
}

function fitOptions(
  options: readonly (readonly string[])[],
  selectedIndex: number,
  height: number,
): string[] {
  if (height <= 0) {
    return []
  }

  const lines = options.flat()
  const focusStart = options
    .slice(0, selectedIndex)
    .reduce((total, option) => total + option.length, 0)
  const focusHeight = options[selectedIndex]?.length ?? 1
  const visibleFocusHeight = Math.min(focusHeight, height)
  const idealStart = focusStart - Math.floor((height - visibleFocusHeight) / 2)
  const start = Math.max(0, Math.min(idealStart, lines.length - height))

  return lines.slice(start, start + height)
}

function fitHelp(
  help: readonly string[],
  bottomBorder: string,
  height: number,
): string[] {
  if (height <= 0) {
    return []
  }
  if (height === 1) {
    return help.slice(0, 1)
  }

  return [...help.slice(0, height - 1), bottomBorder]
}

function fitViewport(
  layout: QuestionLayout,
  selectedIndex: number,
  height: number,
): string[] {
  if (layout.full.length <= height) {
    return [...layout.full]
  }

  const helpHeight = height >= 5 ? 2 : height >= 4 ? 1 : 0
  const contentHeight = height - helpHeight
  const contextHeight = Math.min(
    layout.header.length + layout.question.length,
    Math.max(0, contentHeight - 1),
    Math.max(2, Math.floor(height / 3)),
  )
  const optionHeight = contentHeight - contextHeight

  return [
    ...fitContext(layout.header, layout.question, contextHeight),
    ...fitOptions(layout.options, selectedIndex, optionHeight),
    ...fitHelp(layout.help, layout.bottomBorder, helpHeight),
  ]
}

class SingleSelectAskComponent implements Component {
  private selectedIndex = 0
  private cachedWidth: number | undefined
  private cachedHeight: number | undefined
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
    const viewportHeight = Math.max(1, this.options.getViewportHeight())
    if (
      this.cachedLines &&
      this.cachedWidth === renderWidth &&
      this.cachedHeight === viewportHeight
    ) {
      return this.cachedLines
    }

    const { question, theme } = this.options
    const wrapWithPrefix = (prefix: string, text: string) => {
      const prefixWidth = visibleWidth(prefix)
      if (prefixWidth >= renderWidth) {
        return wrapTextWithAnsi(prefix + text, renderWidth)
      }

      const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth)
      const continuationPrefix = " ".repeat(prefixWidth)
      return wrapped.map(
        (line, index) =>
          `${index === 0 ? prefix : continuationPrefix}${line}`,
      )
    }

    const topBorder = theme.fg(
      "borderAccent",
      "─".repeat(renderWidth),
    )
    const header = wrapWithPrefix(
      " ",
      theme.bg(
        "selectedBg",
        theme.fg("accent", ` ${question.header} `),
      ),
    )
    const questionLines = wrapWithPrefix(
      " ",
      theme.fg("text", question.question),
    )
    const optionLines = question.options.map((option, index) => {
      const selected = index === this.selectedIndex
      const marker = selected ? theme.fg("accent", "› ") : "  "
      const label = selected
        ? theme.fg("accent", option.label)
        : theme.fg("text", option.label)
      return [
        ...wrapWithPrefix(marker, label),
        ...wrapWithPrefix(
          "    ",
          theme.fg("muted", option.description),
        ),
      ]
    })
    const help = wrapWithPrefix(
      " ",
      theme.fg("dim", "↑↓ move • Enter select • Esc cancel"),
    )
    const bottomBorder = theme.fg(
      "borderAccent",
      "─".repeat(renderWidth),
    )
    const full = [
      topBorder,
      ...header,
      "",
      ...questionLines,
      "",
      ...optionLines.flat(),
      "",
      ...help,
      bottomBorder,
    ]
    const lines = fitViewport(
      {
        full,
        header,
        question: questionLines,
        options: optionLines,
        help,
        bottomBorder,
      },
      this.selectedIndex,
      viewportHeight,
    )

    this.cachedWidth = renderWidth
    this.cachedHeight = viewportHeight
    this.cachedLines = lines
    return lines
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedHeight = undefined
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
            getViewportHeight: () => tui.terminal.rows - 2,
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
