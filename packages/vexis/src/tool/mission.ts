import { CascadeSession } from "@vexis/core/cascade"
import { plan } from "@vexis/core/cascade/planner"
import { Location } from "@vexis/core/location"
import { ProjectMemory } from "@vexis/core/project/memory"
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
    const memory = yield* ProjectMemory.Service

    return {
      description:
        "Turn one complex request into an automatic Vexis agent team. The planner selects specialist roles, builds dependencies, isolates mutating work in Git worktrees when safe, passes structured artifacts between tasks, and synthesizes the results.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const mission = plan({
            request: params.request,
            includeSynthesis: params.synthesis !== false,
          })
          const result = yield* CascadeSession.run({
            location: Location.Ref.make({ directory: instance.directory, workspaceID: instance.workspaceID }),
            parentSessionID: ctx.sessionID,
            plan: mission,
            concurrency: params.concurrency,
          })

          const summary = [...result.results.values()].map((item) => {
            const artifact = item.artifacts[0]?.value as { output?: string } | undefined
            return `[${item.id}] ${item.state}: ${artifact?.output ?? item.error ?? ""}`
          }).join("\n")

          // Memory is durable context, but it is never allowed to turn a
          // completed mission into a failed tool call.
          yield* memory.append({
            directory: instance.directory,
            entry: {
              topic: `Mission: ${params.request.slice(0, 80)}`,
              content: [
                `Request: ${params.request}`,
                "",
                "Outcome:",
                summary,
              ].join("\n"),
              source: "vexis-mission",
            },
          }).pipe(Effect.catchAllCause(() => Effect.void))

          const graph = mission.tasks.map((task) => {
            const dependencies = task.dependsOn?.length ? task.dependsOn.join(", ") : "none"
            return [
              `- ${task.id}: ${task.title ?? task.id}`,
              `role=${task.role ?? "unspecified"}`,
              `agent=${task.agent ?? "default"}`,
              `mutates=${task.mutatesWorkspace ? "yes" : "no"}`,
              `depends on: ${dependencies}`,
            ].join(" | ")
          }).join("\n")

          const results = [...result.results.values()].map((item) => {
            const artifact = item.artifacts[0]?.value as {
              sessionID?: string; output?: string; role?: string; isolated?: boolean; workspace?: string; changeSet?: string
            } | undefined
            return [
              `<task id="${item.id}" state="${item.state}"${artifact?.sessionID ? ` session_id="${artifact.sessionID}"` : ""} role="${artifact?.role ?? "unknown"}" isolated="${artifact?.isolated ? "true" : "false"}">`,
              artifact?.workspace ? `<workspace>${artifact.workspace}</workspace>` : "",
              artifact?.changeSet ? "<artifact kind=\"change\" available=\"true\" />" : "",
              artifact?.output ?? (item.error ? String(item.error) : ""),
              "</task>",
            ].join("\n")
          }).join("\n")

          return {
            title: `Mission: ${params.request.slice(0, 72)}`,
            metadata: {
              taskCount: mission.tasks.length,
              concurrency: params.concurrency ?? 4,
              artifactFirst: true,
              gitAware: true,
              graph: mission.tasks.map((task) => ({
                id: task.id,
                title: task.title,
                role: task.role,
                agent: task.agent,
                capability: task.capability,
                mutatesWorkspace: task.mutatesWorkspace ?? false,
                dependsOn: task.dependsOn ?? [],
              })),
              artifacts: [...result.results.values()].flatMap((task) =>
                task.artifacts.map((artifact) => ({
                  key: artifact.key,
                  kind: artifact.kind,
                  taskID: artifact.taskID,
                  label: artifact.label,
                })),
              ),
            },
            output: ["<mission>", "<plan>", graph, "</plan>", "<results>", results, "</results>", "</mission>"].join("\n"),
          }
        }),
    }
  }),
)
