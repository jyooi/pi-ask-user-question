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
): ExtensionContext {
  const tui = {
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
