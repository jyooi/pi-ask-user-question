import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Effect } from "effect"

import {
  AskUI,
  NoInteractiveUI,
  UserCancelled,
  type Answer,
  type AskUILayer,
} from "./ask-ui.js"
import { createLiveAskUILayer } from "./live-ask-ui.js"
import {
  AskParameters,
  type Ask,
  type AskResultDetails,
} from "./schema.js"
import { sanitizeTerminalText } from "./terminal-text.js"
import {
  renderAskCall,
  renderAskResult,
} from "./transcript-rendering.js"

function askProgram(ask: Ask, mode: ExtensionContext["mode"]) {
  if (mode !== "tui") {
    return Effect.fail(new NoInteractiveUI())
  }

  return Effect.flatMap(AskUI, (askUI) => askUI.ask(ask))
}

function declinedAskError(): Error {
  return new Error(
    "The user declined this Ask. Do not repeat ask_user_question immediately. Continue using your own judgment.",
  )
}

function formatAnswer(answer: Answer): string {
  const parts = answer.selectedLabels.map(sanitizeTerminalText)
  if (answer.otherText !== undefined) {
    parts.push(
      `${JSON.stringify(sanitizeTerminalText(answer.otherText))} (other)`,
    )
  }

  if (parts.length === 0) {
    throw new Error("AskUI returned an empty Answer")
  }

  return parts.join(", ")
}

function formatResult(ask: Ask, answers: readonly Answer[]) {
  if (answers.length !== ask.questions.length) {
    throw new Error("AskUI returned the wrong number of Answers")
  }

  const details: AskResultDetails = {
    answers: ask.questions.map((question, index) => {
      const answer = answers[index]
      if (!answer) {
        throw new Error("AskUI omitted an Answer")
      }

      return {
        header: question.header,
        question: question.question,
        selectedLabels: [...answer.selectedLabels],
        ...(answer.otherText === undefined
          ? {}
          : { otherText: answer.otherText }),
      }
    }),
  }

  const text = details.answers
    .map((answer, index) => {
      const source = answers[index]
      if (!source) {
        throw new Error("AskUI omitted an Answer")
      }
      return `${sanitizeTerminalText(answer.header)}: ${formatAnswer(source)}`
    })
    .join("\n")

  return {
    content: [{ type: "text" as const, text }],
    details,
  }
}

async function executeAsk(
  ask: Ask,
  mode: ExtensionContext["mode"],
  signal: AbortSignal | undefined,
  layer: AskUILayer,
  semaphore: Effect.Semaphore,
) {
  const effect = askProgram(ask, mode).pipe(
    semaphore.withPermits(1),
    Effect.catchTags({
      NoInteractiveUI: () =>
        Effect.fail(
          new Error(
            "No interactive user is available for ask_user_question. Continue using your own judgment.",
          ),
        ),
      UserCancelled: () => Effect.fail(declinedAskError()),
    }),
    Effect.provide(layer),
  )

  try {
    const answers = signal
      ? await Effect.runPromise(effect, { signal })
      : await Effect.runPromise(effect)
    return formatResult(ask, answers)
  } catch (error) {
    if (signal?.aborted) {
      throw declinedAskError()
    }
    throw error
  }
}

export default function createAskUserQuestionExtension(
  pi: ExtensionAPI,
  askUILayer?: AskUILayer,
) {
  const askSemaphore = Effect.unsafeMakeSemaphore(1)

  pi.registerTool<typeof AskParameters, AskResultDetails>({
    name: "ask_user_question",
    label: "Ask User Question",
    description:
      "Ask the user one to four structured Questions with Options and an automatic Other choice.",
    promptSnippet:
      "ask_user_question asks the user structured Questions with selectable Options.",
    promptGuidelines: [
      "Use ask_user_question when the user must choose among clear Options.",
      "Do not use ask_user_question when no interactive user is available.",
    ],
    parameters: AskParameters,
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) =>
      executeAsk(
        params,
        ctx.mode,
        signal,
        askUILayer ?? createLiveAskUILayer(ctx.ui),
        askSemaphore,
      ),
    renderCall: (args, theme, context) =>
      renderAskCall(args, theme, context.lastComponent),
    renderResult: (result, options, theme, context) =>
      renderAskResult(
        result,
        options.isPartial,
        context.isError,
        theme,
        context.lastComponent,
      ),
  })
}

export { AskUI, NoInteractiveUI, UserCancelled } from "./ask-ui.js"
export type { Answer, AskUILayer, AskUIService } from "./ask-ui.js"
export { AskParameters } from "./schema.js"
export type {
  AnswerDetails,
  Ask,
  AskResultDetails,
} from "./schema.js"
