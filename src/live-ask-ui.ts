import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent"
import {
  type Component,
  type KeybindingsManager,
  type TUI,
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
import { sanitizeTerminalText } from "./terminal-text.js"

type Question = Ask["questions"][number]

interface SingleSelectComponentOptions {
  readonly question: Question
  readonly theme: Theme
  readonly keybindings: KeybindingsManager
  readonly getViewportHeight: (width: number) => number
  readonly requestRender: () => void
  readonly done: (answer: Answer | null) => void
}

interface QuestionLayout {
  readonly full: readonly string[]
  readonly context: readonly string[]
  readonly options: readonly (readonly string[])[]
  readonly help: readonly string[]
  readonly bottomBorder: string
}

interface ViewportLayout {
  readonly lines: readonly string[]
  readonly contextHeight: number
  readonly optionHeight: number
}

interface ComponentContainer extends Component {
  readonly children: readonly Component[]
}

function isComponentContainer(
  component: Component,
): component is ComponentContainer {
  return Array.isArray((component as Partial<ComponentContainer>).children)
}

function containsComponent(
  container: Component,
  target: Component,
): boolean {
  if (container === target) {
    return true
  }
  if (!isComponentContainer(container)) {
    return false
  }

  return container.children.some((child) => containsComponent(child, target))
}

function getAvailableComponentHeight(
  tui: TUI,
  component: Component,
  width: number,
): number {
  const hostIndex = tui.children.findIndex((child) =>
    containsComponent(child, component),
  )
  if (hostIndex === -1) {
    return tui.terminal.rows
  }

  const reservedHeight = tui.children
    .slice(hostIndex + 1)
    .reduce((height, child) => height + child.render(width).length, 0)
  return tui.terminal.rows - reservedHeight
}

function fitContext(
  context: readonly string[],
  offset: number,
  height: number,
): string[] {
  if (height <= 0) {
    return []
  }

  const start = Math.min(offset, Math.max(0, context.length - height))
  return context.slice(start, start + height)
}

function fitOptions(
  options: readonly (readonly string[])[],
  selectedIndex: number,
  selectedOptionOffset: number,
  height: number,
): string[] {
  if (height <= 0) {
    return []
  }

  const selectedOption = options[selectedIndex] ?? []
  if (selectedOption.length > height) {
    const offset = Math.min(
      selectedOptionOffset,
      selectedOption.length - height,
    )
    if (height === 1) {
      return selectedOption.slice(offset, offset + 1)
    }

    return [
      ...selectedOption.slice(0, 1),
      ...selectedOption.slice(1 + offset, 1 + offset + height - 1),
    ]
  }

  const lines = options.flat()
  const focusStart = options
    .slice(0, selectedIndex)
    .reduce((total, option) => total + option.length, 0)
  const idealStart = focusStart - Math.floor((height - selectedOption.length) / 2)
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
  contextOffset: number,
  selectedOptionOffset: number,
  height: number,
): ViewportLayout {
  if (layout.full.length <= height) {
    return {
      lines: layout.full,
      contextHeight: layout.context.length,
      optionHeight: layout.options[selectedIndex]?.length ?? 1,
    }
  }

  const helpHeight = height >= 5 ? 2 : height >= 4 ? 1 : 0
  const contentHeight = height - helpHeight
  const contextHeight = Math.min(
    layout.context.length,
    Math.max(0, contentHeight - 1),
    Math.max(2, Math.floor(height / 3)),
  )
  const optionHeight = contentHeight - contextHeight

  return {
    lines: [
      ...fitContext(layout.context, contextOffset, contextHeight),
      ...fitOptions(
        layout.options,
        selectedIndex,
        selectedOptionOffset,
        optionHeight,
      ),
      ...fitHelp(layout.help, layout.bottomBorder, helpHeight),
    ],
    contextHeight,
    optionHeight,
  }
}

class SingleSelectAskComponent implements Component {
  private selectedIndex = 0
  private contextOffset = 0
  private selectedOptionOffset = 0
  private contextLineCount = 0
  private contextViewportHeight = 0
  private optionHeights: readonly number[] = []
  private optionViewportHeight = 1
  private cachedWidth: number | undefined
  private cachedHeight: number | undefined
  private cachedLines: readonly string[] | undefined

  constructor(private readonly options: SingleSelectComponentOptions) {}

  handleInput(data: string): void {
    const { keybindings, question } = this.options

    if (keybindings.matches(data, "tui.select.up")) {
      if (this.contextOffset > 0) {
        this.scrollContext(-1)
      } else if (this.selectedOptionOffset > 0) {
        this.scrollSelectedOption(-1)
      } else {
        this.select(Math.max(0, this.selectedIndex - 1))
      }
      return
    }

    if (keybindings.matches(data, "tui.select.down")) {
      if (this.selectedOptionOffset < this.getSelectedOptionMaxOffset()) {
        this.scrollSelectedOption(1)
      } else if (this.selectedIndex < question.options.length - 1) {
        this.select(this.selectedIndex + 1)
      } else if (this.contextOffset < this.getContextMaxOffset()) {
        this.scrollContext(1)
      }
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
    const viewportHeight = Math.max(
      1,
      this.options.getViewportHeight(renderWidth),
    )
    if (
      this.cachedLines &&
      this.cachedWidth === renderWidth &&
      this.cachedHeight === viewportHeight
    ) {
      return [...this.cachedLines]
    }

    const { question, theme } = this.options
    const headerText = sanitizeTerminalText(question.header)
    const questionText = sanitizeTerminalText(question.question)
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
        theme.fg("accent", ` ${headerText} `),
      ),
    )
    const questionLines = wrapWithPrefix(
      " ",
      theme.fg("text", questionText),
    )
    const optionLines = question.options.map((option, index) => {
      const selected = index === this.selectedIndex
      const marker = selected ? theme.fg("accent", "› ") : "  "
      const labelText = sanitizeTerminalText(option.label)
      const descriptionText = sanitizeTerminalText(option.description)
      const label = selected
        ? theme.fg("accent", labelText)
        : theme.fg("text", labelText)
      return [
        ...wrapWithPrefix(marker, label),
        ...wrapWithPrefix(
          "    ",
          theme.fg("muted", descriptionText),
        ),
      ]
    })
    const help = wrapWithPrefix(
      " ",
      theme.fg("dim", "↑↓ move/read • Enter select • Esc cancel"),
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
    const context = [...header, ...questionLines]
    const viewport = fitViewport(
      {
        full,
        context,
        options: optionLines,
        help,
        bottomBorder,
      },
      this.selectedIndex,
      this.contextOffset,
      this.selectedOptionOffset,
      viewportHeight,
    )

    this.contextLineCount = context.length
    this.contextViewportHeight = viewport.contextHeight
    this.optionHeights = optionLines.map((lines) => lines.length)
    this.optionViewportHeight = viewport.optionHeight
    this.cachedWidth = renderWidth
    this.cachedHeight = viewportHeight
    this.cachedLines = viewport.lines
    return [...viewport.lines]
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedHeight = undefined
    this.cachedLines = undefined
  }

  private getContextMaxOffset(): number {
    return Math.max(0, this.contextLineCount - this.contextViewportHeight)
  }

  private getSelectedOptionMaxOffset(): number {
    return Math.max(
      0,
      (this.optionHeights[this.selectedIndex] ?? 0) -
        this.optionViewportHeight,
    )
  }

  private scrollContext(direction: -1 | 1): void {
    const pageHeight = Math.max(1, this.contextViewportHeight - 1)
    this.contextOffset = Math.max(
      0,
      Math.min(
        this.getContextMaxOffset(),
        this.contextOffset + direction * pageHeight,
      ),
    )
    this.invalidate()
    this.options.requestRender()
  }

  private scrollSelectedOption(direction: -1 | 1): void {
    const pageHeight = Math.max(1, this.optionViewportHeight - 1)
    this.selectedOptionOffset = Math.max(
      0,
      Math.min(
        this.getSelectedOptionMaxOffset(),
        this.selectedOptionOffset + direction * pageHeight,
      ),
    )
    this.invalidate()
    this.options.requestRender()
  }

  private select(index: number): void {
    if (index === this.selectedIndex) {
      return
    }

    this.selectedIndex = index
    this.selectedOptionOffset = 0
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
        ui.custom<Answer | null>((tui, theme, keybindings, done) => {
          let component: SingleSelectAskComponent
          component = new SingleSelectAskComponent({
            question,
            theme,
            keybindings,
            getViewportHeight: (width) =>
              getAvailableComponentHeight(tui, component, width),
            requestRender: () => tui.requestRender(),
            done,
          })
          return component
        }),
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
