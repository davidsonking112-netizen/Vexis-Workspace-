import { AgentV2 } from "@vexis/core/agent"
import { AISDK } from "@vexis/core/aisdk"
import { Catalog } from "@vexis/core/catalog"
import { CommandV2 } from "@vexis/core/command"
import { Credential } from "@vexis/core/credential"
import { AppNodeBuilder } from "@vexis/core/effect/app-node-builder"
import { LayerNodePlatform } from "@vexis/core/effect/app-node-platform"
import { LayerNode } from "@vexis/core/effect/layer-node"
import { EventV2 } from "@vexis/core/event"
import { FileSystem } from "@vexis/core/filesystem"
import { FSUtil } from "@vexis/core/fs-util"
import { Integration } from "@vexis/core/integration"
import { Location } from "@vexis/core/location"
import { Npm } from "@vexis/core/npm"
import { PluginV2 } from "@vexis/core/plugin"
import { Reference } from "@vexis/core/reference"
import { SkillV2 } from "@vexis/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
