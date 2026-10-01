import { CascadeSession } from "@vexis/core/cascade/session"
import { AbsolutePath } from "@vexis/core/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const CascadeHandler = HttpApiBuilder.group(Api, "server.cascade", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle("cascade.run", Effect.fn(function* (ctx) {
      const result = yield* CascadeSession.run({
        location: {
          directory: ctx.payload.location.directory,
          workspaceID: ctx.payload.location.workspaceID,
        },
        plan: {
          tasks: ctx.payload.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            prompt: task.prompt,
            agent: task.agent,
            dependsOn: task.dependsOn,
            run: () => Effect.succeed([]),
          })),
        },
        agent: undefined,
      })
      return {
        data: {
          sessions: Object.fromEntries(
            [...result.artifacts.entries()]
              .filter(([key]) => key.startsWith("cascade:"))
              .map(([key, value]) => [key.slice("cascade:".length), (value as { sessionID: string }).sessionID]),
          ),
          artifacts: Object.fromEntries(result.artifacts),
        },
      }
    }))
  }),
)
