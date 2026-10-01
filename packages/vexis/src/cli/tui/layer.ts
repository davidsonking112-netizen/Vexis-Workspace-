import { run as runTui, type TuiInput } from "@vexis/tui"
import { Global } from "@vexis/core/global"
import { AppNodeBuilder } from "@vexis/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
