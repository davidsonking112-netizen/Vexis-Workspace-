import { CascadeSession } from "@vexis/core/cascade/session"
import { SessionV2 } from "@vexis/core/session"
import { AbsolutePath } from "@vexis/core/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

const response = (result: Awaited<ReturnType<typeof runCascade>>) => ({
  data: {
    sessions: Object.fromEntries(
      [...result.artifacts.entries()]
        .filter(([key]) => key.startsWith("cascade:"))
        .map(([key, value]) => [key.slice("cascade:".length), (value as { sessionID: string }).sessionID]),
    ),
    artifacts: Object.fromEntries(result.artifacts),
  },
})

const runCascade = (input: Parameters<typeof CascadeSession.run>[0]) => CascadeSession.run(input)

export const CascadeHandler = HttpApiBuilder.group(Api, "server.cascade", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service

    return handlers
      .handle(
        "cascade.run",
        Effect.fn(function* (ctx) {
          const result = yield* runCascade({
            location: {
              directory: ctx.payload.location.directory,
              workspaceID: ctx.payload.location.workspaceID,
            },
            parentSessionID: ctx.payload.parentSessionID,
            concurrency: ctx.payload.concurrency,
            plan: {
              tasks: ctx.payload.tasks.map((task) => ({
                id: task.id,
                title: task.title,
                prompt: task.prompt,
                agent: task.agent,
                role: task.role,
                capability: task.capability,
                mutatesWorkspace: task.mutatesWorkspace,
                retries: task.retries,
                dependsOn: task.dependsOn,
                run: () => Effect.succeed([]),
              })),
            },
            agent: undefined,
          })
          return response(result)
        }),
      )
      .handle(
        "cascade.resume",
        Effect.fn(function* (ctx) {
          const session = yield* sessions.get(ctx.params.sessionID)
          const result = yield* runCascade({
            location: {
              directory: AbsolutePath.make(session.directory),
              workspaceID: session.workspaceID,
            },
            parentSessionID: ctx.params.sessionID,
            resumeSessionID: ctx.params.sessionID,
            plan: { tasks: [] },
            agent: undefined,
          })
          return response(result)
        }),
      )
      .handle(
        "cascade.cancel",
        Effect.fn(function* (ctx) {
          return { data: { cancelled: yield* CascadeSession.cancel(ctx.params.sessionID) } }
        }),
      )
  }),
)
