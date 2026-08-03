import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent"
import {
  type Component,
  type Focusable,
  Input,
  Key,
  type KeybindingsManager,
  matchesKey,
  type TUI,
  truncateToWidth,
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

type SelectableRow =
  | {
      readonly kind: "option"
      readonly option: Question["options"][number]
    }
  | { readonly kind: "other" }

function getSelectableRows(question: Question): readonly SelectableRow[] {
  return [
    ...question.options.map((option) => ({
      kind: "option" as const,
      option,
    })),
    { kind: "other" as const },
  ]
}

interface QuestionComponentOptions {
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
  readonly helpHeight: number
  readonly singleRow: boolean
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

function formatKeybinding(
  keybindings: KeybindingsManager,
  binding:
    | "tui.select.up"
    | "tui.select.down"
    | "tui.select.pageUp"
    | "tui.select.pageDown"
    | "tui.select.confirm"
    | "tui.select.cancel"
    | "tui.input.submit",
): string {
  const keys = keybindings.getKeys(binding)
  return keys.length > 0 ? keys.join(",") : "unbound"
}

function fitHelp(
  help: readonly string[],
  offset: number,
  bottomBorder: string,
  height: number,
): string[] {
  if (height <= 0) {
    return []
  }

  const contentHeight = height === 1 ? 1 : height - 1
  const start = Math.min(offset, Math.max(0, help.length - contentHeight))
  const lines = help.slice(start, start + contentHeight)
  return height === 1 ? lines : [...lines, bottomBorder]
}

function fitViewport(
  layout: QuestionLayout,
  selectedIndex: number,
  contextOffset: number,
  selectedOptionOffset: number,
  helpOffset: number,
  readingContext: boolean,
  readingHelp: boolean,
  height: number,
): ViewportLayout {
  if (layout.full.length <= height) {
    return {
      lines: layout.full,
      contextHeight: layout.context.length,
      optionHeight: layout.options[selectedIndex]?.length ?? 1,
      helpHeight: layout.help.length,
      singleRow: false,
    }
  }

  if (height === 1) {
    const lines = readingContext
      ? fitContext(layout.context, contextOffset, 1)
      : readingHelp
        ? fitHelp(layout.help, helpOffset, layout.bottomBorder, 1)
        : fitOptions(
            layout.options,
            selectedIndex,
            selectedOptionOffset,
            1,
          )
    return {
      lines,
      contextHeight: 1,
      optionHeight: 1,
      helpHeight: 1,
      singleRow: true,
    }
  }

  const helpBlockHeight =
    height >= 5 ? 2 : height >= 4 || readingHelp ? 1 : 0
  const contentHeight = height - helpBlockHeight
  const contextHeight = Math.min(
    layout.context.length,
    Math.max(0, contentHeight - 1),
    Math.max(2, Math.floor(height / 3)),
  )
  const optionHeight = contentHeight - contextHeight
  const helpHeight = helpBlockHeight === 2 ? 1 : helpBlockHeight

  return {
    lines: [
      ...fitContext(layout.context, contextOffset, contextHeight),
      ...fitOptions(
        layout.options,
        selectedIndex,
        selectedOptionOffset,
        optionHeight,
      ),
      ...fitHelp(
        layout.help,
        helpOffset,
        layout.bottomBorder,
        helpBlockHeight,
      ),
    ],
    contextHeight,
    optionHeight,
    helpHeight,
    singleRow: false,
  }
}

class QuestionAskComponent implements Component, Focusable {
  private selectedIndex = 0
  private selectedOptionIndexes = new Set<number>()
  private enteringOther = false
  private otherValidationError = false
  private multiSelectValidationError = false
  private otherInput = new Input()
  private _focused = false
  private contextOffset = 0
  private selectedOptionOffset = 0
  private helpOffset = 0
  private readingContext = false
  private readingHelp = false
  private singleRowViewport = false
  private contextLineCount = 0
  private contextViewportHeight = 0
  private optionHeights: readonly number[] = []
  private optionViewportHeight = 1
  private helpLineCount = 0
  private helpViewportHeight = 0
  private cachedWidth: number | undefined
  private cachedHeight: number | undefined
  private cachedLines: readonly string[] | undefined

  constructor(private readonly options: QuestionComponentOptions) {}

  get focused(): boolean {
    return this._focused
  }

  set focused(value: boolean) {
    this._focused = value
    this.otherInput.focused = value && this.enteringOther
  }

  handleInput(data: string): void {
    const { keybindings, question } = this.options

    if (this.enteringOther) {
      if (keybindings.matches(data, "tui.select.cancel")) {
        this.leaveOther()
        return
      }

      if (keybindings.matches(data, "tui.input.submit")) {
        this.submitOther()
        return
      }

      const previousValue = this.otherInput.getValue()
      this.otherInput.handleInput(data)
      const sanitized = sanitizeTerminalText(this.otherInput.getValue())
      if (sanitized !== this.otherInput.getValue()) {
        this.otherInput.setValue(sanitized)
      }
      if (this.otherInput.getValue() !== previousValue) {
        this.otherValidationError = false
      }
      this.refresh()
      return
    }

    const rows = getSelectableRows(question)

    if (question.multiSelect && matchesKey(data, Key.space)) {
      const selected = rows[this.selectedIndex]
      if (selected?.kind === "option") {
        this.toggleOption(this.selectedIndex)
      }
      return
    }

    if (keybindings.matches(data, "tui.select.up")) {
      this.select(Math.max(0, this.selectedIndex - 1))
      return
    }

    if (keybindings.matches(data, "tui.select.down")) {
      this.select(
        Math.min(rows.length - 1, this.selectedIndex + 1),
      )
      return
    }

    if (keybindings.matches(data, "tui.select.pageUp")) {
      this.scrollReadingViewport(-1)
      return
    }

    if (keybindings.matches(data, "tui.select.pageDown")) {
      this.scrollReadingViewport(1)
      return
    }

    if (keybindings.matches(data, "tui.select.confirm")) {
      const selected = rows[this.selectedIndex]
      if (selected?.kind === "other") {
        this.enterOther()
      } else if (selected && question.multiSelect) {
        if (this.selectedOptionIndexes.size === 0) {
          this.multiSelectValidationError = true
          this.selectedOptionOffset = Number.MAX_SAFE_INTEGER
          this.refresh()
        } else {
          this.options.done({
            selectedLabels: question.options
              .filter((_option, index) =>
                this.selectedOptionIndexes.has(index),
              )
              .map((option) => option.label),
          })
        }
      } else if (selected) {
        this.options.done({
          selectedLabels: [selected.option.label],
        })
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

    const { question, theme, keybindings } = this.options
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
    const optionLines = getSelectableRows(question).map((row, index) => {
      const selected = index === this.selectedIndex
      const highlightMarker = selected ? theme.fg("accent", "› ") : "  "
      const toggleMarker =
        question.multiSelect && row.kind === "option"
          ? this.selectedOptionIndexes.has(index)
            ? theme.fg("accent", "[x] ")
            : "[ ] "
          : ""
      const marker = `${highlightMarker}${toggleMarker}`
      const labelText =
        row.kind === "other"
          ? "Other"
          : sanitizeTerminalText(row.option.label)
      const label = selected
        ? theme.fg("accent", labelText)
        : theme.fg("text", labelText)

      if (row.kind === "other" && this.enteringOther) {
        const labeledInputPrefix = `${marker}${label}: `
        const inputPrefix =
          visibleWidth(labeledInputPrefix) < renderWidth
            ? labeledInputPrefix
            : ""
        const inputWidth = Math.max(
          1,
          renderWidth - visibleWidth(inputPrefix),
        )
        const lines = this.otherInput
          .render(inputWidth)
          .map((line) =>
            truncateToWidth(`${inputPrefix}${line}`, renderWidth, ""),
          )
        if (this.otherValidationError) {
          lines.push(
            ...wrapWithPrefix(
              "    ",
              theme.fg("warning", "Enter a free-text Answer."),
            ),
          )
        }
        return lines
      }

      const descriptionText =
        row.kind === "other"
          ? "Type a free-text Answer."
          : sanitizeTerminalText(row.option.description)
      const detailPrefix =
        question.multiSelect && row.kind === "option" ? "      " : "    "
      const lines = [
        ...wrapWithPrefix(marker, label),
        ...wrapWithPrefix(
          detailPrefix,
          theme.fg("muted", descriptionText),
        ),
      ]
      if (
        question.multiSelect &&
        selected &&
        this.multiSelectValidationError
      ) {
        lines.push(
          ...wrapWithPrefix(
            detailPrefix,
            theme.fg(
              "warning",
              "Select at least one Option or choose Other.",
            ),
          ),
        )
      }
      return lines
    })
    const moveUp = formatKeybinding(keybindings, "tui.select.up")
    const moveDown = formatKeybinding(keybindings, "tui.select.down")
    const readUp = formatKeybinding(keybindings, "tui.select.pageUp")
    const readDown = formatKeybinding(keybindings, "tui.select.pageDown")
    const confirm = formatKeybinding(keybindings, "tui.select.confirm")
    const submit = formatKeybinding(keybindings, "tui.input.submit")
    const cancel = formatKeybinding(keybindings, "tui.select.cancel")
    const helpText = this.enteringOther
      ? `submit ${submit} • back ${cancel}`
      : question.multiSelect
        ? `move ${moveUp} / ${moveDown} • read ${readUp} / ${readDown} • toggle space • confirm ${confirm} • cancel ${cancel}`
        : `move ${moveUp} / ${moveDown} • read ${readUp} / ${readDown} • select ${confirm} • cancel ${cancel}`
    const help = wrapWithPrefix(
      " ",
      theme.fg("dim", helpText),
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
      this.helpOffset,
      this.readingContext,
      this.readingHelp,
      viewportHeight,
    )

    this.contextLineCount = context.length
    this.contextViewportHeight = viewport.contextHeight
    this.optionHeights = optionLines.map((lines) => lines.length)
    this.optionViewportHeight = viewport.optionHeight
    this.helpLineCount = help.length
    this.helpViewportHeight = viewport.helpHeight
    this.singleRowViewport = viewport.singleRow
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

  private toggleOption(index: number): void {
    if (this.selectedOptionIndexes.has(index)) {
      this.selectedOptionIndexes.delete(index)
    } else {
      this.selectedOptionIndexes.add(index)
    }
    this.multiSelectValidationError = false
    this.selectedOptionOffset = 0
    this.refresh()
  }

  private enterOther(): void {
    this.enteringOther = true
    this.otherValidationError = false
    this.multiSelectValidationError = false
    this.otherInput = new Input()
    this.otherInput.focused = this._focused
    this.selectedOptionOffset = 0
    this.readingContext = false
    this.readingHelp = false
    this.refresh()
  }

  private leaveOther(): void {
    this.enteringOther = false
    this.otherValidationError = false
    this.otherInput.focused = false
    this.refresh()
  }

  private submitOther(): void {
    const otherText = this.otherInput.getValue().trim()
    if (otherText.length === 0) {
      this.otherValidationError = true
      this.refresh()
      return
    }

    this.options.done({ selectedLabels: [], otherText })
  }

  private refresh(): void {
    this.invalidate()
    this.options.requestRender()
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

  private getHelpMaxOffset(): number {
    return Math.max(0, this.helpLineCount - this.helpViewportHeight)
  }

  private scrollReadingViewport(direction: -1 | 1): void {
    if (this.singleRowViewport) {
      this.scrollSingleRowViewport(direction)
      return
    }

    if (direction === -1) {
      if (this.readingHelp) {
        if (this.helpOffset > 0) {
          this.scrollHelp(-1)
        } else {
          this.hideHelp()
        }
      } else if (this.helpOffset > 0) {
        this.scrollHelp(-1)
      } else if (this.selectedOptionOffset > 0) {
        this.scrollSelectedOption(-1)
      } else if (this.contextOffset > 0) {
        this.scrollContext(-1)
      }
      return
    }

    if (this.readingHelp) {
      if (this.helpOffset < this.getHelpMaxOffset()) {
        this.scrollHelp(1)
      }
    } else if (this.contextOffset < this.getContextMaxOffset()) {
      this.scrollContext(1)
    } else if (
      this.selectedOptionOffset < this.getSelectedOptionMaxOffset()
    ) {
      this.scrollSelectedOption(1)
    } else if (this.helpViewportHeight === 0) {
      this.showHelp(0)
    } else if (this.helpOffset < this.getHelpMaxOffset()) {
      this.scrollHelp(1)
    }
  }

  private scrollSingleRowViewport(direction: -1 | 1): void {
    if (this.readingContext) {
      if (direction === -1 && this.contextOffset > 0) {
        this.scrollContext(-1)
      } else if (
        direction === 1 &&
        this.contextOffset < this.getContextMaxOffset()
      ) {
        this.scrollContext(1)
      } else if (direction === -1) {
        this.showOption(this.getSelectedOptionMaxOffset())
      } else {
        this.showOption(0)
      }
      return
    }

    if (this.readingHelp) {
      if (direction === -1 && this.helpOffset > 0) {
        this.scrollHelp(-1)
      } else if (
        direction === 1 &&
        this.helpOffset < this.getHelpMaxOffset()
      ) {
        this.scrollHelp(1)
      } else if (direction === -1) {
        this.showOption(this.getSelectedOptionMaxOffset())
      } else {
        this.showContext(0)
      }
      return
    }

    if (direction === -1 && this.selectedOptionOffset > 0) {
      this.scrollSelectedOption(-1)
    } else if (
      direction === 1 &&
      this.selectedOptionOffset < this.getSelectedOptionMaxOffset()
    ) {
      this.scrollSelectedOption(1)
    } else if (direction === -1) {
      this.showContext(this.getContextMaxOffset())
    } else {
      this.showHelp(0)
    }
  }

  private showContext(offset: number): void {
    this.readingContext = true
    this.readingHelp = false
    this.contextOffset = offset
    this.invalidate()
    this.options.requestRender()
  }

  private showOption(offset: number): void {
    this.readingContext = false
    this.readingHelp = false
    this.selectedOptionOffset = offset
    this.invalidate()
    this.options.requestRender()
  }

  private showHelp(offset: number): void {
    this.readingContext = false
    this.readingHelp = true
    this.helpOffset = offset
    this.invalidate()
    this.options.requestRender()
  }

  private hideHelp(): void {
    this.readingHelp = false
    this.invalidate()
    this.options.requestRender()
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

  private scrollHelp(direction: -1 | 1): void {
    const pageHeight = Math.max(1, this.helpViewportHeight)
    this.helpOffset = Math.max(
      0,
      Math.min(
        this.getHelpMaxOffset(),
        this.helpOffset + direction * pageHeight,
      ),
    )
    this.invalidate()
    this.options.requestRender()
  }

  private select(index: number): void {
    const changed =
      index !== this.selectedIndex ||
      this.selectedOptionOffset !== 0 ||
      this.readingContext ||
      this.readingHelp
    if (!changed) {
      return
    }

    this.selectedIndex = index
    this.selectedOptionOffset = 0
    this.helpOffset = 0
    this.readingContext = false
    this.readingHelp = false
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
      if (ask.questions.length !== 1) {
        return Effect.die(new Error("AskUI supports one Question."))
      }

      return Effect.async<Answer | null>((resume) => {
        let settled = false
        let dismiss = () => {}
        const custom = ui.custom<Answer | null>(
          (tui, theme, keybindings, done) => {
            const complete = (answer: Answer | null) => {
              if (settled) {
                return
              }
              settled = true
              done(answer)
              resume(Effect.succeed(answer))
            }
            dismiss = () => complete(null)

            let component: QuestionAskComponent
            component = new QuestionAskComponent({
              question,
              theme,
              keybindings,
              getViewportHeight: (width) =>
                getAvailableComponentHeight(tui, component, width),
              requestRender: () => tui.requestRender(),
              done: complete,
            })
            return component
          },
        )

        void custom.catch((error: unknown) => {
          if (settled) {
            return
          }
          settled = true
          resume(Effect.die(error))
        })

        return Effect.sync(() => dismiss())
      }).pipe(
        Effect.flatMap((answer) =>
          answer === null
            ? Effect.fail(new UserCancelled())
            : Effect.succeed([answer]),
        ),
      )
    },
  })
}
