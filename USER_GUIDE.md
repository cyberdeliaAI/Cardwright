# Cardwright User Guide

Cardwright is a standalone character card editor for Character Card V2 JSON and PNG cards. It is designed for a practical workflow: load or draft a card, edit every field, improve it with AI, manage embedded lorebook entries, audit the result, crop an avatar, and export a finished JSON or PNG card.

Cardwright runs locally in your browser and talks to AI providers through the included local server. It is not a SillyTavern extension and does not require SillyTavern to run.

## 1. What Cardwright Does

Cardwright helps you:

- create a new character card from a concept brief
- load existing `.json` or metadata-bearing `.png` character cards
- edit all major Character Card V2 fields
- edit alternate greetings one at a time
- create and edit embedded lorebook entries
- use AI to rewrite card fields and lorebook entries
- run local and AI audits
- search across card fields and lorebook content
- set and crop an avatar image
- export JSON
- export PNG with embedded `chara` metadata

The tool is built for careful card authoring rather than quick prompt dumping. It keeps card fields, lorebook entries, audits, and AI drafts separated so you can review changes before applying them.

## 2. Requirements

You need:

- Node.js
- a modern browser
- optionally, an AI provider

Supported AI provider presets:

- LM Studio
- oMLX
- Ollama
- OpenAI
- custom OpenAI-compatible `/v1` endpoint

You can still edit cards without AI. AI is only needed for generation, rewrite, improvement, and AI audit features.

## 3. Starting Cardwright

### Windows

Double-click:

```text
start-windows.bat
```

### macOS or Linux

Run:

```bash
./start-macos.sh
```

### Manual start

Run:

```bash
node server.mjs
```

or:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:8787
```

The default port is `8787`. You can override it:

```bash
PORT=8790 node server.mjs
```

## 4. Stopping the Server

Open Settings with the round icon in the top bar, then click:

```text
Stop Server
```

You can also stop the server from the terminal with `Ctrl+C` if you started it manually.

## 5. The Main Layout

Cardwright has four main tabs:

- Concept
- Card
- Lorebook
- Audit

The left sidebar contains:

- Avatar
- card field navigation
- Search/Replace

The top bar contains:

- New Card
- Load Card
- Export JSON
- Export PNG
- Settings

## 6. Creating a New Card

Click:

```text
New Card
```

Cardwright opens a blank card and switches to the Concept tab.

Your work is auto-saved in the browser. If you close and reopen Cardwright, your in-progress card is restored.

## 7. Loading an Existing Card

Click:

```text
Load Card
```

Supported inputs:

- `.json` character card files
- `.png` cards with embedded character metadata

When you load a PNG card, Cardwright also uses the PNG image as the avatar preview.

## 8. Concept Tab

The Concept tab is for drafting a card from an idea.

Write a brief such as:

```text
A weary lighthouse keeper on a haunted coast. Speaks in clipped sentences, keeps secrets, and is drawn to {{user}} despite fearing intimacy.
```

Then click:

```text
Generate card from concept
```

Cardwright asks the selected AI provider to draft usable fields such as:

- Name
- Description
- Personality
- Scenario
- First Message
- Example Dialogue
- Tags

Generated fields appear as drafts. You can apply individual fields or apply all.

The concept is saved with the card and used as context for later AI edits.

## 9. Card Tab

The Card tab is where you edit the main character card fields.

Supported fields include:

- Name
- Description
- Personality
- Scenario
- First Message
- Example Dialogue
- System Prompt
- Creator Notes
- Character Note
- Alternate Greetings
- Tags

Click a field in the left sidebar to open it. If you are currently in another tab, clicking a field automatically jumps back to the Card tab.

### Alternate Greetings

Alternate greetings are handled as separate openings, not as one large text block.

When you select Alternate Greetings, you can:

- move to the previous greeting
- move to the next greeting
- add a greeting
- delete a greeting
- rewrite the selected greeting with AI

AI edits only affect the currently selected greeting.

## 10. AI Field Editing

The AI edit panel in the Card tab applies to the selected field.

Quick actions:

- Rewrite
- Expand
- Condense
- Strengthen Voice

You can also enter a custom instruction, then click:

```text
Run
```

AI edits create a draft. You must review and apply the draft before it changes the card.

This makes destructive edits less likely.

## 11. Lorebook Tab

The Lorebook tab edits the embedded Character Card V2 `character_book`.

You can:

- create a lorebook
- add entries
- delete entries
- edit entry title/comment
- edit primary trigger keywords
- edit secondary keywords
- edit content
- enable or disable entries
- mark entries as constant
- set case sensitivity
- set insertion position
- set insertion order

Cardwright mirrors the lorebook in the card data for broad compatibility.

### Lorebook Entry Fields

Each entry can contain:

- Title / comment
- Trigger keywords
- Secondary keywords
- Content
- Enabled toggle
- Constant toggle
- Case sensitive toggle
- Position
- Insertion order

### Improving Lorebook Entries With AI

Use:

```text
AI instruction
```

to tell the model what to do, for example:

```text
Make this shorter and more factual. Remove scene-like phrasing.
```

Then click:

```text
Improve content with AI
```

The entry content is replaced with the AI result, and the change is auto-saved.

Good lorebook entries should be durable facts, not one-time scenes.

## 12. Audit Tab

The Audit tab contains three audit sections.

### Local Analysis

This runs entirely offline. No AI call is made.

It checks:

- required fields
- token budgets
- placeholder text
- possible `{{user}}` impersonation
- example dialogue formatting
- system prompt phrasing
- lorebook keyword collisions
- empty or disabled lore entries
- constant lore token load

The local audit gives a score out of 100.

Field-level issues can be opened directly, and some can be sent to AI as a reviewable fix draft.

### Full Card AI Audit

This asks the selected AI provider to review the character card for:

- roleplay quality
- consistency
- field balance
- voice strength
- issues by field
- highest-impact fixes

The latest result is kept in browser storage for the current card.

### Lorebook AI Audit

This asks the selected AI provider to review the lorebook separately.

It checks:

- trigger quality
- keyword collisions
- over-broad triggers
- secondary keyword usage
- constant entry risks
- token load
- duplication with card fields
- vague entries
- scene-like entries
- entry-by-entry improvement suggestions

The latest result is kept in browser storage for the current card.

## 13. Search and Replace

Search/Replace is in the lower part of the left sidebar.

It searches:

- all card fields
- alternate greetings
- lorebook entry content

Use:

- Find: search for text
- Next: jump through matches
- Results: open a collapsible list of matches
- Replace Here: replace only in the current field or current lorebook entry

There is no global replace-all in the first version. This is intentional. Character cards often contain placeholders, trigger words, names, and lore references that should not be replaced blindly.

## 14. Avatar and PNG Export

Open Avatar in the sidebar and click:

```text
Set / Crop Image
```

Cardwright opens a cropper with a 2:3 portrait ratio.

After setting an avatar, you can export:

```text
Export PNG
```

The exported PNG includes the card JSON embedded in a `chara` tEXt chunk. It can be re-imported into Cardwright and compatible tools such as SillyTavern.

## 15. Exporting JSON

Click:

```text
Export JSON
```

This exports the current card data, including embedded lorebook entries.

## 16. AI Provider Setup

Open Settings with the round icon in the top bar.

Choose a provider:

- LM Studio
- oMLX
- Ollama
- OpenAI
- Custom OpenAI-compatible

Then configure:

- base URL
- model
- API key, if required

Use:

```text
Detect Model
```

to ask the provider for available models.

Use:

```text
Test
```

to check whether Cardwright can reach the provider.

Connection results appear inside the Settings drawer.

### LM Studio

Default base URL:

```text
http://127.0.0.1:1234/v1
```

Steps:

1. Open LM Studio.
2. Load a chat or instruct model.
3. Start the Local Server.
4. In Cardwright Settings, choose LM Studio.
5. Click Detect Model.

The API key can usually stay blank.

### oMLX

Default base URL:

```text
http://127.0.0.1:8000/v1
```

If your oMLX server requires an API key, paste it into Settings.

### Ollama

Default base URL:

```text
http://127.0.0.1:11434/v1
```

Use an OpenAI-compatible Ollama endpoint.

### OpenAI

Default base URL:

```text
https://api.openai.com/v1
```

An API key is required.

### Custom Provider

Use this for any chat-completions-compatible server that follows this shape:

```text
/v1/chat/completions
```

## 17. Environment Variables

You can set defaults before starting the server:

```bash
OPENAI_PROVIDER=lmstudio
OPENAI_BASE_URL=http://127.0.0.1:1234/v1
OPENAI_MODEL=local-model
OPENAI_API_KEY=sk-...
PORT=8787
node server.mjs
```

If an API key is entered in the Settings panel, it is sent through the local server for requests. If the field is blank, the server can use `OPENAI_API_KEY`.

## 18. Autosave

Cardwright saves the current card in browser storage.

Saved data includes:

- card content
- selected field
- current view
- lorebook selection
- avatar data when possible
- settings
- latest card AI audit
- latest lorebook AI audit

Large avatar images may exceed browser storage. In that case, the card can still be saved while the avatar may not persist.

## 19. Safety Tips

- Review AI drafts before applying them.
- Use Replace Here instead of global replacement.
- Keep System Prompt short and behavioral.
- Keep Lorebook entries factual and reusable.
- Avoid making many entries constant.
- Use secondary keys for broad trigger words.
- Export often when doing major edits.

## 20. Troubleshooting

### The AI provider does not respond

Check:

- the provider server is running
- the base URL is correct
- the model is loaded
- the API key is present if required
- Detect Model or Test works in Settings

### LM Studio returns no model

Check:

- a model is loaded
- the LM Studio Local Server is started
- the base URL is `http://127.0.0.1:1234/v1`

### Export PNG is disabled

Set an avatar image first.

### A loaded PNG has no card data

The PNG may not contain embedded character-card metadata.

### Search finds results but the list is not visible

Use Next to jump through matches, or open the Results disclosure in the Search/Replace panel.

## 21. Recommended Workflow

1. Start with New Card.
2. Write a Concept.
3. Generate card fields.
4. Apply useful drafts.
5. Edit fields manually.
6. Add alternate greetings.
7. Add lorebook entries only for durable facts.
8. Run Local Audit.
9. Fix field-level issues.
10. Run Full Card AI Audit.
11. Run Lorebook AI Audit.
12. Crop avatar.
13. Export JSON and PNG.

## 22. File Compatibility

Cardwright focuses on Character Card V2 style data.

It supports:

- JSON card import
- PNG card import when metadata is embedded
- JSON export
- PNG export with embedded card metadata
- embedded lorebook / character book data

Cardwright is intended to work alongside tools like SillyTavern, not replace a chat frontend.

