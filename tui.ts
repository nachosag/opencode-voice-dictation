import { Plugin } from "@opencode/plugin/tui"
import {
  defaultModel,
  discoverModels,
  listMicrophones,
  resolveWhisperBin,
  startRecording,
  transcribe,
  writeClipboard,
} from "./backend.js"

type InjectMode = "auto" | "append" | "clipboard" | "submit"
type Injected = "append" | "clipboard" | "submit"

type Config = {
  model: string
  language: string
  whisperBin: string
  keybind: string
  inject: InjectMode
  mic: string
}

const LANGUAGES: Array<[string, string]> = [
  ["auto", "Auto-detect"],
  ["es", "Spanish"],
  ["en", "English"],
  ["pt", "Portuguese"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["zh", "Chinese"],
  ["ja", "Japanese"],
]

const basename = (value: string) => value.replace(/^.*\//, "")
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default Plugin.define({
  id: "voice-dictation",
  setup(context) {
    const [config, update] = context.storage.store<Config>("config", {
      initial: {
        model: "",
        language: "auto",
        whisperBin: "whisper-cli",
        keybind: "insert",
        inject: "auto",
        mic: "",
      },
    })

    const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") =>
      context.ui.toast.show({ message, variant, duration: 3000 })

    let recording: Awaited<ReturnType<typeof startRecording>> | null = null
    let busy = false

    const activeSessionID = (): string | undefined => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    type TuiAppendClient = { tui?: { appendPrompt?: (input: { text: string }) => Promise<unknown> } }
    const canAppend = () => typeof (context.client as unknown as TuiAppendClient).tui?.appendPrompt === "function"

    // Stage text in the composer using the clipboard plus the TUI's own paste
    // command. Works on builds without the prompt-append API.
    const stageViaClipboard = async (text: string) => {
      const tool = await writeClipboard(text)
      await delay(120)
      context.keymap.dispatch("prompt.paste")
      return tool
    }

    const inject = async (text: string, forceSubmit: boolean): Promise<Injected> => {
      if (forceSubmit || config.inject === "submit") {
        let sessionID = activeSessionID()
        if (!sessionID) {
          const created = await context.client.session.create({})
          sessionID = created.id
          context.ui.router.navigate({ type: "session", sessionID })
        }
        await context.client.session.prompt({ sessionID, text })
        return "submit"
      }

      const preferAppend = config.inject === "append" || (config.inject === "auto" && canAppend())
      if (preferAppend) {
        const appendPrompt = (context.client as unknown as TuiAppendClient).tui?.appendPrompt
        if (typeof appendPrompt !== "function") {
          throw new Error('No prompt-append API in this build; use inject "clipboard" or "submit"')
        }
        await appendPrompt({ text })
        return "append"
      }

      if (config.inject === "auto" || config.inject === "clipboard") {
        await stageViaClipboard(text)
        return "clipboard"
      }

      throw new Error(`Unknown inject mode: ${config.inject}`)
    }

    const dictation = async (forceSubmit: boolean) => {
      if (busy) {
        toast("Voice: still working…", "info")
        return
      }

      if (!recording) {
        const bin = await resolveWhisperBin(config.whisperBin)
        if (!bin) {
          toast("whisper-cli not found (PATH or whisperBin)", "error")
          return
        }
        try {
          recording = await startRecording({ device: config.mic || undefined })
          toast("Recording — press again to transcribe", "info")
        } catch (err) {
          toast(`Mic error: ${(err as Error)?.message ?? err}`, "error")
        }
        return
      }

      const active = recording
      recording = null
      busy = true
      try {
        await active.stop()
        toast("Transcribing…", "info")

        const model = config.model || defaultModel()
        if (!model) {
          throw new Error(
            'No whisper model found (looked in ~/models and ~/.local/share/whisper-cpp). Set one with /dictate-model.',
          )
        }
        const bin = (await resolveWhisperBin(config.whisperBin)) ?? "whisper-cli"
        const text = await transcribe(active.file, model, config.language, bin)
        if (!text) {
          toast("No speech detected", "warning")
          return
        }

        const mode = await inject(text, forceSubmit)
        if (mode === "clipboard") toast("Staged in prompt (if missing, press Ctrl+V)", "success")
        else if (mode === "append") toast("Added to prompt", "success")
        else toast("Prompt submitted", "success")
      } catch (err) {
        toast(`Voice error: ${(err as Error)?.message ?? err}`, "error")
      } finally {
        busy = false
      }
    }

    const pickModel = async () => {
      const models = discoverModels()
      if (models.length === 0) {
        toast("No ggml-*.bin models in ~/models or ~/.local/share/whisper-cpp", "warning")
        return
      }
      const choice = await context.ui.dialog.select<string>({
        title: "Whisper model",
        current: config.model || defaultModel() || "",
        options: models.map((model) => ({ title: basename(model), value: model, description: model })),
      })
      if (choice !== undefined) {
        await update((draft) => {
          draft.model = choice
        })
        toast(`Model: ${basename(choice)}`, "success")
      }
    }

    const pickLanguage = async () => {
      const choice = await context.ui.dialog.select<string>({
        title: "Transcription language",
        current: config.language,
        options: LANGUAGES.map(([value, title]) => ({ title, value })),
      })
      if (choice !== undefined) {
        await update((draft) => {
          draft.language = choice
        })
        toast(`Language: ${choice}`, "success")
      }
    }

    const pickMic = async () => {
      const mics = await listMicrophones()
      if (mics.length === 0) {
        const typed = await context.ui.dialog.prompt({
          title: "Microphone (PipeWire target)",
          description: "Leave empty for the system default",
          value: config.mic,
          placeholder: "e.g. alsa_input.pci-0000_00_1f.3.analog-stereo",
        })
        if (typed !== undefined) {
          await update((draft) => {
            draft.mic = typed.trim()
          })
          toast(typed.trim() ? `Mic: ${typed.trim()}` : "Mic: system default", "success")
        }
        return
      }
      const choice = await context.ui.dialog.select<string>({
        title: "Microphone",
        current: config.mic,
        options: [{ title: "System default", value: "" }, ...mics.map((name) => ({ title: name, value: name }))],
      })
      if (choice !== undefined) {
        await update((draft) => {
          draft.mic = choice
        })
        toast(choice ? `Mic: ${choice}` : "Mic: system default", "success")
      }
    }

    const pickInject = async () => {
      const choice = await context.ui.dialog.select<InjectMode>({
        title: "Injection mode",
        current: config.inject,
        options: [
          { title: "auto", value: "auto", description: "Append API when available, otherwise clipboard staging" },
          { title: "clipboard", value: "clipboard", description: "Paste into the prompt without sending" },
          { title: "append", value: "append", description: "Prompt-append API (newer builds only)" },
          { title: "submit", value: "submit", description: "Send the transcription immediately" },
        ],
      })
      if (choice !== undefined) {
        await update((draft) => {
          draft.inject = choice
        })
        toast(`Inject: ${choice}`, "success")
      }
    }

    const pickKeybind = async () => {
      const typed = await context.ui.dialog.prompt({
        title: "Dictation keybind",
        description: "A key or chord, for example: insert, f9, <leader>v",
        value: config.keybind,
        placeholder: "insert",
      })
      if (typed !== undefined && typed.trim()) {
        await update((draft) => {
          draft.keybind = typed.trim()
        })
        toast(`Keybind: ${typed.trim()}`, "success")
      }
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "voice.dictate",
          title: "Voice: dictate",
          group: "Voice",
          bind: config.keybind,
          palette: true,
          slash: { name: "dictate", aliases: ["stt"] },
          run: () => dictation(false),
        },
        {
          id: "voice.dictate.send",
          title: "Voice: dictate and send",
          group: "Voice",
          slash: { name: "dictate-send" },
          run: () => dictation(true),
        },
        {
          id: "voice.model",
          title: "Voice: select whisper model",
          group: "Voice",
          slash: { name: "dictate-model" },
          run: () => pickModel(),
        },
        {
          id: "voice.language",
          title: "Voice: select language",
          group: "Voice",
          slash: { name: "dictate-language" },
          run: () => pickLanguage(),
        },
        {
          id: "voice.mic",
          title: "Voice: select microphone",
          group: "Voice",
          slash: { name: "dictate-mic" },
          run: () => pickMic(),
        },
        {
          id: "voice.inject",
          title: "Voice: select injection mode",
          group: "Voice",
          slash: { name: "dictate-inject" },
          run: () => pickInject(),
        },
        {
          id: "voice.keybind",
          title: "Voice: change keybind",
          group: "Voice",
          slash: { name: "dictate-keybind" },
          run: () => pickKeybind(),
        },
      ],
    }))
  },
})
