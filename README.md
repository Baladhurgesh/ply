# Clipboard Viewer Chrome Extension

A simple Chrome extension that allows you to view the current content of your clipboard in a popup window.

## Features

- View clipboard content in a popup window
- Refresh button to update clipboard content
- Simple and clean interface

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked" and select the directory containing these files
4. The extension should now be installed and visible in your Chrome toolbar

## Usage

1. Click on the extension icon in your Chrome toolbar
2. The popup will show your current clipboard content
3. Click the "Refresh Clipboard" button to update the content

## Permissions

This extension requires the `clipboardRead` permission to access your clipboard content.

## Development

The extension consists of the following files:
- `manifest.json`: Extension configuration
- `popup.html`: Popup interface
- `popup.js`: Clipboard reading functionality
- `images/`: Directory containing extension icons 