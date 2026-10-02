import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Schema } from "effect"
import { AbsolutePath } from "@vexis/schema/schema"
import { Agent } from "@vexis/schema/agent"
import { Session } from "@vexis/schema/session"
import { Workspace } from "@vexis/schema/workspace"

const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String.pipe(Schema.optional),
  prompt: Schema.String,
  agent: Agent.ID.pipe(Schema.optional),
  dependsOn: Schema.Array(Schema.String).pipe(Schema.optional),
  role: Schema.String.pipe(Schema.optional),
  capability: Schema.String.pipe(Schema.optional),
  mutatesWorkspace: Schema.Boolean.pipe(Schema.optional),
  retries: Schema.Int.pipe(Schema.optional),
})

const Result = Schema.Struct({
  data: Schema.Struct({
    sessions: Schema.Record(Schema.String, Session.ID),
    artifacts: Schema.Record(Schema.String, Schema.Unknown),
  }),
})

const Plan = Schema.Struct({
  location: Schema.Struct({
    directory: AbsolutePath,
    workspaceID: Workspace.ID.pipe(Schema.optional),
  }),
  tasks: Schema.Array(Task),
  concurrency: Schema.Number.pipe(Schema.optional),
  parentSessionID: Session.ID.pipe(Schema.optional),
})

export const makeCascadeGroup = () =>
  HttpApiGroup.make("server.cascade")
    .add(
      HttpApiEndpoint.post("cascade.run", "/api/cascade", {
        payload: Plan,
        success: Result,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "vexis.cascade.run",
          summary: "Run a Cascade plan",
          description: "Create and execute a dependency-aware group of Vexis agent sessions.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("cascade.resume", "/api/cascade/:sessionID/resume", {
        params: { sessionID: Session.ID },
        success: Result,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "vexis.cascade.resume",
          summary: "Resume a Cascade mission",
          description: "Resume a persisted Cascade mission from its durable session history.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("cascade.cancel", "/api/cascade/:sessionID/cancel", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Struct({ cancelled: Schema.Boolean }) }),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "vexis.cascade.cancel",
          summary: "Cancel a Cascade mission",
          description: "Interrupt the active Cascade coordinator for a session.",
        }),
      ),
    )
