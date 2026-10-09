// backend.js — local audio capture (PipeWire/ALSA/ffmpeg) and whisper.cpp
// transcription. Plain ESM so it also runs under plain Node for testing.
import { execFile, spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const HOME = os.homedir()

// Directories searched for whisper ggml models, in priority order.
export const MODEL_DIRS = [
  path.join(HOME, "models"),
  path.join(HOME, ".local", "share", "whisper-cpp"),
  path.join(HOME, ".local", "share", "dictate", "models"),
]

export function discoverModels() {
  const found = []
  for (const dir of MODEL_DIRS) {
    let entries = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name.endsWith(".bin")) found.push(path.join(dir, name))
    }
  }
  return found
}

export function defaultModel() {
  return discoverModels()[0] ?? null
}

function commandExists(cmd) {
  return new Promise((resolve) => {
    execFile("sh", ["-c", `command -v "${cmd}" >/dev/null 2>&1`], (err) => resolve(!err))
  })
}

function runFile(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

// Resolve the whisper binary: config value, PATH, or the common local install.
export async function resolveWhisperBin(preferred) {
  const candidates = [preferred, "whisper-cli", path.join(HOME, ".local", "bin", "whisper-cli")].filter(Boolean)
  for (const candidate of candidates) {
    if (candidate.includes("/")) {
      if (existsSync(candidate)) return candidate
      continue
    }
    if (await commandExists(candidate)) return candidate
  }
  return null
}

export async function pickRecorder() {
  for (const candidate of ["pw-record", "arecord", "ffmpeg"]) {
    if (await commandExists(candidate)) return candidate
  }
  return null
}

let counter = 0
function recordingFile() {
  const dir = path.join(os.tmpdir(), "opencode-voice-dictation")
  mkdirSync(dir, { recursive: true })
  counter += 1
  return path.join(dir, `rec-${Date.now()}-${counter}.wav`)
}

// Start recording to a temp wav. Returns a handle with stop().
export async function startRecording(options = {}) {
  const bin = await pickRecorder()
  if (!bin) {
    throw new Error("No audio recorder found. Install PipeWire (pw-record) or alsa-utils (arecord).")
  }

  const file = recordingFile()
  let args
  if (bin === "pw-record") {
    args = ["--rate", "16000", "--channels", "1", "--format", "s16"]
    if (options.device) args.push("--target", options.device)
    args.push(file)
  } else if (bin === "arecord") {
    args = ["-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "wav"]
    if (options.device) args.push("-D", options.device)
    args.push(file)
  } else {
    args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "pulse",
      "-i",
      options.device || "default",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-y",
      file,
    ]
  }

  const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] })
  let stderr = ""
  let spawnError = null
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString()
  })
  child.once("error", (err) => {
    spawnError = err
  })
  const exited = new Promise((resolve) => child.once("exit", () => resolve()))

  // Give the process a moment to fail fast (missing device, permission, ...).
  await new Promise((resolve) => setTimeout(resolve, 150))
  if (spawnError) throw spawnError

  let stopped = false
  return {
    file,
    command: bin,
    get stderr() {
      return stderr
    },
    async stop() {
      if (stopped) return
      stopped = true
      try {
        child.kill("SIGINT")
      } catch {}
      const done = await Promise.race([
        exited.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 2500)),
      ])
      if (!done) {
        try {
          child.kill("SIGKILL")
        } catch {}
      }
    },
  }
}

// Transcribe a wav with whisper-cli. Resolves to the cleaned text.
export function transcribe(wav, model, language, whisperBin = "whisper-cli") {
  return new Promise((resolve, reject) => {
    if (!model || !existsSync(model)) return reject(new Error(`Whisper model not found: ${model || "(unset)"}`))
    if (!existsSync(wav)) return reject(new Error("Recording file missing"))
    if (statSync(wav).size <= 44) return reject(new Error("Recording is empty"))

    const child = spawn(whisperBin, ["-m", model, "-f", wav, "-l", language || "auto", "-np", "-nt"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk) => {
      out += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      err += chunk.toString()
    })

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {}
      reject(new Error("Transcription timed out (120s)"))
    }, 120000)

    child.once("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(err.trim().split("\n").pop() || `whisper-cli exited ${code}`))
      resolve(
        out
          .replace(/\[[^\]]*\]/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
    })
  })
}

// Put text on the system clipboard. Returns the tool used.
export async function writeClipboard(text) {
  const tools = [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
  ]
  for (const [cmd, args] of tools) {
    if (!(await commandExists(cmd))) continue
    await new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] })
      child.once("error", reject)
      child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
      child.stdin.end(text)
    })
    return cmd
  }
  throw new Error("No clipboard tool found (install wl-clipboard or xclip)")
}

// List microphone source names usable as a pw-record --target value.
export async function listMicrophones() {
  if (await commandExists("pactl")) {
    try {
      const data = JSON.parse(await runFile("pactl", ["-f", "json", "list", "sources"]))
      if (Array.isArray(data)) {
        return data
          .filter((source) => source?.name && !source.name.endsWith(".monitor"))
          .map((source) => source.name)
      }
    } catch {}
  }
  return []
}
