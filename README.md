# GhostTab - AI-Powered Clipboard Manager

GhostTab is a Chrome extension that enhances your clipboard management with AI-powered suggestions and smart organization. It uses Claude 3 Haiku to provide context-aware clipboard suggestions and text generation capabilities.

## Features

- **Smart Clipboard History**: Automatically captures and stores your clipboard content
- **AI-Powered Suggestions**: Uses Claude 3 Haiku to suggest relevant clipboard items based on context
- **Text Generation**: Generate new text completions based on your current context
- **Search & Filter**: Easily find specific items in your clipboard history
- **Log Management**: Download and clear LLM interaction logs
- **Secure Storage**: API keys and sensitive data are stored securely in Chrome's sync storage

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

## Configuration

1. Click the extension icon and select "Options"
2. Enter your Claude API key
3. Configure the backend URL (default: http://localhost:5000/receive_context)
4. Save your settings

## Usage

- **View Clipboard History**: Click the extension icon to see your recent clipboard items
- **Search Items**: Use the search box to filter clipboard items
- **Clear History**: Click the "Clear History" button to remove all items
- **Download Logs**: Access the options page to download or clear LLM interaction logs

## Development

### Project Structure

- `popup.html` - Main extension popup interface
- `popup.js` - Popup functionality and UI interactions
- `background.js` - Background service worker for clipboard monitoring
- `llm.js` - LLM integration and text processing
- `options.js` - Extension options and settings management
- `styles.css` - Extension styling

### Building

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the extension:
   ```bash
   npm run build
   ```

## Security

- API keys are stored securely in Chrome's sync storage
- Clipboard data is processed locally before being sent to the LLM
- All network requests are made over HTTPS

## License

MIT License - See LICENSE file for details 