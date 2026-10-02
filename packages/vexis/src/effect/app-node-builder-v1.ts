import { AppNodeBuilder } from "@vexis/core/effect/app-node-builder"
import { LayerNode } from "@vexis/core/effect/layer-node"
import { SessionExecution } from "@vexis/core/session/execution"
import * as SessionExecutionLocal from "@vexis/core/session/execution/local"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"

const bootstrapReplacement = [InstanceStore.bootstrapNode, InstanceBootstrap.node] as const
const runtimeReplacements = [[SessionExecution.node, SessionExecutionLocal.node]] as const

export function build<A, E>(root: LayerNode.Node<A, E, any>, replacements: LayerNode.Replacements = []) {
  return AppNodeBuilder.build(root, replacements.concat([...bootstrapReplacement, ...runtimeReplacements]))
}

export * as AppNodeBuilderV1 from "./app-node-builder-v1"
