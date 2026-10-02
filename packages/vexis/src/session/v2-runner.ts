import { SessionRunner } from "@vexis/core/session/runner"
import { SessionStore } from "@vexis/core/session/store"
import { LayerNode } from "@vexis/core/effect/layer-node"
import { Effect } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { LoopInput, Service as SessionPrompt } from "./prompt"

const layer = Effect.gen(function* () {
  const store = yield* SessionStore.Service
  const instances = yield* InstanceStore.Service
  const projects = yield* Project.Service
  const prompt = yield* SessionPrompt.Service

  const run = Effect.fn("V2SessionRunner.run")(function* (input: Parameters<SessionRunner.Interface["run"]>[0]) {
    const session = yield* store.get(input.sessionID)
    if (!session) return yield* Effect.die(new Error(`Session not found: ${input.sessionID}`))

    const current = yield* InstanceRef
    if (current?.directory === session.directory) {
      return yield* prompt.loop(new LoopInput({ sessionID: input.sessionID })).pipe(Effect.asVoid)
    }

    const project = yield* projects
      .get(session.projectID)
      .pipe(
        Effect.flatMap((value) =>
          value
            ? Effect.succeed(value)
            : Effect.die(new Error(`Project not found: ${session.projectID}`)),
        ),
      )
    const instance = yield* instances.load({
      directory: session.directory,
      worktree: session.directory,
      project,
    })

    return yield* prompt
      .loop(new LoopInput({ sessionID: input.sessionID }))
      .pipe(
        Effect.provideService(InstanceRef, instance),
        Effect.ensuring(instances.dispose(instance).pipe(Effect.ignore)),
        Effect.asVoid,
      )
  })

  return SessionRunner.Service.of({ run })
})

export const node = LayerNode.make({
  service: SessionRunner.Service,
  layer,
  deps: [SessionStore.node, InstanceStore.node, Project.node, SessionPrompt.node],
})

export * as V2SessionRunner from "./v2-runner"
