# Feature: voice-dictation (local speech-to-text for OpenCode V2 TUI)

## Objective
A free, fully local, no-LLM speech-to-text plugin for the OpenCode V2 TUI:
press a key, speak, and get a whisper.cpp transcription into the prompt.

## Problem
OpenCode V2 has no built-in STT. The two community TUI plugins require an LLM
(renjfk) or a cloud API (opencode-talk). The user wants local whisper only,
matching their existing whisper.cpp setup.

## Why
- Reuse the machine's existing local stack: `whisper-cli` (whisper.cpp) and ggml models.
- No LLM normalization, no cloud, no API keys.
- Stage the text in the composer instead of auto-sending.

## Scope
- Local TUI plugin (`Plugin.define` from `@opencode/plugin/tui`).
- Record with PipeWire (`pw-record`), fall back to `arecord`/`ffmpeg`.
- Transcribe with `whisper-cli`.
- Stage text with clipboard + `prompt.paste`; use the append API when present.
- Slash commands for model, language, microphone.

## Out of scope
- LLM cleanup/normalization.
- TTS.
- Non-Linux platforms.

## Constraints / environment (verified)
- OpenCode `v2.0.26` (Homebrew `opencode-v2`).
- `whisper-cli` on PATH -> `~/.local/share/dictate/whisper.cpp/build/bin/whisper-cli`.
- Models: `~/models/ggml-small.bin`, `~/.local/share/dictate/models/ggml-base.bin`.
- PipeWire (`pw-record`), `ffmpeg`, `arecord`, `wl-copy`, `xclip` present.
- No `sox`, no `pactl`.
- `v2.0.26` has NO `/tui/append-prompt` route and no `client.tui` (verified in
  the binary and against the live server). `tui.prompt.append` exists but has no
  plugin-facing publish route in this build.
- **External TUI plugins declared in `tui.json` are not loaded** by this build.
  Discovery happens under `<global-config>/plugins/` (flat `.ts` files or a
  package directory with `index.ts` + `tui.ts`).

## Tasks
- [x] T1: Plugin package scaffold.
- [x] T2: Recording module (`backend.js`).
- [x] T3: Transcription module (`backend.js`).
- [x] T4: TUI plugin wiring, commands, injection ladder (`tui.ts`).
- [x] T5: README + install wiring.
- [x] T6: Node syntax checks + functional smoke test of `transcribe`.
- [x] T7: Fix loading (symlink into `~/.config/opencode/plugins/voice-dictation`).
- [x] T8: Keybind default -> `insert`.
- [x] T9: Clipboard staging mode (no auto-send).

## Acceptance criteria
- `node --check backend.js` and `node --experimental-strip-types --check tui.ts` pass.
- `transcribe()` runs `whisper-cli` and returns a string on a valid wav, rejects on empty.
- OpenCode loads the plugin and the commands appear in `/plugins` + palette.

## Route
- Direct inline: single cohesive plugin; all API evidence gathered in the parent
  context (delegating would re-derive it). No external writer.

## Delivery
- Not a git repo. Offer `git init` + work-unit commit.

## Progress / evidence
- `node --check` OK for `backend.js`, `index.ts`; `tui.ts` OK (type stripping).
- `discoverModels()` -> `~/models/ggml-small.bin`, `~/.local/share/dictate/models/ggml-base.bin`.
- `transcribe()` ran `whisper-cli` on a test wav and returned text.
- `resolveWhisperBin()` -> `whisper-cli`; `pickRecorder()` -> `pw-record`.
- OpenCode log confirms `loading plugin id=.../plugins/voice-dictation entrypoint=.../index.ts`
  with no errors; the CLI-side loader grew from 12 to 13 plugins.
- Pending live check: TUI command layer, `insert` binding, clipboard paste.

## Next step
User restarts OpenCode, verifies `/plugins` shows `voice-dictation`, then tests
`insert` and `/dictate` with a real microphone.
