import { Plugin } from "@opencode/plugin"

// Server-side entrypoint. This plugin does all of its work in the TUI, so the
// server side is a no-op kept only so the package exposes a loadable server
// entrypoint beside ./tui.
export default Plugin.define({
  id: "voice-dictation",
  setup() {},
})
