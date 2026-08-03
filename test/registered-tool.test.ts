import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import {
  type Component,
  type KeybindingsConfig,
  KeybindingsManager,
  TUI_KEYBINDINGS,
  type TUI,
} from "@earendil-works/pi-tui"
import { Effect, Layer } from "effect"
import { Value } from "typebox/value"
import { describe, expect, it, vi } from "vitest"

import createAskUserQuestionExtension from "../src/index.js"
import {
  AskUI,
  UserCancelled,
  type Answer,
  type AskUIService,
} from "../src/ask-ui.js"
import {
  AskParameters,
  type Ask,
  type AskResultDetails,
} from "../src/schema.js"

type AskTool = ToolDefinition<typeof AskParameters, AskResultDetails>
type AskRenderContext = Parameters<NonNullable<AskTool["renderCall"]>>[2]
type AskToolResult = Parameters<NonNullable<AskTool["renderResult"]>>[0]

const singleQuestionAsk: Ask = {
  questions: [
    {
      header: "Runtime",
      question: "Which runtime should this package use?",
      multiSelect: false,
      options: [
        { label: "Bun", description: "Use Bun for scripts and dependencies." },
        { label: "Node", description: "Use Node and npm for package tasks." },
      ],
    },
  ],
}

const runtimeQuestion = singleQuestionAsk.questions[0]
if (!runtimeQuestion) {
  throw new Error("The test Ask needs a Runtime Question.")
}

const multiSelectAsk: Ask = {
  questions: [
    {
      header: "Checks",
      question: "Which checks should this package run?",
      multiSelect: true,
      options: [
        { label: "Lint", description: "Check source formatting and style." },
        { label: "Tests", description: "Run the automated test suite." },
        { label: "Types", description: "Check static TypeScript types." },
      ],
    },
  ],
}

const fourQuestionAsk: Ask = {
  questions: [
    runtimeQuestion,
    {
      header: "Deploy",
      question: "Where should this package run?",
      multiSelect: false,
      options: [
        { label: "Local", description: "Run it on this machine." },
        { label: "Cloud", description: "Run it on hosted infrastructure." },
      ],
    },
    {
      header: "Tests",
      question: "When should the test suite run?",
      multiSelect: false,
      options: [
        { label: "Commit", description: "Run it before each commit." },
        { label: "CI", description: "Run it in continuous integration." },
      ],
    },
    {
      header: "Theme",
      question: "Which interface theme should this package use?",
      multiSelect: false,
      options: [
        { label: "Light", description: "Use a light background." },
        { label: "Dark", description: "Use a dark background." },
      ],
    },
  ],
}

function stubAskUILayer(service: AskUIService) {
  return Layer.succeed(AskUI, service)
}

function captureTool(layer?: Layer.Layer<AskUI>) {
  let captured: AskTool | undefined
  const api = {
    registerTool(tool: AskTool) {
      captured = tool
    },
  } as unknown as ExtensionAPI

  createAskUserQuestionExtension(api, layer)

  if (!captured) {
    throw new Error("The extension did not register ask_user_question")
  }

  return captured
}

function context(mode: ExtensionContext["mode"]): ExtensionContext {
  return { mode } as ExtensionContext
}

function containsTerminalControl(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0)
    return code !== undefined && (code <= 0x1f || (code >= 0x7f && code <= 0x9f))
  })
}

function transcriptTheme(): Theme {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
    inverse: vi.fn((text: string) => text),
  } as unknown as Theme
}

function renderContext(
  args: Ask,
  overrides: Partial<AskRenderContext> = {},
): AskRenderContext {
  return {
    args,
    toolCallId: "ask-render",
    invalidate: vi.fn(),
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
    ...overrides,
  }
}

function renderCall(tool: AskTool, ask: Ask, expanded: boolean): string {
  if (!tool.renderCall) {
    throw new Error("ask_user_question has no call renderer")
  }

  return tool
    .renderCall(ask, transcriptTheme(), renderContext(ask, { expanded }))
    .render(100)
    .map((line) => line.trimEnd())
    .join("\n")
}

function renderResult(
  tool: AskTool,
  ask: Ask,
  result: AskToolResult,
  expanded: boolean,
  isError = false,
): string {
  if (!tool.renderResult) {
    throw new Error("ask_user_question has no result renderer")
  }

  return tool
    .renderResult(
      result,
      { expanded, isPartial: false },
      transcriptTheme(),
      renderContext(ask, { expanded, isError }),
    )
    .render(100)
    .map((line) => line.trimEnd())
    .join("\n")
}

function interactiveContext(
  drive: (component: Component) => void,
  terminalRows = 24,
  rowsAfterComponent: readonly number[] = [2],
  keybindingOverrides: KeybindingsConfig = {},
  onClose?: () => void,
  onTheme?: (theme: Theme) => void,
): ExtensionContext {
  const tui = {
    children: [] as Component[],
    requestRender: vi.fn(),
    terminal: { rows: terminalRows },
  } as unknown as TUI
  const theme = {
    fg: vi.fn((_color: string, text: string) => text),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
  } as unknown as Theme
  onTheme?.(theme)
  const keybindings = new KeybindingsManager(
    TUI_KEYBINDINGS,
    keybindingOverrides,
  )
  const ui = {
    custom<T>(
      factory: (
        tui: TUI,
        theme: Theme,
        keybindings: KeybindingsManager,
        done: (result: T) => void,
      ) => Component | Promise<Component>,
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const done = (result: T) => {
          tui.children.length = 0
          onClose?.()
          resolve(result)
        }
        void Promise.resolve(factory(tui, theme, keybindings, done)).then(
          (component) => {
            const componentHost = {
              children: [component],
              render: (width: number) => component.render(width),
              invalidate: () => component.invalidate(),
            }
            const trailingComponents = rowsAfterComponent.map((height) => ({
              render: () => Array.from({ length: height }, () => ""),
              invalidate: () => {},
            }))
            tui.children.push(componentHost, ...trailingComponents)
            try {
              drive(component)
            } catch (error) {
              reject(error)
            }
          },
          reject,
        )
      })
    },
  }

  return { mode: "tui", ui } as unknown as ExtensionContext
}

describe("ask_user_question registration", () => {
  it("registers the full tool and prompt metadata", () => {
    const tool = captureTool()

    expect(tool.name).toBe("ask_user_question")
    expect(tool.promptSnippet).toContain("ask_user_question")
    expect(tool.promptGuidelines).not.toHaveLength(0)
    expect(tool.promptGuidelines?.every((line) => line.includes("ask_user_question"))).toBe(true)
  })

  it("enforces the Question, Option, and Header bounds", () => {
    const question = singleQuestionAsk.questions[0]
    if (!question) {
      throw new Error("The test Ask needs one Question")
    }

    expect(Value.Check(AskParameters, { questions: [] })).toBe(false)
    expect(
      Value.Check(AskParameters, {
        questions: Array.from({ length: 5 }, () => question),
      }),
    ).toBe(false)
    expect(
      Value.Check(AskParameters, {
        questions: [{ ...question, header: "1234567890123" }],
      }),
    ).toBe(false)
    expect(
      Value.Check(AskParameters, {
        questions: [{ ...question, options: question.options.slice(0, 1) }],
      }),
    ).toBe(false)
    expect(
      Value.Check(AskParameters, {
        questions: [
          {
            ...question,
            options: Array.from({ length: 5 }, (_, index) => ({
              label: `Option ${index + 1}`,
              description: "A bounded Option.",
            })),
          },
        ],
      }),
    ).toBe(false)
    expect(
      Value.Check(AskParameters, {
        questions: Array.from({ length: 4 }, () => ({
          ...question,
          header: "123456789012",
          options: Array.from({ length: 4 }, (_, index) => ({
            label: `Option ${index + 1}`,
            description: "A bounded Option.",
          })),
        })),
      }),
    ).toBe(true)
    expect(Value.Check(AskParameters, singleQuestionAsk)).toBe(true)
  })
})

describe("ask_user_question transcript rendering", () => {
  const twoQuestionAsk: Ask = {
    questions: [
      runtimeQuestion,
      {
        header: "Deploy",
        question: "Where should this package run?",
        multiSelect: false,
        options: [
          { label: "Local", description: "Run it on this machine." },
          { label: "Cloud", description: "Run it on hosted infrastructure." },
        ],
      },
    ],
  }

  it.each([false, true])(
    "renders pending Header chips and Question text when expanded is %s",
    (expanded) => {
      const tool = captureTool()
      const theme = transcriptTheme()
      if (!tool.renderCall) {
        throw new Error("ask_user_question has no call renderer")
      }

      const rendered = tool
        .renderCall(
          twoQuestionAsk,
          theme,
          renderContext(twoQuestionAsk, { expanded }),
        )
        .render(100)
        .map((line) => line.trimEnd())
        .join("\n")

      expect(rendered).toContain("Runtime")
      expect(rendered).toContain("Which runtime should this package use?")
      expect(rendered).toContain("Deploy")
      expect(rendered).toContain("Where should this package run?")
      expect(rendered).not.toContain('"questions"')
      expect(theme.inverse).toHaveBeenCalledWith(expect.any(String))
      expect(theme.bg).not.toHaveBeenCalled()
      expect(theme.fg).toHaveBeenCalledWith("toolTitle", expect.any(String))
    },
  )

  it("renders safely before the model completes the Ask arguments", () => {
    const tool = captureTool()
    const partialAsk = {} as Ask

    expect(() => renderCall(tool, partialAsk, false)).not.toThrow()
    expect(renderCall(tool, partialAsk, false)).toBe("Ask User Question")
  })

  it.each([false, true])(
    "renders one Header and Answer line when expanded is %s",
    (expanded) => {
      const tool = captureTool()
      const result: AskToolResult = {
        content: [
          { type: "text", text: 'Runtime: "A custom runtime" (other)\nDeploy: Cloud' },
        ],
        details: {
          answers: [
            {
              header: "Runtime",
              question: "Which runtime should this package use?",
              selectedLabels: [],
              otherText: "A custom runtime",
            },
            {
              header: "Deploy",
              question: "Where should this package run?",
              selectedLabels: ["Cloud"],
            },
          ],
        },
      }

      const rendered = renderResult(
        tool,
        twoQuestionAsk,
        result,
        expanded,
      )

      expect(rendered.split("\n")).toEqual([
        ' Runtime  "A custom runtime" (other)',
        " Deploy  Cloud",
      ])
      expect(rendered).not.toContain('"answers"')
    },
  )

  it("renders selected Labels alongside Other text", () => {
    const tool = captureTool()
    const result: AskToolResult = {
      content: [
        {
          type: "text",
          text: 'Checks: Lint, Types, "Run security scans" (other)',
        },
      ],
      details: {
        answers: [
          {
            header: "Checks",
            question: "Which checks should this package run?",
            selectedLabels: ["Lint", "Types"],
            otherText: "Run security scans",
          },
        ],
      },
    }

    expect(renderResult(tool, multiSelectAsk, result, false)).toBe(
      ' Checks  Lint, Types, "Run security scans" (other)',
    )
  })

  it("renders declined and no-user errors clearly", () => {
    const tool = captureTool()
    const errors = [
      "The user declined this Ask. Do not repeat ask_user_question immediately. Continue using your own judgment.",
      "No interactive user is available for ask_user_question. Continue using your own judgment.",
    ]

    for (const message of errors) {
      const result = {
        content: [{ type: "text", text: message }],
        details: undefined,
      } as unknown as AskToolResult
      const rendered = renderResult(
        tool,
        singleQuestionAsk,
        result,
        false,
        true,
      )

      expect(rendered.replaceAll("\n", " ")).toBe(message)
      expect(rendered).not.toContain('"content"')
    }
  })

  it("sanitizes every model-provided transcript string", () => {
    const ask: Ask = {
      questions: [
        {
          header: "Run\x1b]52;c;owned\x07",
          question: "Choose\x1b[31m safely",
          multiSelect: false,
          options: [
            { label: "Bun", description: "Fast runtime." },
            { label: "Node", description: "Node runtime." },
          ],
        },
      ],
    }
    const tool = captureTool()
    const pending = renderCall(tool, ask, false)
    const finished = renderResult(
      tool,
      ask,
      {
        content: [{ type: "text", text: "ignored raw result" }],
        details: {
          answers: [
            {
              header: "Run\x1b]52;c;owned\x07",
              question: "Choose\x1b[31m safely",
              selectedLabels: ["Bun\x1b[2J"],
            },
          ],
        },
      },
      true,
    )

    for (const rendered of [pending, finished]) {
      expect(
        rendered
          .split("\n")
          .every((line) => !containsTerminalControl(line)),
      ).toBe(true)
      expect(rendered).not.toContain("owned")
      expect(rendered).not.toContain("[31m")
      expect(rendered).not.toContain("[2J")
    }
    expect(pending).toContain("Choose safely")
    expect(finished).toContain("Bun")
  })
})

describe("ask_user_question execution seam", () => {
  it("returns Answer lines and structured details from an AskUI Layer", async () => {
    const answers: readonly Answer[] = [{ selectedLabels: ["Bun"] }]
    const ask = vi.fn((_ask: Ask) => Effect.succeed(answers))
    const tool = captureTool(stubAskUILayer({ ask }))

    const result = await tool.execute(
      "ask-1",
      singleQuestionAsk,
      undefined,
      undefined,
      context("tui"),
    )

    expect(ask).toHaveBeenCalledWith(singleQuestionAsk)
    expect(result).toEqual({
      content: [{ type: "text", text: "Runtime: Bun" }],
      details: {
        answers: [
          {
            header: "Runtime",
            question: "Which runtime should this package use?",
            selectedLabels: ["Bun"],
          },
        ],
      },
    })
  })

  it("returns one Label for a multiSelect Answer through the AskUI seam", async () => {
    const answers: readonly Answer[] = [{ selectedLabels: ["Tests"] }]
    const tool = captureTool(
      stubAskUILayer({ ask: () => Effect.succeed(answers) }),
    )

    const result = await tool.execute(
      "ask-multiselect-one-seam",
      multiSelectAsk,
      undefined,
      undefined,
      context("tui"),
    )

    expect(result).toEqual({
      content: [{ type: "text", text: "Checks: Tests" }],
      details: {
        answers: [
          {
            header: "Checks",
            question: "Which checks should this package run?",
            selectedLabels: ["Tests"],
          },
        ],
      },
    })
  })

  it("returns several Labels for a multiSelect Answer through the AskUI seam", async () => {
    const answers: readonly Answer[] = [
      { selectedLabels: ["Lint", "Types"] },
    ]
    const tool = captureTool(
      stubAskUILayer({ ask: () => Effect.succeed(answers) }),
    )

    const result = await tool.execute(
      "ask-multiselect-several-seam",
      multiSelectAsk,
      undefined,
      undefined,
      context("tui"),
    )

    expect(result).toEqual({
      content: [{ type: "text", text: "Checks: Lint, Types" }],
      details: {
        answers: [
          {
            header: "Checks",
            question: "Which checks should this package run?",
            selectedLabels: ["Lint", "Types"],
          },
        ],
      },
    })
  })

  it("returns selected Labels with Other text through the AskUI seam", async () => {
    const answers: readonly Answer[] = [
      {
        selectedLabels: ["Lint", "Types"],
        otherText: "Run security scans",
      },
    ]
    const tool = captureTool(
      stubAskUILayer({ ask: () => Effect.succeed(answers) }),
    )

    const result = await tool.execute(
      "ask-multiselect-other-seam",
      multiSelectAsk,
      undefined,
      undefined,
      context("tui"),
    )

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: 'Checks: Lint, Types, "Run security scans" (other)',
        },
      ],
      details: {
        answers: [
          {
            header: "Checks",
            question: "Which checks should this package run?",
            selectedLabels: ["Lint", "Types"],
            otherText: "Run security scans",
          },
        ],
      },
    })
  })

  it("returns a quoted Other Answer through the AskUI seam", async () => {
    const answers: readonly Answer[] = [
      { selectedLabels: [], otherText: "Use Deno" },
    ]
    const tool = captureTool(
      stubAskUILayer({ ask: () => Effect.succeed(answers) }),
    )

    const result = await tool.execute(
      "ask-other-seam",
      singleQuestionAsk,
      undefined,
      undefined,
      context("tui"),
    )

    expect(result).toEqual({
      content: [
        { type: "text", text: 'Runtime: "Use Deno" (other)' },
      ],
      details: {
        answers: [
          {
            header: "Runtime",
            question: "Which runtime should this package use?",
            selectedLabels: [],
            otherText: "Use Deno",
          },
        ],
      },
    })
  })

  it("throws a declined error when AskUI cancels the Ask", async () => {
    const tool = captureTool(
      stubAskUILayer({ ask: () => Effect.fail(new UserCancelled()) }),
    )

    await expect(
      tool.execute(
        "ask-2",
        singleQuestionAsk,
        undefined,
        undefined,
        context("tui"),
      ),
    ).rejects.toThrow(/user declined.*do not repeat ask_user_question/i)
  })

  it("returns four Answers in Ask order and renders every Header chip", async () => {
    let theme: Theme | undefined
    const activeHeaders: string[] = []
    const renderedHeaders: string[][] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-four-questions",
      fourQuestionAsk,
      undefined,
      undefined,
      interactiveContext(
        (component) => {
          for (const [index] of fourQuestionAsk.questions.entries()) {
            const lines = component.render(100)
            renderedHeaders.push(lines)
            if (!theme) {
              throw new Error("The test needs the component Theme")
            }
            const background = theme.bg as unknown as {
              readonly mock: {
                readonly calls: readonly (readonly [string, string])[]
              }
              readonly mockClear: () => void
            }
            const activeCall = background.mock.calls.findLast(
              ([color]) => color === "selectedBg",
            )
            activeHeaders.push(String(activeCall?.[1]))
            background.mockClear()

            if (index % 2 === 1) {
              component.handleInput?.("\x1b[B")
            }
            component.handleInput?.("\r")
          }
        },
        24,
        [2],
        {},
        undefined,
        (componentTheme) => {
          theme = componentTheme
        },
      ),
    )

    for (const lines of renderedHeaders) {
      const rendered = lines.join("\n")
      for (const question of fourQuestionAsk.questions) {
        expect(rendered).toContain(question.header)
      }
    }
    expect(activeHeaders).toEqual([
      " Runtime ",
      " Deploy ",
      " Tests ",
      " Theme ",
    ])
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Runtime: Bun\nDeploy: Cloud\nTests: Commit\nTheme: Dark",
        },
      ],
      details: {
        answers: [
          {
            header: "Runtime",
            question: "Which runtime should this package use?",
            selectedLabels: ["Bun"],
          },
          {
            header: "Deploy",
            question: "Where should this package run?",
            selectedLabels: ["Cloud"],
          },
          {
            header: "Tests",
            question: "When should the test suite run?",
            selectedLabels: ["Commit"],
          },
          {
            header: "Theme",
            question: "Which interface theme should this package use?",
            selectedLabels: ["Dark"],
          },
        ],
      },
    })
  })

  it("lets the user revise an answered Question before the last Answer", async () => {
    let renderedHelp: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-revise-answer",
      fourQuestionAsk,
      undefined,
      undefined,
      interactiveContext(
        (component) => {
          renderedHelp = component.render(100)
          component.handleInput?.("\r")
          component.handleInput?.("h")
          component.handleInput?.("\x1b[B")
          component.handleInput?.("\r")
          component.handleInput?.("\r")
          component.handleInput?.("\r")
          component.handleInput?.("\r")
        },
        24,
        [2],
        {
          "tui.editor.cursorLeft": "h",
          "tui.editor.cursorRight": "l",
        },
      ),
    )

    expect(renderedHelp.join("\n")).toContain("Question h / l")
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Runtime: Node\nDeploy: Local\nTests: Commit\nTheme: Light",
      },
    ])
    expect(result.details?.answers[0]?.selectedLabels).toEqual(["Node"])
  })

  it("cancels the whole Ask after a partial multi-Question Answer", async () => {
    const tool = captureTool()

    await expect(
      tool.execute(
        "ask-production-multi-cancel",
        fourQuestionAsk,
        undefined,
        undefined,
        interactiveContext((component) => {
          component.handleInput?.("\r")
          component.handleInput?.("\x1b")
        }),
      ),
    ).rejects.toThrow(/user declined.*do not repeat ask_user_question/i)
  })

  it("returns the highlighted Option through the production AskUI Layer", async () => {
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production",
      singleQuestionAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\r")
      }),
    )

    expect(result).toEqual({
      content: [{ type: "text", text: "Runtime: Node" }],
      details: {
        answers: [
          {
            header: "Runtime",
            question: "Which runtime should this package use?",
            selectedLabels: ["Node"],
          },
        ],
      },
    })
  })

  it("renders toggle markers and returns several selected Labels", async () => {
    let initialRows: string[] = []
    let toggledRows: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-multiselect-several",
      multiSelectAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        initialRows = component.render(80)
        component.handleInput?.(" ")
        component.handleInput?.("\x1b[B")
        component.handleInput?.(" ")
        toggledRows = component.render(80)
        component.handleInput?.("\r")
      }),
    )

    expect(initialRows.join("\n")).toContain("› [ ] Lint")
    expect(initialRows.join("\n")).toContain("  [ ] Tests")
    expect(initialRows.join("\n")).toContain("  [ ] Types")
    expect(toggledRows.join("\n")).toContain("  [x] Lint")
    expect(toggledRows.join("\n")).toContain("› [x] Tests")
    expect(result).toEqual({
      content: [{ type: "text", text: "Checks: Lint, Tests" }],
      details: {
        answers: [
          {
            header: "Checks",
            question: "Which checks should this package run?",
            selectedLabels: ["Lint", "Tests"],
          },
        ],
      },
    })
  })

  it("shows a hint until a multiSelect Answer contains a Label", async () => {
    let renderedAfterEmpty: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-multiselect-one",
      multiSelectAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        component.handleInput?.(" ")
        component.handleInput?.(" ")
        component.handleInput?.("\r")
        renderedAfterEmpty = component.render(80)
        component.handleInput?.("\x1b[B")
        component.handleInput?.(" ")
        component.handleInput?.("\r")
      }, 3),
    )

    expect(renderedAfterEmpty).toHaveLength(1)
    expect(renderedAfterEmpty.join("\n")).toContain(
      "Select at least one Option or choose Other.",
    )
    expect(result.content).toEqual([
      { type: "text", text: "Checks: Tests" },
    ])
    expect(result.details?.answers[0]?.selectedLabels).toEqual(["Tests"])
  })

  it("accepts Other as a multiSelect Answer without selected Labels", async () => {
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-multiselect-other",
      multiSelectAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\r")
        component.handleInput?.("Run security scans")
        component.handleInput?.("\r")
      }),
    )

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: 'Checks: "Run security scans" (other)',
        },
      ],
      details: {
        answers: [
          {
            header: "Checks",
            question: "Which checks should this package run?",
            selectedLabels: [],
            otherText: "Run security scans",
          },
        ],
      },
    })
  })

  it("preserves selected Labels when Other adds free text", async () => {
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-multiselect-labels-and-other",
      multiSelectAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        component.handleInput?.(" ")
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\r")
        component.handleInput?.("Run security scans")
        component.handleInput?.("\r")
      }),
    )

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: 'Checks: Lint, "Run security scans" (other)',
        },
      ],
      details: {
        answers: [
          {
            header: "Checks",
            question: "Which checks should this package run?",
            selectedLabels: ["Lint"],
            otherText: "Run security scans",
          },
        ],
      },
    })
  })

  it("shows Other and submits its free-text Answer", async () => {
    let otherRow: string[] = []
    let textEntry: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-other",
      singleQuestionAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\x1b[B")
        otherRow = component.render(80)
        component.handleInput?.("\r")
        component.handleInput?.("Use Deno")
        textEntry = component.render(80)
        component.handleInput?.("\r")
      }),
    )

    const renderedOtherRow = otherRow.join("\n")
    expect(renderedOtherRow).toContain("› Other")
    expect(renderedOtherRow.indexOf("Other")).toBeGreaterThan(
      renderedOtherRow.indexOf("Node"),
    )
    expect(textEntry.join("\n")).toContain("Use Deno")
    expect(result).toEqual({
      content: [
        { type: "text", text: 'Runtime: "Use Deno" (other)' },
      ],
      details: {
        answers: [
          {
            header: "Runtime",
            question: "Which runtime should this package use?",
            selectedLabels: [],
            otherText: "Use Deno",
          },
        ],
      },
    })
  })

  it("keeps Other input visible after reading in a one-row viewport", async () => {
    let textEntry: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-other-one-row",
      singleQuestionAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\x1b[B")
        component.render(18)
        component.handleInput?.("\x1b[5~")
        component.handleInput?.("\r")
        component.handleInput?.("Use Deno")
        textEntry = component.render(18)
        component.handleInput?.("\r")
      }, 3),
    )

    expect(textEntry).toHaveLength(1)
    expect(textEntry.join("\n")).toContain("Deno")
    expect(result.content).toEqual([
      { type: "text", text: 'Runtime: "Use Deno" (other)' },
    ])
  })

  it("starts each Other entry with fresh editor history", async () => {
    let reopenedEntry: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-other-fresh-history",
      singleQuestionAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\r")
        component.handleInput?.("Discarded")
        component.handleInput?.("\x15")
        component.handleInput?.("\x1b")
        component.handleInput?.("\r")
        component.handleInput?.("\x19")
        reopenedEntry = component.render(80)
        component.handleInput?.("Fresh")
        component.handleInput?.("\r")
      }),
    )

    expect(reopenedEntry.join("\n")).not.toContain("Discarded")
    expect(result.content).toEqual([
      { type: "text", text: 'Runtime: "Fresh" (other)' },
    ])
  })

  it("keeps text entry open after an empty Other submission", async () => {
    let renderedAfterEmpty: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-empty-other",
      singleQuestionAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\r")
        component.handleInput?.("\r")
        renderedAfterEmpty = component.render(80)
        component.handleInput?.("Deno")
        component.handleInput?.("\r")
      }),
    )

    expect(renderedAfterEmpty.join("\n")).toContain(
      "Enter a free-text Answer.",
    )
    expect(result.content).toEqual([
      { type: "text", text: 'Runtime: "Deno" (other)' },
    ])
  })

  it("returns from Other text entry without canceling the Ask", async () => {
    let renderedAfterEscape: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-other-escape",
      singleQuestionAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\x1b[B")
        component.handleInput?.("\r")
        component.handleInput?.("Deno")
        component.handleInput?.("\x1b")
        renderedAfterEscape = component.render(80)
        component.handleInput?.("\x1b[A")
        component.handleInput?.("\r")
      }),
    )

    const returnedList = renderedAfterEscape.join("\n")
    expect(returnedList).toContain("› Other")
    expect(returnedList).not.toContain("Deno")
    expect(result.content).toEqual([{ type: "text", text: "Runtime: Node" }])
  })

  it("renders and honors configured selection keybindings", async () => {
    let renderedLines: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-keybindings",
      singleQuestionAsk,
      undefined,
      undefined,
      interactiveContext(
        (component) => {
          renderedLines = component.render(100)
          component.handleInput?.("j")
          component.handleInput?.("y")
        },
        24,
        [2],
        {
          "tui.select.up": "k",
          "tui.select.down": "j",
          "tui.select.pageUp": "u",
          "tui.select.pageDown": "d",
          "tui.select.confirm": "y",
          "tui.select.cancel": "x",
        },
      ),
    )

    expect(renderedLines.join("\n")).toContain(
      "move k / j • read u / d • select y • cancel x",
    )
    expect(result.content).toEqual([{ type: "text", text: "Runtime: Node" }])
  })

  it("scrolls every configured control hint in a tight viewport", async () => {
    const renders: string[][] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-scrolling-help",
      singleQuestionAsk,
      undefined,
      undefined,
      interactiveContext(
        (component) => {
          for (let step = 0; step < 60; step += 1) {
            renders.push(component.render(18))
            const helpRows = renders
              .map((lines) => lines.at(-1))
              .join("")
              .replaceAll(" ", "")
            if (helpRows.includes("cancelescape,ctrl+c")) {
              break
            }
            component.handleInput?.("d")
          }
          component.handleInput?.("\r")
        },
        4,
        [2],
        {
          "tui.select.up": ["k", "ctrl+k"],
          "tui.select.down": ["j", "ctrl+j"],
          "tui.select.pageUp": ["u", "ctrl+u"],
          "tui.select.pageDown": ["d", "ctrl+d"],
          "tui.select.confirm": ["enter", "ctrl+y"],
          "tui.select.cancel": ["escape", "ctrl+c"],
        },
      ),
    )

    const helpRows = renders
      .map((lines) => lines.at(-1))
      .join("")
      .replaceAll(" ", "")
    expect(renders.every((lines) => lines.length <= 2)).toBe(true)
    expect(helpRows).toContain("movek,ctrl+k/j,ctrl+j")
    expect(helpRows).toContain("readu,ctrl+u/d,ctrl+d")
    expect(helpRows).toContain("selectenter,ctrl+y")
    expect(helpRows).toContain("cancelescape,ctrl+c")
    expect(result.content).toEqual([{ type: "text", text: "Runtime: Bun" }])
  })

  it("moves the highlight instead of scrolling with arrow keys", async () => {
    const ask: Ask = {
      questions: [
        {
          header: "Runtime",
          question: "Choose the runtime.",
          multiSelect: false,
          options: [
            {
              label: "Alpha",
              description:
                "A long description that needs several wrapped lines in this short viewport.",
            },
            { label: "Beta", description: "The second Option." },
          ],
        },
      ],
    }
    let renderedAfterMove: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-arrow-move",
      ask,
      undefined,
      undefined,
      interactiveContext((component) => {
        component.render(18)
        component.handleInput?.("\x1b[B")
        renderedAfterMove = component.render(18)
        component.handleInput?.("\r")
      }, 10),
    )

    expect(renderedAfterMove.join("\n")).toContain("› Beta")
    expect(result.content).toEqual([{ type: "text", text: "Runtime: Beta" }])
  })

  it("keeps every highlighted Option visible in a short viewport", async () => {
    const options = ["Alpha", "Beta", "Gamma", "Delta"].map((label) => ({
      label,
      description: `${label} details explain this Option across several wrapped terminal lines.`,
    }))
    const ask: Ask = {
      questions: [
        {
          header: "Runtime",
          question: "Choose the runtime.",
          multiSelect: false,
          options,
        },
      ],
    }
    const renders: string[][] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-viewport",
      ask,
      undefined,
      undefined,
      interactiveContext((component) => {
        options.forEach((_option, index) => {
          renders.push(component.render(24))
          if (index < options.length - 1) {
            component.handleInput?.("\x1b[B")
          }
        })
        component.handleInput?.("\r")
      }, 14),
    )

    expect(result.content).toEqual([
      { type: "text", text: "Runtime: Delta" },
    ])
    renders.forEach((lines, index) => {
      const rendered = lines.join("\n")
      expect(lines.length).toBeLessThanOrEqual(12)
      expect(rendered).toContain("Runtime")
      expect(rendered).toContain("Choose the runtime.")
      expect(rendered).toContain(`› ${options[index]?.label}`)
      expect(rendered).toContain(`${options[index]?.label} details`)
    })
  })

  it("reads every line of an Option taller than the viewport", async () => {
    const longLabel =
      "A deliberately long Option label that wraps across several terminal lines"
    const ask: Ask = {
      questions: [
        {
          header: "Runtime",
          question: "Choose the runtime.",
          multiSelect: false,
          options: [
            {
              label: longLabel,
              description:
                "Read every part of this detailed description before selecting it. DESCRIPTION_END",
            },
            { label: "Short", description: "A short alternative." },
          ],
        },
      ],
    }
    const renders: string[][] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-tall-option",
      ask,
      undefined,
      undefined,
      interactiveContext((component) => {
        for (let step = 0; step < 10; step += 1) {
          const lines = component.render(20)
          renders.push(lines)
          if (lines.join("\n").includes("DESCRIPTION_END")) {
            break
          }
          component.handleInput?.("\x1b[6~")
        }
        component.handleInput?.("\r")
      }, 10),
    )

    expect(renders[0]?.join("\n")).not.toContain("DESCRIPTION_END")
    expect(renders.at(-1)?.join("\n")).toContain("DESCRIPTION_END")
    expect(renders.every((lines) => lines.join("\n").includes("› "))).toBe(true)
    expect(result.content).toEqual([
      { type: "text", text: `Runtime: ${longLabel}` },
    ])
  })

  it("reads every wrapped Header and Question line", async () => {
    const headerWords = ["AA", "BB", "CC", "DD"]
    const questionWords = [
      "Q01",
      "Q02",
      "Q03",
      "Q04",
      "Q05",
      "Q06",
      "Q07",
      "Q08",
      "QUESTION_END",
    ]
    const ask: Ask = {
      questions: [
        {
          header: headerWords.join(" "),
          question: questionWords.join(" "),
          multiSelect: false,
          options: [
            { label: "Alpha", description: "First Option." },
            { label: "Beta", description: "Second Option." },
          ],
        },
      ],
    }
    const renders: string[][] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-context-scroll",
      ask,
      undefined,
      undefined,
      interactiveContext((component) => {
        for (let step = 0; step < 20; step += 1) {
          const lines = component.render(10)
          renders.push(lines)
          if (lines.join("").replaceAll(" ", "").includes("QUESTION_END")) {
            break
          }
          component.handleInput?.("\x1b[6~")
        }
        component.handleInput?.("\r")
      }, 10),
    )

    const rendered = renders.flat().join("").replaceAll(" ", "")
    expect(renders.at(-1)?.join("").replaceAll(" ", "")).toContain(
      "QUESTION_END",
    )
    for (const word of [...headerWords, ...questionWords]) {
      expect(rendered).toContain(word)
    }
    expect(renders.every((lines) => lines.length <= 8)).toBe(true)
    expect(result.content).toEqual([{ type: "text", text: "AA BB CC DD: Alpha" }])
  })

  it("visits context and Option lines in a one-row viewport", async () => {
    const ask: Ask = {
      questions: [
        {
          header: "Context",
          question: "QUESTION_START middle QUESTION_END",
          multiSelect: false,
          options: [
            {
              label: "Alpha",
              description: "ALPHA_START middle ALPHA_END",
            },
            {
              label: "Beta",
              description: "BETA_START middle BETA_END",
            },
          ],
        },
      ],
    }
    const renders: string[][] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-one-row",
      ask,
      undefined,
      undefined,
      interactiveContext((component) => {
        for (let step = 0; step < 20; step += 1) {
          renders.push(component.render(12))
          component.handleInput?.("\x1b[6~")
        }
        component.handleInput?.("\x1b[B")
        for (let step = 0; step < 20; step += 1) {
          renders.push(component.render(12))
          component.handleInput?.("\x1b[6~")
        }
        component.handleInput?.("\r")
      }, 3),
    )

    const rendered = renders.flat().join("").replaceAll(" ", "")
    expect(renders.every((lines) => lines.length === 1)).toBe(true)
    expect(rendered).toContain("Context")
    expect(rendered).toContain("QUESTION_START")
    expect(rendered).toContain("QUESTION_END")
    expect(rendered).toContain("ALPHA_START")
    expect(rendered).toContain("ALPHA_END")
    expect(rendered).toContain("BETA_START")
    expect(rendered).toContain("BETA_END")
    expect(result.content).toEqual([{ type: "text", text: "Context: Beta" }])
  })

  it("derives viewport height from components below the Ask", async () => {
    let renderedLines: string[] = []
    const tool = captureTool()

    await tool.execute(
      "ask-production-layout-boundary",
      singleQuestionAsk,
      undefined,
      undefined,
      interactiveContext((component) => {
        renderedLines = component.render(40)
        component.handleInput?.("\r")
      }, 14, [3, 4]),
    )

    expect(renderedLines.length).toBeLessThanOrEqual(7)
    expect(renderedLines.join("\n")).toContain("Runtime")
    expect(renderedLines.join("\n")).toContain(
      "Which runtime should this package use?",
    )
    expect(renderedLines.join("\n")).toContain("› Bun")
  })

  it("sanitizes model-provided terminal control sequences", async () => {
    const ask: Ask = {
      questions: [
        {
          header: "Run\x1b]52;c;\x07",
          question: "Choose\x1b[31m safely",
          multiSelect: false,
          options: [
            {
              label: "Bun\x1b[2J",
              description: "Fast\x1b]0;owned\x07 runtime",
            },
            { label: "Node", description: "Node runtime." },
          ],
        },
      ],
    }
    let renderedLines: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-sanitized",
      ask,
      undefined,
      undefined,
      interactiveContext((component) => {
        renderedLines = component.render(80)
        component.handleInput?.("\r")
      }),
    )

    expect(
      renderedLines.every(
        (line) => !containsTerminalControl(line),
      ),
    ).toBe(true)
    const rendered = renderedLines.join("\n")
    expect(rendered).toContain("Run")
    expect(rendered).toContain("Choose safely")
    expect(rendered).toContain("Bun")
    expect(rendered).toContain("Fast runtime")
    expect(rendered).not.toContain("52;c")
    expect(rendered).not.toContain("[31m")
    expect(rendered).not.toContain("[2J")
    expect(rendered).not.toContain("owned")
    expect(result.content).toEqual([{ type: "text", text: "Run: Bun" }])
    expect(result.details).toEqual({
      answers: [
        {
          header: "Run\x1b]52;c;\x07",
          question: "Choose\x1b[31m safely",
          selectedLabels: ["Bun\x1b[2J"],
        },
      ],
    })
  })

  it("sanitizes bidi and zero-width characters without altering legitimate Unicode text", async () => {
    const invisibleControls = [
      "\u202a",
      "\u202b",
      "\u202c",
      "\u202d",
      "\u202e",
      "\u2066",
      "\u2067",
      "\u2068",
      "\u2069",
      "\u200e",
      "\u200f",
      "\u200b",
      "\u200c",
      "\u200d",
      "\u2060",
      "\ufeff",
    ].join("")
    const ask: Ask = {
      questions: [
        {
          header: "安全",
          question: `中文${invisibleControls} 😺 Cafe\u0301`,
          multiSelect: false,
          options: [
            {
              label: `選択${invisibleControls} ✅ Cafe\u0301`,
              description: `説明${invisibleControls} 🚀 Cafe\u0301`,
            },
            { label: "Other choice", description: "Another choice." },
          ],
        },
      ],
    }
    let renderedLines: string[] = []
    const tool = captureTool()

    const result = await tool.execute(
      "ask-production-invisible-controls",
      ask,
      undefined,
      undefined,
      interactiveContext((component) => {
        renderedLines = component.render(80)
        component.handleInput?.("\r")
      }),
    )

    const rendered = renderedLines.join("\n")
    expect(rendered).not.toMatch(/[\u202a-\u202e\u2066-\u2069\u200e\u200f\u200b-\u200d\u2060\ufeff]/u)
    expect(rendered).toContain("中文 😺 Cafe\u0301")
    expect(rendered).toContain("選択 ✅ Cafe\u0301")
    expect(rendered).toContain("説明 🚀 Cafe\u0301")
    expect(result.content).toEqual([
      { type: "text", text: "安全: 選択 ✅ Cafe\u0301" },
    ])
    expect(result.details).toEqual({
      answers: [
        {
          header: "安全",
          question: `中文${invisibleControls} 😺 Cafe\u0301`,
          selectedLabels: [`選択${invisibleControls} ✅ Cafe\u0301`],
        },
      ],
    })
  })

  it("throws a declined error when Escape cancels the production AskUI Layer", async () => {
    const tool = captureTool()

    await expect(
      tool.execute(
        "ask-production-cancel",
        singleQuestionAsk,
        undefined,
        undefined,
        interactiveContext((component) => {
          component.handleInput?.("\x1b")
        }),
      ),
    ).rejects.toThrow(/user declined.*do not repeat ask_user_question/i)
  })

  it("maps the execute AbortSignal to Effect interruption", async () => {
    let markStarted = () => {}
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let interruptionFinalizerRan = false
    const tool = captureTool(
      stubAskUILayer({
        ask: () =>
          Effect.sync(markStarted).pipe(
            Effect.zipRight(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                interruptionFinalizerRan = true
              }),
            ),
          ),
      }),
    )
    const controller = new AbortController()
    const execution = tool.execute(
      "ask-abort",
      singleQuestionAsk,
      controller.signal,
      undefined,
      context("tui"),
    )
    const outcome = execution.then(
      () => undefined,
      (error: unknown) => error,
    )

    await started
    controller.abort()

    expect(await outcome).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(
          /user declined.*do not repeat ask_user_question/i,
        ),
      }),
    )
    expect(interruptionFinalizerRan).toBe(true)
  })

  it("dismisses an open Ask on abort and accepts another Ask", async () => {
    let markShown = () => {}
    const shown = new Promise<void>((resolve) => {
      markShown = resolve
    })
    let presentationCount = 0
    let closeCount = 0
    const ctx = interactiveContext(
      (component) => {
        presentationCount += 1
        if (presentationCount === 1) {
          markShown()
        } else {
          component.handleInput?.("\r")
        }
      },
      24,
      [2],
      {},
      () => {
        closeCount += 1
      },
    )
    const tool = captureTool()
    const controller = new AbortController()
    const aborted = tool.execute(
      "ask-production-abort",
      singleQuestionAsk,
      controller.signal,
      undefined,
      ctx,
    )

    await shown
    controller.abort()

    await expect(aborted).rejects.toThrow(
      /user declined.*do not repeat ask_user_question/i,
    )
    expect(closeCount).toBe(1)

    const next = await tool.execute(
      "ask-production-after-abort",
      singleQuestionAsk,
      undefined,
      undefined,
      ctx,
    )

    expect(next.content).toEqual([{ type: "text", text: "Runtime: Bun" }])
    expect(closeCount).toBe(2)
  })

  it("serializes concurrent Asks and returns each Answer", async () => {
    const secondAsk: Ask = {
      questions: [
        {
          header: "Package",
          question: "Which package shape should this project use?",
          multiSelect: false,
          options: [
            { label: "Library", description: "Export a reusable package." },
            { label: "App", description: "Run a standalone application." },
          ],
        },
      ],
    }
    const starts: string[] = []
    const answerResolvers = new Map<
      string,
      (answers: readonly Answer[]) => void
    >()
    const ask = vi.fn((currentAsk: Ask) =>
      Effect.promise(
        () =>
          new Promise<readonly Answer[]>((resolve) => {
            const header = currentAsk.questions[0]?.header
            if (!header) {
              throw new Error("The test Ask needs one Question")
            }
            starts.push(header)
            answerResolvers.set(header, resolve)
          }),
      ),
    )
    const tool = captureTool(stubAskUILayer({ ask }))

    const first = tool.execute(
      "ask-batch-1",
      singleQuestionAsk,
      undefined,
      undefined,
      context("tui"),
    )
    await Promise.resolve()
    expect(starts).toEqual(["Runtime"])

    const second = tool.execute(
      "ask-batch-2",
      secondAsk,
      undefined,
      undefined,
      context("tui"),
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(starts).toEqual(["Runtime"])

    answerResolvers.get("Runtime")?.([{ selectedLabels: ["Node"] }])
    await expect(first).resolves.toMatchObject({
      content: [{ type: "text", text: "Runtime: Node" }],
    })
    await Promise.resolve()
    expect(starts).toEqual(["Runtime", "Package"])

    answerResolvers.get("Package")?.([{ selectedLabels: ["Library"] }])
    await expect(second).resolves.toMatchObject({
      content: [{ type: "text", text: "Package: Library" }],
    })
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it.each(["rpc", "json", "print"] as const)(
    "throws without calling AskUI in %s mode",
    async (mode) => {
      const ask = vi.fn((_ask: Ask) =>
        Effect.succeed<readonly Answer[]>([{ selectedLabels: ["Bun"] }]),
      )
      const tool = captureTool(stubAskUILayer({ ask }))

      await expect(
        tool.execute(
          "ask-3",
          singleQuestionAsk,
          undefined,
          undefined,
          context(mode),
        ),
      ).rejects.toThrow(/no interactive user is available/i)
      expect(ask).not.toHaveBeenCalled()
    },
  )
})
