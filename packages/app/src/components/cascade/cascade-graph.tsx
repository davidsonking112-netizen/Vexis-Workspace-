import { For, Show } from "solid-js"

export type CascadeNode = {
  id: string
  title: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  agent?: string
  dependsOn?: string[]
  sessionID?: string
}

export type CascadeGraphProps = {
  nodes: readonly CascadeNode[]
  onOpenSession?: (sessionID: string) => void
}

const statusLabel = (status: CascadeNode["status"]) => status[0].toUpperCase() + status.slice(1)

export function CascadeGraph(props: CascadeGraphProps) {
  return (
    <section class="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <header class="flex items-center justify-between gap-4">
        <div>
          <h2 class="text-base font-medium">Vexis Cascade</h2>
          <p class="text-sm text-muted-foreground">Parallel agent execution and shared project context</p>
        </div>
        <span class="text-xs text-muted-foreground">{props.nodes.length} agents</span>
      </header>

      <div class="grid gap-2">
        <For each={props.nodes}>
          {(node) => (
            <article class="rounded-lg border border-border bg-muted/20 p-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="size-2 rounded-full bg-current opacity-70" />
                    <span class="truncate text-sm font-medium">{node.title}</span>
                  </div>
                  <Show when={node.agent}>
                    <div class="mt-1 text-xs text-muted-foreground">Agent: {node.agent}</div>
                  </Show>
                </div>
                <span class="shrink-0 text-xs text-muted-foreground">{statusLabel(node.status)}</span>
              </div>

              <Show when={node.dependsOn?.length}>
                <div class="mt-2 text-xs text-muted-foreground">
                  Depends on: {node.dependsOn!.join(", ")}
                </div>
              </Show>

              <Show when={node.sessionID && props.onOpenSession}>
                <button
                  class="mt-2 text-xs text-primary hover:underline"
                  onClick={() => props.onOpenSession?.(node.sessionID!)}
                >
                  Open agent session
                </button>
              </Show>
            </article>
          )}
        </For>
      </div>
    </section>
  )
}
