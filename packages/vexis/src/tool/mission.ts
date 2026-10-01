import { CascadeSession } from "@vexis/core/cascade"
import { plan } from "@vexis/core/cascade/planner"
import { Location } from "@vexis/core/location"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  request: Schema.String,
  concurrency: Schema.optional(Schema.Number),
  synthesis: Schema.optional(Schema.Boolean),
})

export const MissionTool = Tool.define(
  "mission",
  Effect.gen(function* () {
    const instance = yield* InstanceState.context

    return {
      description:
        "Turn one complex request into an automatic Vexis agent team. The planner selects specialist roles, builds dependencies, runs independent work concurrently, and synthesizes the results.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const mission = plan({
            request: params.request,
            includeSynthesis: params.synthesis !== false,
          })

          const result = yield* CascadeSession.run({
            location: Location.Ref.make({
              directory: instance.directory,
              workspaceID: instance.workspaceID,
            }),
            parentSessionID: ctx.sessionID,
            plan: mission,
            concurrency: params.concurrency,
          })

          const graph = mission.tasks
            .map((task) => {
              const dependencies = task.dependsOn?.length ? task.dependsOn.join(", ") : "none"
              return `- ${task.id}: ${task.title ?? task.id} [depends on: ${dependencies}]`
            })
            .join("\n")

          const results = [...result.results.values()]
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
            title: `Mission: ${params.request.slice(0, 72)}`,
            metadata: {
              taskCount: mission.tasks.length,
              concurrency: params.concurrency ?? 4,
              graph: mission.tasks.map((task) => ({
                id: task.id,
                title: task.title,
                agent: task.agent,
                capability: task.capability,
                dependsOn: task.dependsOn ?? [],
              })),
            },
            output: [
              "<mission>",
              "<plan>",
              graph,
              "</plan>",
              "<results>",
              results,
              "</results>",
              "</mission>",
            ].join("\n"),
          }
        }),
    }
  }),
)
