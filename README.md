# Ply - Tab Complete Everywhere

Ply is a Chrome extension that provides a smart clipboard history for your browser. It captures everything you copy (Ctrl+C) on any web page and makes it available in a searchable, filterable popup. You can also quickly copy or delete any previous clipboard item.

---

## Features

- **Automatic Clipboard History:** Every time you copy (Ctrl+C) on any page, the text is saved to your clipboard history.
- **Popup UI:** View, search, filter, copy, or delete any clipboard item from the extension popup.
- **Clear History:** One-click to clear all clipboard history.
- **No Offscreen/Background Clipboard Reading:** All clipboard capture is done via content scripts for maximum reliability.
- **No Unnecessary Permissions:** Only the permissions needed for clipboard, storage, and UI are requested.

---

## Installation

1. Clone or download this repository.
2. Go to `chrome://extensions/` in your browser.
3. Enable "Developer mode" (top right).
4. Click "Load unpacked" and select the extension directory.

---

## Usage

- **Copy as usual:** Use Ctrl+C (or Cmd+C) on any web page. The copied text will be added to your clipboard history.
- **Open the popup:** Click the Ghost Tab icon in your browser toolbar to view your clipboard history.
- **Search/filter:** Use the search bar to filter your clipboard items.
- **Copy or delete:** Use the "Copy" or "Delete" buttons next to each item.
- **Clear all:** Use the "Clear" button to remove all clipboard history.

---

## How it Works

- **Content Script (`clipboard-monitor.js`):** Listens for `copy` events on every page and sends the copied text to the background script.
- **Background Script (`background.js`):** Stores clipboard history in Chrome's local storage and responds to popup requests.
- **Popup (`popup.html` + `clipboard.js`):** Displays the clipboard history and provides UI for copying, deleting, and searching items.

---

## Permissions

- `storage`: To save your clipboard history.
- `clipboardRead`/`clipboardWrite`: To allow copying from the popup.
- `activeTab`, `scripting`, `contextMenus`, `tabs`, `downloads`, `commands`: For UI and optional features.

---

## Troubleshooting

- **Nothing appears in the popup:** Make sure you are copying text on a regular web page (not inside the popup). Reload the extension and refresh your tabs.
- **"Unrecognized manifest key 'offscreen'":** Remove the `"offscreen"` block from your `manifest.json`.
- **"Extension context invalidated":** Reload the extension and refresh your tabs. This is a Chrome limitation; see the FAQ in this README.

---

## FAQ

**Q: Why doesn't the extension read my clipboard contents directly?**  
A: For privacy and security, Chrome only allows clipboard reading in focused, visible contexts (like content scripts). This extension captures what you copy, not what is already in your clipboard.

**Q: Why do I see 'Extension context invalidated' errors?**  
A: This happens if the extension is reloaded or updated while a content script is still running. Reload the extension and refresh your tabs.

---

## Development

- All clipboard monitoring is handled by `clipboard-monitor.js` (content script).
- The background script only manages storage and responds to messages.
- The popup UI is in `popup.html` and `clipboard.js`.

---

## License

MIT 
