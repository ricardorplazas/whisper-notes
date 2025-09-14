# Whisper Notes

**Record while you type.** Add an inline audio recorder to any note, save the audio file, transcribe with Whisper, and (optionally) generate a summary with your own LLM API key.

- **Plugin ID:** `whisper-notes`
- **Author:** Ricardo Rodriguez
- **Minimum Obsidian:** 1.4.0

---

## Features

- **Inline recorder block** you can insert in any note; keep typing while recording.
- **One-click controls**: Start · Pause · Resume · Stop.
- **Full-width rounded VU meter** while recording.
- **Smart insertion order**: embeds the **audio** first, then a collapsed **## Transcript** section, then **## Summary** (if an LLM key is set).
- **BYO API keys**:
  - Transcription via **OpenAI Whisper** (or compatible endpoint).
  - Summaries via **OpenAI-compatible Chat Completions** (e.g., OpenAI, Azure OpenAI, local gateways).
- **Note-aware filenames**: inline recordings are saved using the note’s title when available.
- **Also saves a transcript note** (markdown) in your chosen folder.
- **Custom summary prompt** in Settings.

---

## Installation

### From Community Plugins (after it’s approved)
1. In Obsidian: **Settings → Community plugins → Browse**
2. Search for **Whisper Notes**.
3. Install → Enable.

### Manual install (advanced)
1. Download a release from GitHub (assets must include `main.js`, `manifest.json`, `styles.css`).
2. Create the folder:  
   `<YourVault>/.obsidian/plugins/whisper-notes/`
3. Put those files (and `versions.json` if provided) into that folder.
4. In Obsidian: **Settings → Community plugins** → **Reload plugins** → enable **Whisper Notes**.

---

## Usage

### Inline recorder block
Add this code block anywhere in a note:

````md
```whisper-notes
label: Record meeting
