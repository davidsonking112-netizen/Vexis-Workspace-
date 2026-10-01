import { Effect } from "effect"
import { PromptInput } from "@vexis/schema/prompt-input"
import { Session } from "../session"
import { Location } from "../location"
import { Cascade, type Plan, type Task, type ProjectResult } from "../cascade"

/**
 * Connects Cascade's dependency graph to real Vexis sessions.
 *
 * Each task gets an independent child execution context and is admitted through
 * the normal Session.prompt path, so provider selection, permissions, durable
 * events, snapshots, and interruption continue to belong to the session layer.
 */
export type RunInput = {
  readonly location: Location.Ref
  readonly plan: Plan
  readonly agent?: string
  readonly parentSessionID?: string
}

const taskPrompt = (task: Task, context: ReadonlyMap<string, unknown>) => {
  const dependencyContext = [...context.entries()]
    .map(([key, value]) => `\nArtifact ${key}:\n${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("")

  return PromptInput.Prompt.make({
    text: [
      `You are a Vexis Cascade worker. Execute task: ${task.title ?? task.id}`,
      task.prompt ?? "",
      `Task ID: ${task.id}`,
      dependencyContext,
      "",
      "Complete the task directly in the workspace when appropriate. Return a concise result describing what you accomplished, important findings, and any files or decisions that downstream tasks should know about.",
    ].join("\n"),
  })
}

export const run = (input: RunInput): Effect.Effect<ProjectResult, unknown, Session.Service> =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const sessionIDs = new Map<string, string>()

    const plan: Plan = {
      ...input.plan,
      tasks: input.plan.tasks.map((task) => ({
        ...task,
        run: (context) =>
          Effect.gen(function* () {
            const created = yield* sessions.create({
              location: input.location,
              parentID: input.parentSessionID ? Session.ID.make(input.parentSessionID) : undefined,
              agent: task.agent ?? input.agent,
            })
            sessionIDs.set(task.id, created.id)

            yield* sessions.prompt({
              sessionID: created.id,
              prompt: taskPrompt(task, context.artifacts),
            })

            yield* sessions.wait(created.id)

            const messages = yield* sessions.messages({
              sessionID: created.id,
              limit: 20,
              order: "desc",
            })

            const output = messages
              .flatMap((message) => "parts" in message ? message.parts : [])
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")
              .trim()

            return [{
              key: `cascade:${task.id}`,
              value: {
                sessionID: created.id,
                taskID: task.id,
                output,
                status: "completed",
              },
              taskID: task.id,
            }]
          }),
      })),
    }

    return yield* Cascade.run(plan)
  })
