import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent"
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

  it("throws a missing UI error from the scaffold AskUI Layer", async () => {
    const tool = captureTool()

    await expect(
      tool.execute(
        "ask-missing-ui",
        singleQuestionAsk,
        undefined,
        undefined,
        context("tui"),
      ),
    ).rejects.toThrow(/no interactive user is available/i)
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
    const rejection = expect(execution).rejects.toThrow()

    await started
    controller.abort()

    await rejection
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
