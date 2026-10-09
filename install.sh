#!/usr/bin/env sh
# Install opencode-voice-dictation for the OpenCode TUI.
#
#   sh install.sh                 clone the repo into the OpenCode plugin dir
#   sh install.sh --link <path>   symlink a local checkout instead (for dev)
#
set -eu

REPO="${VOICE_DICTATION_REPO:-https://github.com/nachosag/opencode-voice-dictation.git}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
PLUGIN_DIR="$CONFIG_DIR/plugins/voice-dictation"

if [ -e "$PLUGIN_DIR" ] || [ -L "$PLUGIN_DIR" ]; then
  echo "opencode-voice-dictation is already installed at:"
  echo "  $PLUGIN_DIR"
  echo
  echo "Update it with:"
  echo "  git -C \"$PLUGIN_DIR\" pull"
  exit 0
fi

mkdir -p "$CONFIG_DIR/plugins"

if [ "${1:-}" = "--link" ]; then
  if [ -z "${2:-}" ]; then
    echo "Usage: sh install.sh --link <path-to-checkout>" >&2
    exit 1
  fi
  ln -sfn "$(cd "$2" && pwd)" "$PLUGIN_DIR"
  echo "Linked $2 -> $PLUGIN_DIR"
else
  git clone --depth 1 "$REPO" "$PLUGIN_DIR"
  echo "Cloned $REPO -> $PLUGIN_DIR"
fi

echo
echo "Restart OpenCode, then press Insert (or run /dictate) to start dictating."
echo "First time? Run /dictate-keybind, /dictate-model and /dictate-language."
