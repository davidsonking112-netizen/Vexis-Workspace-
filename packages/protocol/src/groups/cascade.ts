import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Schema } from "effect"
import { AbsolutePath } from "@vexis/schema/schema"
import { Agent } from "@vexis/schema/agent"
import { Session } from "@vexis/schema/session"

const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String.pipe(Schema.optional),
  prompt: Schema.String,
  agent: Agent.ID.pipe(Schema.optional),
  dependsOn: Schema.Array(Schema.String).pipe(Schema.optional),
})

const Plan = Schema.Struct({
  location: Schema.Struct({
    directory: AbsolutePath,
    workspaceID: Schema.String.pipe(Schema.optional),
  }),
  tasks: Schema.Array(Task),
  concurrency: Schema.Number.pipe(Schema.optional),
})

export const makeCascadeGroup = () =>
  HttpApiGroup.make("server.cascade")
    .add(
      HttpApiEndpoint.post("cascade.run", "/api/cascade", {
        payload: Plan,
        success: Schema.Struct({
          data: Schema.Struct({
            sessions: Schema.Record(Schema.String, Session.ID),
            artifacts: Schema.Record(Schema.String, Schema.Unknown),
          }),
        }),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "vexis.cascade.run",
          summary: "Run a Cascade plan",
          description: "Create and execute a dependency-aware group of Vexis agent sessions.",
        }),
      ),
    )
