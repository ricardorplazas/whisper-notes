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
````

- Click **Start** to begin recording (grant mic access on first use).
- Click **Pause/Resume** as needed.
- Click **Stop** to finish:
  - The audio file is saved to your **Audio folder** and **embedded above** the transcript.
  - If transcription is enabled, a **## Transcript** section is inserted below the embed.
  - If a Chat API key is set and “Insert summary after transcript” is on, a **## Summary** section is added under the transcript.
- Tip: Use **⏱ Insert timestamp** to drop a live timestamp where your cursor is.

### Command palette (optional)
- **Whisper Notes: Open recorder** – opens a modal recorder (same pipeline).
- **Whisper Notes: Insert recorder block** – inserts the inline code block at the cursor.

---

## Settings

- **Audio folder** (default: `Recordings`) – where audio files are saved.
- **Transcript folder** (default: `Recordings`) – where transcript notes are saved.
- **Insert transcript into current note** – also insert transcript (and summary) under a heading at the cursor.
- **Transcript heading** – heading used when inserting into the current note (default: `## Transcript`).
- **Auto-transcribe after recording** – run Whisper automatically.
- **Open transcript after transcribe** – open the created transcript note.

**Transcription (Whisper)**
- **OpenAI Base URL** (default: `https://api.openai.com/v1`)
- **OpenAI API Key** – required for transcription.
- **Whisper model** (default: `whisper-1`)
- **Language hint** (optional)

**LLM (summary)**
- **OpenAI-compatible Base URL** (default: `https://api.openai.com/v1`)
- **API Key** – required for summary.
- **Chat model** (default: `gpt-4o-mini`)
- **Custom summary prompt** – override the default summary instructions.
- **Insert summary after transcript** (on by default).
- **Summary heading** (default: `## Summary`)

---

## Privacy & Security

- Your **API keys are stored locally** in your vault’s plugin data (`.obsidian/plugins/whisper-notes/`).
- Audio files and transcripts are saved **locally** in your vault.
- When enabled, audio is sent **only** to the transcription endpoint you configure; summaries are sent **only** to your chat endpoint.
- This plugin does **not** use any third-party analytics or call any server other than the endpoints you set.

---

## Compatibility

- Works on desktop and mobile.  
- Uses the browser’s / OS’s media capture; some platforms may require explicit mic permission.
- Falls back to **WAV** if `MediaRecorder` WebM/Opus isn’t supported.

---

## Troubleshooting

- **“Failed to load” on enable**: ensure the plugin folder contains exactly `manifest.json`, `main.js`, `styles.css` (and `versions.json` if present). Restart Obsidian.
- **Buttons don’t respond**: check **View → Toggle Developer Tools → Console** for errors; report issues with your OS + Obsidian version.
- **No audio captured**: check mic permissions in your OS/browser. Try restarting Obsidian after granting permission.
- **No transcript/summary**: confirm your API keys, base URLs, and that “Auto-transcribe” / “Insert summary after transcript” are enabled.

---

## Changelog

See **Releases** on GitHub for detailed notes.

- **1.2.3** – Fix “failed to load” syntax issue; ensure insertion order (Audio → Transcript → Summary); sturdier pause/resume/stop.
- **1.2.2** – Add summary insertion after transcript with custom prompt.
- **1.2.1** – Fix inline state handling; reliable pause/resume/stop.
- **1.2.0** – Initial public build (inline recorder, Whisper transcription).

---

## License

MIT © Ricardo Rodriguez
