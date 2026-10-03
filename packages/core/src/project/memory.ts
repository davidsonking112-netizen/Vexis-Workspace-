import { Context, Effect, Layer } from "effect"
import path from "path"
import { FSUtil } from "../fs-util"
import { AbsolutePath } from "../schema"
import { makeGlobalNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"

const FILE = ".vexis/memory.md"

export type Entry = {
  readonly topic: string
  readonly content: string
  readonly source?: string
  readonly updatedAt: string
}

export interface Interface {
  readonly path: (directory: AbsolutePath) => string
  readonly read: (directory: AbsolutePath) => Effect.Effect<string>
  readonly write: (input: { directory: AbsolutePath; content: string }) => Effect.Effect<void>
  readonly append: (input: { directory: AbsolutePath; entry: Omit<Entry, "updatedAt"> }) => Effect.Effect<void>
  readonly context: (directory: AbsolutePath, maxChars?: number) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@vexis/ProjectMemory") {}

const normalize = (value: string) => value.trim().replace(/\r\n/g, "\n")

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const locks = KeyedMutex.makeUnsafe<string>()

    const memoryPath = (directory: AbsolutePath) => path.join(directory, FILE)

    const read = Effect.fn("ProjectMemory.read")(function* (directory: AbsolutePath) {
      return normalize((yield* fs.readFileStringSafe(memoryPath(directory))) ?? "")
    })

    const write = Effect.fn("ProjectMemory.write")(function* (input: { directory: AbsolutePath; content: string }) {
      yield* fs.writeWithDirs(memoryPath(input.directory), normalize(input.content) + "\n")
    })

    const append = Effect.fn("ProjectMemory.append")(function* (input: {
      directory: AbsolutePath
      entry: Omit<Entry, "updatedAt">
    }) {
      return yield* locks.withLock(memoryPath(input.directory))(
        Effect.gen(function* () {
          const existing = yield* read(input.directory)
          const block = [
            `## ${input.entry.topic.trim()}`,
            "",
            input.entry.content.trim(),
            "",
            `_Updated: ${new Date().toISOString()}${input.entry.source ? ` · Source: ${input.entry.source}` : ""}_`,
            "",
          ].join("\n")
          yield* write({
            directory: input.directory,
            content: existing ? existing + "\n" + block : `# Vexis Project Memory\n\n` + block,
          })
        }),
      )
    })

    const context = Effect.fn("ProjectMemory.context")(function* (directory: AbsolutePath, maxChars = 12000) {
      const value = yield* read(directory)
      if (value.length <= maxChars) return value
      return value.slice(0, maxChars) + "\n\n[Project memory truncated]"
    })

    return Service.of({ path: memoryPath, read, write, append, context })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node],
})
