// background.js

// --- Debug Flag ---
const DEBUG_MODE = false; // Set to true to enable background script logging

// --- Helper Debug Logging Functions ---
function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log("BG LOG:", ...args);
    }
}
function debugWarn(...args) {
    if (DEBUG_MODE) {
        console.warn("BG WARN:", ...args);
    }
}
function debugError(...args) {
    if (DEBUG_MODE) {
        console.error("BG ERROR:", ...args);
    }
}

// --- Constants ---
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const MAX_LOG_ENTRIES = 200; // Limit the number of log entries to store
const MAX_ACCEPTED_LOG_ENTRIES = 500; // Limit for accepted suggestion logs
const DEFAULT_CLIPBOARD_ITEMS = [
    { text: "www.linkedin.com/in/barathsa", timestamp: new Date(0).toISOString() }, // Using epoch time as timestamp
    { text: "4123785562", timestamp: new Date(0).toISOString() },
    { text: "First name: Barathwaj", timestamp: new Date(0).toISOString() },
    { text: "Last name: Anandan", timestamp: new Date(0).toISOString() },
    { text: "anandanbarath7@gmail.com", timestamp: new Date(0).toISOString() },
    { text: "www.github.com/barathwajanandan", timestamp: new Date(0).toISOString() },
    { text: "Location : Milpitas, CA", timestamp: new Date(0).toISOString() }
];

// --- Globals ---
let lastClipboardContent = '';
let creatingOffscreenDocument = null; // Promise to prevent race condition
let activeApiCall = false; // Flag to prevent concurrent API calls from same tab
let apiCallQueue = {}; // Queue requests per tab: { tabId: [ { message, sender, sendResponse }, ... ] }

// --- Import LLM function ---
// NOTE: Static imports work in service workers. Ensure llm.js is in the root.
// If llm.js is elsewhere, adjust the path.
try {
  importScripts('llm.js'); // Import the script containing getRelevantClipboardItems
} catch (e) {
  console.error("BACKGROUND FATAL: Failed to import llm.js", e); // Keep this as console.error
}


// --- Initialization ---
chrome.runtime.onInstalled.addListener(async () => {
    debugLog('GhostTab onInstalled/onUpdated event fired.');

    // --- Initialize Clipboard History ONLY IF IT DOESN'T EXIST ---
    const currentStorage = await chrome.storage.local.get('clipboardHistory');
    if (!currentStorage.clipboardHistory) {
        // The key doesn't exist, so initialize it with defaults
        await chrome.storage.local.set({ clipboardHistory: [...DEFAULT_CLIPBOARD_ITEMS] });
        debugLog('Clipboard history initialized with defaults.');
    } else {
        // The key already exists, do nothing to preserve existing history
        debugLog('Clipboard history already exists, skipping default initialization.');
    }
    // --- End Clipboard History Initialization ---

    // Initialize other storage keys (these are likely safe to reset/ensure they exist)
    await chrome.storage.sync.set({ claudeApiKey: '' }); // Initialize API key storage
    await chrome.storage.local.set({ llmLogs: [] }); // Initialize logs storage
    await chrome.storage.local.set({ acceptedSuggestionsLog: [] }); // <-- Initialize accepted logs storage
    debugLog('Other storage keys initialized/ensured.');
    
    await setupContextMenu();
    await startClipboardMonitoring(); // Ensure monitoring starts on install/update
});

// Ensure context menu is set up on browser startup as well
chrome.runtime.onStartup.addListener(async () => {
    debugLog('GhostTab starting up...');
    await setupContextMenu();
    await startClipboardMonitoring(); // Restart monitoring on startup
});


// --- Context Menu ---
async function setupContextMenu() {
    await chrome.contextMenus.removeAll();
    await chrome.contextMenus.create({
        id: 'open-clipboard',
        title: 'Open Clipboard History',
        contexts: ['all']
    });
    debugLog("Context menu created.");
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'open-clipboard') {
        chrome.tabs.create({ url: 'clipboard.html' });
    }
});

// --- Clipboard Monitoring ---
async function startClipboardMonitoring() {
    // Check permissions (optional, but good practice)
    const hasPermission = await chrome.permissions.contains({ permissions: ['clipboardRead', 'offscreen'] });
    if (hasPermission) {
        checkClipboardPeriodically();
        debugLog('Clipboard monitoring started/resumed.');
    } else {
        // Keep permission warnings visible
        console.warn('Clipboard monitoring requires clipboardRead and offscreen permissions.');
    }
}

function checkClipboardPeriodically() {
    // Clear any existing interval first to avoid duplicates
    if (self.clipboardCheckInterval) {
        clearInterval(self.clipboardCheckInterval);
    }
    // Check every 2 seconds (adjust interval as needed)
    self.clipboardCheckInterval = setInterval(checkClipboard, 2000);
    debugLog(`Clipboard check interval set (${2000}ms).`);
}

// --- Offscreen Document Management ---
async function hasOffscreenDocument() {
    // Check if any clients are pointing to the offscreen document page.
    const matchedClients = await clients.matchAll();
    for (const client of matchedClients) {
        if (client.url.endsWith(OFFSCREEN_DOCUMENT_PATH)) {
            return true;
        }
    }
    return false;
}

async function setupOffscreenDocument() {
    // Check if the document already exists.
    if (await hasOffscreenDocument()) {
        debugLog("Offscreen document already exists.");
        return;
    }

    // Avoid race conditions where multiple calls try to create the document simultaneously.
    if (creatingOffscreenDocument) {
        debugLog("Offscreen document creation already in progress. Waiting...");
        await creatingOffscreenDocument;
    } else {
        debugLog("Creating offscreen document...");
        creatingOffscreenDocument = chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: [chrome.offscreen.Reason.CLIPBOARD],
            justification: 'Reading clipboard text requires DOM access.',
        });
        try {
            await creatingOffscreenDocument;
            debugLog("Offscreen document created successfully.");
        } catch (error) {
            // Keep errors visible
            console.error("Error creating offscreen document:", error);
        } finally {
            creatingOffscreenDocument = null;
        }
    }
}

// Function to read clipboard using the offscreen document
async function readClipboardViaOffscreen() {
    await setupOffscreenDocument(); // Ensure the document exists

    debugLog("Background: Sending message to offscreen document to read clipboard...");
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'read-clipboard',
            target: 'offscreen',
        });
        debugLog("Background: Received response from offscreen:", response);
        if (response && response.success) {
            return response.text;
        } else {
             throw new Error(response?.error || 'Failed to read clipboard via offscreen document.');
        }
    } catch (error) {
         // Handle potential errors like the offscreen document not being ready
         if (error.message.includes("Could not establish connection")) {
             // Keep warnings visible
             console.warn("Background: Connection to offscreen document failed. It might be closing or not ready. Retrying setup might be needed.");
             // Optionally, implement retry logic or clearer error handling here
         } else {
            // Keep errors visible
            console.error("Background: Error messaging offscreen document:", error);
         }
         return null; // Indicate failure
    }
}


// --- Core Clipboard Check Logic ---
async function checkClipboard(callback) {
    debugLog("Background: checkClipboard called");
    try {
        const clipText = await readClipboardViaOffscreen();

        if (clipText !== null) { // Check if read was successful
             debugLog(`Background: Clipboard content received: "${clipText ? clipText.substring(0, 30) + '...' : '<empty>'}"`);
            // Only process if the clipboard content has changed
            if (clipText && clipText !== lastClipboardContent) {
                debugLog("Background: Clipboard content changed. Updating history.");
                lastClipboardContent = clipText;
                addToClipboardHistory(clipText);
            } else if (clipText === lastClipboardContent) {
                 debugLog("Background: Clipboard content unchanged.");
            } else {
                 debugLog("Background: Clipboard content is empty.");
            }
        } else {
            // Keep warning visible
            console.warn("Background: Failed to read clipboard content via offscreen.");
        }

    } catch (e) {
        // Keep errors visible
        console.error('Background: Failed to check clipboard:', e);
    } finally {
        // Execute callback if provided, regardless of success/failure
        if (typeof callback === 'function') {
            debugLog("Background: Executing checkClipboard callback.");
            callback();
        }
    }
}


// --- Message Handling ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    debugLog("BACKGROUND: Received message:", message, "from sender:", sender);
    // --- LLM Suggestion/Generation Request --- 
    if (message.action === 'getLLMSuggestions') {
        const requestingTabId = sender?.tab?.id;
        if (!requestingTabId) {
            console.warn("Background: getLLMSuggestions request missing tab ID.");
            sendResponse({ success: false, error: "Missing sender tab ID", suggestions: [] });
            return false; // Should not be async if returning error immediately
        }
        debugLog(`Background: Received getLLMSuggestions request from tab: ${requestingTabId}. IsGeneration: ${message.isGenerationRequest}`);
        handleLLMSuggestionRequest(message, sender, sendResponse); // Pass the whole message object
        return true; // Indicate async response
    }
    // --- Other Actions (addToClipboard, getClipboardHistory, etc.) ---
    else if (message.action === 'addToClipboard') {
        debugLog("Background: Received addToClipboard message (likely from content script copy event)");
        addToClipboardHistory(message.text);
        sendResponse({ success: true });
        lastClipboardContent = message.text; // Update last known content
        return false;
    } else if (message.action === 'getClipboardHistory') {
        getClipboardHistory(sendResponse);
        return true; // Return true for async response
    } else if (message.action === 'clearClipboardHistory') {
        clearClipboardHistory(sendResponse);
        return true; // Return true for async response
    } else if (message.action === 'checkClipboard') {
        debugLog("Background: Received checkClipboard message (likely from popup)");
        checkClipboard(() => {
            sendResponse({ success: true });
        });
        return true; // Return true for async response
    // --- Log Handling Messages --- 
    } else if (message.action === 'getLLMLogs') {
        getLLMLogs(sendResponse);
        return true; // Async
    } else if (message.action === 'clearLLMLogs') {
        clearLLMLogs(sendResponse);
        return true; // Async
    // --- Accepted Suggestion Logging --- 
    } else if (message.action === 'logAcceptedSuggestion') {
        debugLog("Background: Received logAcceptedSuggestion message");
        addAcceptedLogEntry(message.data);
        // No need to send a response unless required for confirmation
        // sendResponse({ success: true }); 
        return false; // Synchronous handling is fine here
    }
    // --- End Message Handling Blocks ---
    debugWarn(`Background: Unhandled message action: ${message.action}`);
    return false; // Indicate synchronous handling if action not matched
});

// --- Command Handling ---
chrome.commands.onCommand.addListener(async (command) => {
    debugLog(`Background: Command received: ${command}`);
    // Find the active tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!activeTab || !activeTab.id) {
        // Keep warning visible
        console.warn("Background: Could not find active tab to send command to.");
        return;
    }

    let messageAction = null;
    if (command === 'trigger-llm-suggestion') {
        messageAction = 'requestContextForManualTrigger';
    } else if (command === 'fill-suggestion-word') {
        messageAction = 'fillWordByWord';
    } else if (command === 'commit-suggestion-alias') {
        messageAction = 'commitSuggestionAlias';
    }

    if (messageAction) {
        debugLog(`Background: Sending ${messageAction} to tab ${activeTab.id}`);
        try {
            // Send the appropriate message to the content script in the active tab
            await chrome.tabs.sendMessage(activeTab.id, { action: messageAction });
        } catch (error) {
            // Keep errors visible
            console.error(`Background: Error sending message to tab ${activeTab.id}:`, error);
            // Handle potential errors, e.g., content script not injected or tab closed
        }
    } else {
         debugWarn(`Background: Unknown command received: ${command}`);
    }
});

/**
 * Handles the request for LLM suggestions/generation.
 * Fetches history, API key, calls LLM, and sends response.
 * Relies on flags in the message object to determine mode.
 */
async function handleLLMSuggestionRequest(message, sender, sendResponse) { // Added message parameter
    const requestingTabId = sender?.tab?.id;
    // Note: Tab ID checked in listener now

    // Function to send hide message (keep as is)
    const sendHideMessage = async () => {
        debugLog(`Background: Sending hideProcessing to tab ${requestingTabId}`);
        try {
            await chrome.tabs.sendMessage(requestingTabId, { action: 'hideProcessing' });
        } catch (error) { console.error(`Background: Error sending hideProcessing:`, error); }
    };

    // --- Extract data from message --- 
    const contextData = message.contextData;
    const isGenerationRequest = message.isGenerationRequest || false; // Default to suggestion
    const instruction = message.instruction || null;
    const actionType = isGenerationRequest ? "Generation" : "Suggestion";
    // --- End Extract ---

    // Initial checks
    if (!contextData) {
        debugWarn(`LLM Handler (${actionType}): Received null context data.`);
        // Don't call sendHideMessage here, content script handles indicator on response
        sendResponse({ success: false, error: "Missing context data", suggestions: [] });
        return;
    }
    if (typeof getRelevantClipboardItems !== 'function') {
        console.error(`LLM Handler (${actionType}): Required LLM functions not found. Import failed?`);
        // Don't call sendHideMessage here
        sendResponse({ success: false, error: "LLM functions not available", suggestions: [] });
        return;
    }

    // Get API Key (keep as is)
    let apiKey = ""; // TODO: Retrieve securely
    
    try {
        // 1. Get Clipboard History (only needed for suggestions)
        let clipboardHistory = [];
        if (!isGenerationRequest) {
            // Check if contextData has history override (e.g., for testing) 
            // If not, fetch from storage
            if (contextData.overrideHistory) { // Example override flag
                 clipboardHistory = contextData.overrideHistory;
                 debugLog("LLM Handler: Using override history from contextData");
            } else {
                const historyData = await chrome.storage.local.get('clipboardHistory');
                clipboardHistory = historyData.clipboardHistory || [];
                debugLog(`LLM Handler: Fetched ${clipboardHistory.length} items from storage for suggestion.`);
            }
        }

        // 2. Call Main LLM - Pass mode and instruction explicitly
        debugLog(`LLM Handler: Calling getRelevantClipboardItems for ${actionType}...`);
        const suggestions = await getRelevantClipboardItems(
            contextData, 
            clipboardHistory, // Pass history (empty for generation)
            apiKey,
            isGenerationRequest, // Pass explicit flag
            instruction          // Pass explicit instruction (null for suggestion)
        );
        debugLog(`LLM Handler: Received final ${actionType} response:`, suggestions);

        // 3. Send Response 
        // Don't call sendHideMessage here, content script hides on receiving response
        sendResponse({ success: true, suggestions: suggestions });

    } catch (error) {
        console.error(`LLM Handler: Error during ${actionType} flow:`, error);
        // Don't call sendHideMessage here
        sendResponse({ success: false, error: error.message, suggestions: [] });
    }
}


// --- Clipboard History Storage ---
function addToClipboardHistory(text) {
    if (!text || text.trim() === '') {
         debugLog("Background: Skipping adding empty text to history.");
         return; // Don't add empty text
    }

    chrome.storage.local.get('clipboardHistory', function(data) {
        let history = data.clipboardHistory || [];

        // Prevent exact duplicates
        const isDuplicate = history.some(item => item.text === text);
        if (isDuplicate) {
             debugLog("Background: Skipping duplicate text entry.");
             return;
        }

        // Add new entry at the beginning
        history.unshift({
            text: text,
            timestamp: new Date().toISOString()
        });

        // Limit history to 50 items
        if (history.length > 50) {
            history = history.slice(0, 50);
        }

        chrome.storage.local.set({ clipboardHistory: history }, () => {
             debugLog(`Background: Added item to history. New length: ${history.length}`);
        });
    });
}

function getClipboardHistory(sendResponse) {
    chrome.storage.local.get('clipboardHistory', function(data) {
        sendResponse({ history: data.clipboardHistory || [] });
    });
}

function clearClipboardHistory(sendResponse) {
    chrome.storage.local.set({ clipboardHistory: [] }, function() {
        lastClipboardContent = ''; // Reset last known content
        debugLog("Background: Clipboard history cleared.");
        sendResponse({ success: true });
    });
}

// --- LLM Logging Functions ---
async function addLogEntry(logEntry) {
    try {
        const data = await chrome.storage.local.get('llmLogs');
        let logs = data.llmLogs || [];
        logs.unshift(logEntry); // Add new log to the beginning
        // Trim logs if they exceed the max length
        if (logs.length > MAX_LOG_ENTRIES) {
            logs = logs.slice(0, MAX_LOG_ENTRIES);
        }
        await chrome.storage.local.set({ llmLogs: logs });
        // console.log("LLM Log entry added.");
    } catch (error) {
        console.error("Error adding LLM log entry:", error);
    }
}

async function getLLMLogs(sendResponse) {
    try {
        const data = await chrome.storage.local.get('llmLogs');
        sendResponse({ success: true, logs: data.llmLogs || [] });
    } catch (error) {
        console.error("Error retrieving LLM logs:", error);
        sendResponse({ success: false, error: error.message, logs: [] });
    }
}

async function clearLLMLogs(sendResponse) {
    try {
        await chrome.storage.local.set({ llmLogs: [] });
        debugLog("LLM Logs cleared.");
        sendResponse({ success: true });
    } catch (error) {
        console.error("Error clearing LLM logs:", error);
        sendResponse({ success: false, error: error.message });
    }
}

// --- New Function: Add Accepted Suggestion Log Entry --- 
async function addAcceptedLogEntry(logEntry) {
    if (!logEntry) return;
    try {
        const data = await chrome.storage.local.get('acceptedSuggestionsLog');
        let logs = data.acceptedSuggestionsLog || [];
        logs.unshift(logEntry); // Add new log to the beginning
        // Trim logs if they exceed the max length
        if (logs.length > MAX_ACCEPTED_LOG_ENTRIES) {
            logs = logs.slice(0, MAX_ACCEPTED_LOG_ENTRIES);
        }
        await chrome.storage.local.set({ acceptedSuggestionsLog: logs });
        debugLog(`Accepted suggestion log entry added. New length: ${logs.length}`);
    } catch (error) {
        console.error("Error adding accepted suggestion log entry:", error);
    }
}

// Optional: Close offscreen document after a period of inactivity
// let inactivityTimeout = null;
// const INACTIVITY_DELAY_MS = 30000; // 30 seconds

// function resetInactivityTimeout() {
//   if (inactivityTimeout) {
//     clearTimeout(inactivityTimeout);
//   }
//   inactivityTimeout = setTimeout(async () => {
//     if (await hasOffscreenDocument()) {
//        console.log("Closing offscreen document due to inactivity.");
//        chrome.offscreen.closeDocument();
//     }
//     inactivityTimeout = null;
//   }, INACTIVITY_DELAY_MS);
// }
// // Call resetInactivityTimeout() whenever the offscreen document is used. 