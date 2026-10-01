import { AgentV2 } from "@vexis/core/agent"
import { SessionMessage } from "@vexis/core/session/message"
import { ToolRegistry } from "@vexis/core/tool/registry"
import { Effect } from "effect"

export const toolIdentity = {
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make("msg_tool_test"),
}

export const toolDefinitions = (
  registry: ToolRegistry.Interface,
  permissions?: Parameters<typeof registry.materialize>[0],
) => registry.materialize(permissions).pipe(Effect.map((materialized) => materialized.definitions))

export const settleTool = (registry: ToolRegistry.Interface, input: ToolRegistry.ExecuteInput) =>
  registry.materialize().pipe(Effect.flatMap((materialized) => materialized.settle(input)))

export const executeTool = (registry: ToolRegistry.Interface, input: ToolRegistry.ExecuteInput) =>
  settleTool(registry, input).pipe(Effect.map((settlement) => settlement.result))
