Cardwright 1.3.0 adds source-text concept drafts and standalone Electron desktop downloads.

### Create a concept from source text

- Paste wiki text or character notes in **Concept → Create concept from source text**.
- The existing selected AI provider prepares a factual, editable concept draft. Missing facts are marked as unknown; source text is reference data, not instructions.
- Only **Apply concept draft** replaces the current concept. Card fields, greetings, lorebooks and other metadata stay unchanged.
- Newer manual edits and card replacement are protected from late responses. Source text and unfinished drafts survive local autosave and stay outside JSON/PNG exports.
- This feature accepts pasted text only, up to 24,000 characters. It does not fetch webpages or silently shorten overlong source text.

### Desktop downloads

- macOS Apple Silicon and Intel, Windows x64, and Linux x64, with Electron 45.2.3.
- The same editor and local AI-provider server in a standalone window; no separate Node.js installation is needed for downloads.
- Standard Edit/View/Window menus, remembered normal window size, guarded external links and native export dialogs.
- Automatic daily stable-release notifications with an opt-out and **Help → Check for Updates**. Downloading and installing remain your choice.
- macOS release downloads use Developer ID signing and Apple notarization. Windows downloads are not Authenticode-signed.

### Data and compatibility

- Desktop autosave uses its own local Chromium profile. Browser autosave is not automatically migrated. Transfer cards as JSON/PNG and persona libraries with Export/Import Presets.
- The server stays on loopback and retains its Host/origin and API-key protections. A matching Cardwright server may be reused; an unrelated or older server is rejected and never stopped on desktop Quit.
- Source/browser launch scripts remain available.

Every download is extracted and tested on its target OS before publication, including native JSON export, card-data preservation, source-draft review/apply and persistence after restarting. SHA-256 checksums accompany the downloads. AI tests use a local mock provider.

Extract your platform archive and open **Cardwright.app** (macOS), **Cardwright.exe** (Windows), or **Cardwright** (Linux). Keep Windows/Linux extracted files together. See the [User Guide](https://github.com/cyberdeliaAI/Cardwright/blob/v1.3.0/USER_GUIDE.md) for details.
