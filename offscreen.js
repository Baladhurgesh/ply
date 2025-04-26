// offscreen.js

// --- Debug Flag ---
const DEBUG_MODE = true; // Set to true to enable offscreen script logging

// --- Helper Debug Logging Functions ---
function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log("OFFSCREEN LOG:", ...args);
    }
}
function debugWarn(...args) {
    if (DEBUG_MODE) {
        console.warn("OFFSCREEN WARN:", ...args);
    }
}
function debugError(...args) {
    if (DEBUG_MODE) {
        console.error("OFFSCREEN ERROR:", ...args);
    }
}

// --- Clipboard Textarea ---
const clipboardTextarea = document.createElement('textarea');
clipboardTextarea.style.position = 'absolute';
clipboardTextarea.style.left = '-999px';
clipboardTextarea.style.top = '-999px';
document.body.appendChild(clipboardTextarea);

// --- Message Handling ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    debugLog("Received message:", message);
    
    if (message.type === 'read-clipboard') {
        debugLog("Reading clipboard...");
        readClipboard()
            .then(text => {
                debugLog("Clipboard read successfully");
                sendResponse({ success: true, text });
            })
            .catch(error => {
                debugError("Error reading clipboard:", error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep the message channel open for async response
    }
    
    return false;
});

// --- Clipboard Reading ---
async function readClipboard() {
    try {
        // Focus the textarea
        clipboardTextarea.focus();
        
        // Try to read clipboard
        const text = await navigator.clipboard.readText();
        debugLog("Clipboard content:", text);
        return text;
    } catch (error) {
        debugError("Error reading clipboard:", error);
        throw error;
    }
}

// --- Initialization ---
debugLog("Offscreen document initialized");

console.log("Offscreen script loaded."); // Log to confirm loading 