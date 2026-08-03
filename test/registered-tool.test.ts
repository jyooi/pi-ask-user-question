import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import {
  Key,
  matchesKey,
  type Component,
  type KeybindingsManager,
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

function interactiveContext(
  drive: (component: Component) => void,
  terminalRows = 24,
  rowsAfterComponent: readonly number[] = [2],
): ExtensionContext {
  const tui = {
    children: [] as Component[],
    requestRender: vi.fn(),
    terminal: { rows: terminalRows },
  } as unknown as TUI
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme
  const keybindings = {
    matches(data: string, binding: string) {
      const keys = {
        "tui.select.up": [Key.up],
        "tui.select.down": [Key.down],
        "tui.select.confirm": [Key.enter],
        "tui.select.cancel": [Key.escape],
      }[binding]
      return keys?.some((key) => matchesKey(data, key)) ?? false
    },
  } as KeybindingsManager
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
        void Promise.resolve(factory(tui, theme, keybindings, resolve)).then(
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

  it("scrolls through every line of an Option taller than the viewport", async () => {
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
          component.handleInput?.("\x1b[B")
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

    await tool.execute(
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
        (line) => !/[\u0000-\u001f\u007f-\u009f]/u.test(line),
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

    expect(await outcome).toBeInstanceOf(Error)
    expect(interruptionFinalizerRan).toBe(true)
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
