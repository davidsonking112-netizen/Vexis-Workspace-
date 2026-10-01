import { CascadeSession } from "@vexis/core/cascade"
import { Location } from "@vexis/core/location"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"

const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  prompt: Schema.String,
  agent: Schema.optional(Schema.String),
  depends_on: Schema.optional(Schema.Array(Schema.String)),
})

export const Parameters = Schema.Struct({
  tasks: Schema.Array(Task).pipe(Schema.minItems(1)),
  concurrency: Schema.optional(Schema.Number),
  synthesis_prompt: Schema.optional(Schema.String),
  synthesis_agent: Schema.optional(Schema.String),
})

export const CascadeTool = Tool.define(
  "cascade",
  Effect.gen(function* () {
    const instance = yield* InstanceState.context

    return {
      description:
        "Plan and execute a coordinated team of Vexis subagents. Independent tasks run concurrently; dependent tasks receive upstream artifacts. Use synthesis_prompt for a final agent that integrates all completed work.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const tasks = params.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            prompt: task.prompt,
            agent: task.agent,
            dependsOn: task.depends_on,
          }))

          if (params.synthesis_prompt) {
            tasks.push({
              id: "__cascade_synthesis__",
              title: "Synthesize Cascade results",
              prompt: params.synthesis_prompt,
              agent: params.synthesis_agent,
              dependsOn: tasks.map((task) => task.id),
            })
          }

          const result = yield* CascadeSession.run({
            location: Location.Ref.make({
              directory: instance.directory,
              workspaceID: instance.workspaceID,
            }),
            parentSessionID: ctx.sessionID,
            plan: {
              tasks,
            },
            concurrency: params.concurrency,
          })

          const summary = [...result.results.values()]
            .map((item) => {
              const artifact = item.artifacts[0]?.value as { sessionID?: string; output?: string } | undefined
              return [
                `<task id="${item.id}" state="${item.state}"${artifact?.sessionID ? ` session_id="${artifact.sessionID}"` : ""}>`,
                artifact?.output ?? (item.error ? String(item.error) : ""),
                "</task>",
              ].join("\n")
            })
            .join("\n")

          return {
            title: `Cascade: ${params.tasks.length} task${params.tasks.length === 1 ? "" : "s"}`,
            metadata: {
              taskCount: params.tasks.length,
              synthesis: Boolean(params.synthesis_prompt),
            },
            output: summary,
          }
        }),
    }
  }),
)
