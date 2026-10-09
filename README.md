# opencode-voice-dictation

[![ci](https://github.com/nachosag/opencode-voice-dictation/actions/workflows/ci.yml/badge.svg)](https://github.com/nachosag/opencode-voice-dictation/actions/workflows/ci.yml)

Local, **no-LLM** speech-to-text for the [OpenCode](https://opencode.ai) TUI.
Press a key, speak, and the transcription lands in your prompt — transcribed
entirely on your machine with [whisper.cpp](https://github.com/ggml-org/whisper.cpp).

- Free and offline: no cloud, no API keys, no LLM cleanup.
- Records with PipeWire (`pw-record`), falls back to `arecord` / `ffmpeg`.
- Transcribes with `whisper-cli` and a local ggml model.
- Stages the text in the composer instead of sending it.

```
Insert →  "refactor the auth middleware to use jwt"  → Insert
prompt:   refactor the auth middleware to use jwt
```

## Requirements

- Linux with PipeWire or ALSA.
- `whisper-cli` on `PATH`.
- A ggml whisper model.
- One clipboard tool: `wl-copy` (wl-clipboard) or `xclip`.

### `whisper-cli`

Install a distro package when available (for example `whisper-cpp` from the
AUR), otherwise build it:

```sh
git clone https://github.com/ggml-org/whisper.cpp ~/opt/whisper.cpp
cmake -B ~/opt/whisper.cpp/build -S ~/opt/whisper.cpp -DCMAKE_BUILD_TYPE=Release
cmake --build ~/opt/whisper.cpp/build -j --target whisper-cli
mkdir -p ~/.local/bin
ln -sf ~/opt/whisper.cpp/build/bin/whisper-cli ~/.local/bin/whisper-cli
```

### A model

```sh
mkdir -p ~/.local/share/whisper-cpp
curl -L -o ~/.local/share/whisper-cpp/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

Models are also discovered in `~/models` and `~/.local/share/dictate/models`.

## Install

OpenCode discovers plugins under its config directory, so one clone is enough:

```sh
git clone --depth 1 https://github.com/nachosag/opencode-voice-dictation.git \
  ~/.config/opencode/plugins/voice-dictation
```

Restart OpenCode. That's it.

Prefer a script? `install.sh` clones to the right place and is safe to re-run:

```sh
curl -fsSL https://raw.githubusercontent.com/nachosag/opencode-voice-dictation/main/install.sh | sh
```

Working on the plugin itself? Link a checkout instead:

```sh
sh install.sh --link /path/to/opencode-voice-dictation
```

> Declaring this in `tui.json` does not work: current OpenCode builds do not load
> external TUI plugins from there. The plugins directory is the supported path.

## Usage

| Command | Keybind | Description |
| --- | --- | --- |
| `/dictate` (alias `/stt`) | `insert` | Start/stop recording + transcribe |
| `/dictate-send` | — | Record, transcribe, and send |
| `/dictate-model` | — | Pick a whisper model |
| `/dictate-language` | — | Pick the transcription language |
| `/dictate-mic` | — | Pick the microphone |
| `/dictate-inject` | — | Pick how text reaches the prompt |
| `/dictate-keybind` | — | Change the dictation key |

Press the key once to start recording, again to stop and transcribe.

All choices are remembered across restarts.

## How text reaches the prompt

| Mode | Behavior |
| --- | --- |
| `auto` (default) | Prompt-append API when the build has it, otherwise clipboard staging. |
| `clipboard` | Copy the text and trigger the TUI paste. Stages without sending. |
| `append` | Prompt-append API (newer builds only). |
| `submit` | Send the transcription as a prompt immediately. |

`clipboard` copies with `wl-copy`/`xclip` and runs the built-in `prompt.paste`
command. If the paste does not land, the text is on your clipboard — press
`Ctrl+V`. Change the mode any time with `/dictate-inject`.

> The `/tui/append-prompt` route is not available in every build (it is missing
> in OpenCode `2.0.26`). `auto` handles both cases.

## Configuration

Defaults live in `tui.ts` and can be changed at runtime with the commands above:

| Option | Default | Description |
| --- | --- | --- |
| `model` | auto | Absolute path to a ggml `.bin`. Auto-detected when empty. |
| `language` | `auto` | whisper language code (`es`, `en`, …) or `auto`. |
| `whisperBin` | `whisper-cli` | Binary name or absolute path. |
| `keybind` | `insert` | Keymap binding for `/dictate`. |
| `inject` | `auto` | See above. |
| `mic` | `""` | PipeWire target name; empty = system default. |

## How it works

1. `pw-record` captures 16 kHz mono audio to a temp wav.
2. `whisper-cli -m <model> -f <wav> -l <lang> -np -nt` writes the plain text.
3. The text is staged in the prompt (clipboard paste) or submitted.

No network calls, no LLM, no telemetry.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Not listed in `/plugins` | Check `~/.config/opencode/plugins/voice-dictation/{index.ts,tui.ts}` exists, then restart OpenCode. |
| `whisper-cli not found` | Install it on `PATH`, or edit `whisperBin` in `tui.ts`. |
| `No whisper model found` | Download a ggml model into `~/.local/share/whisper-cpp`, then run `/dictate-model`. |
| `No speech detected` | Speak closer to the mic, or pick a larger model. |
| `Mic error` | Check `pw-record` works: `pw-record --rate 16000 --channels 1 --format s16 /tmp/t.wav`, then `Ctrl+C`. |
| `insert` does nothing | Run `/dictate-keybind` and pick another key, or use `/dictate`. |
| Text not in the prompt | It is on your clipboard; press `Ctrl+V`. Or run `/dictate-inject`. |

## Uninstall

```sh
rm -rf ~/.config/opencode/plugins/voice-dictation
```

## Roadmap

- macOS and Windows support (recorder + clipboard backends).
- More languages in the picker.

## Contributing

Issues and PRs are welcome. `npm run check` runs the syntax checks CI uses.

## License

[MIT](LICENSE)
