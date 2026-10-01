import { For, Show, createMemo, createSignal } from "solid-js"
import { Icon } from "@vexis/ui/icon"
import { useParams } from "@solidjs/router"
import { useServerSync } from "@/context/server-sync"

type CascadeMetadata = {
  taskID?: string
  dependsOn?: string[]
  parentSessionID?: string
}

function cascadeMetadata(value: unknown): CascadeMetadata | undefined {
  if (!value || typeof value !== "object") return undefined
  const cascade = (value as { cascade?: unknown }).cascade
  if (!cascade || typeof cascade !== "object") return undefined
  return cascade as CascadeMetadata
}

export function CascadePanel() {
  const params = useParams<{ id: string }>()
  const sync = useServerSync()
  const [open, setOpen] = createSignal(false)

  const graph = createMemo(() => {
    const info = sync().session.data.info
    const current = info[params.id]
    if (!current) return undefined

    let root = current
    const seen = new Set<string>()
    while (root.parentID && !seen.has(root.id)) {
      seen.add(root.id)
      const parent = info[root.parentID]
      if (!parent) break
      root = parent
    }

    const tasks = Object.values(info)
      .filter((item): item is NonNullable<typeof item> => !!item)
      .map((item) => ({ item, metadata: cascadeMetadata(item.metadata) }))
      .filter(({ item, metadata }) => metadata?.parentSessionID === root.id || item.parentID === root.id)
      .sort((a, b) => (a.metadata?.taskID ?? a.item.id).localeCompare(b.metadata?.taskID ?? b.item.id))

    return { root, tasks }
  })

  return (
    <Show when={graph()?.tasks.length}>
      <div class="absolute top-3 end-3 z-30">
        <Show
          when={open()}
          fallback={
            <button
              type="button"
              class="h-9 px-3 rounded-md border border-border-base bg-background-stronger text-12-medium text-text-base shadow-lg flex items-center gap-2"
              onClick={() => setOpen(true)}
              title="Show Cascade agent team"
            >
              <Icon name="sparkles" size="14" />
              Agents <span class="text-text-weak">{graph()!.tasks.length}</span>
            </button>
          }
        >
          <div class="w-[340px] max-h-[70vh] overflow-auto rounded-lg border border-border-base bg-background-base shadow-xl">
            <div class="px-3 py-2 border-b border-border-weaker-base flex items-center justify-between">
              <div>
                <div class="text-13-medium text-text-base">Vexis Cascade</div>
                <div class="text-11-regular text-text-weak">Agent team execution graph</div>
              </div>
              <button
                type="button"
                class="size-7 rounded hover:bg-background-stronger flex items-center justify-center"
                onClick={() => setOpen(false)}
                aria-label="Close Cascade panel"
              >
                <Icon name="xmark-small" size="14" />
              </button>
            </div>

            <div class="p-2 flex flex-col gap-2">
              <For each={graph()!.tasks}>
                {(node) => {
                  const running = () => sync().session.data.session_status[node.item.id]?.type !== "idle"
                  const taskID = () => node.metadata?.taskID ?? node.item.id
                  const deps = () => node.metadata?.dependsOn ?? []

                  return (
                    <div class="rounded-md border border-border-weaker-base bg-background-stronger px-3 py-2">
                      <div class="flex items-center gap-2">
                        <span
                          class="size-2 rounded-full"
                          classList={{ "bg-icon-info": running(), "bg-icon-success": !running() }}
                        />
                        <span class="text-12-medium text-text-base truncate">{taskID()}</span>
                        <span class="ms-auto text-11-regular text-text-weak">
                          {running() ? "running" : "complete"}
                        </span>
                      </div>
                      <div class="text-11-regular text-text-weak mt-1 truncate">{node.item.title}</div>
                      <Show when={deps().length}>
                        <div class="text-10-regular text-text-faint mt-1">
                          depends on: {deps().join(", ")}
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )
}
