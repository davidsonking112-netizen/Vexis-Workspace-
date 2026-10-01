export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@vexis/schema/event"
import { EventManifest } from "@vexis/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
