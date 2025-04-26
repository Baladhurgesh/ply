// --- Debug Flag ---
const DEBUG_MODE = true; // Set to true to enable background script logging

// --- Helper Debug Logging Functions ---
function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log("BACKGROUND LOG:", ...args);
    }
}
function debugWarn(...args) {
    if (DEBUG_MODE) {
        console.warn("BACKGROUND WARN:", ...args);
    }
}
function debugError(...args) {
    if (DEBUG_MODE) {
        console.error("BACKGROUND ERROR:", ...args);
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
let isInitialized = false;
let initializationPromise = null;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 3;

// --- Import LLM function ---
// NOTE: Static imports work in service workers. Ensure llm.js is in the root.
// If llm.js is elsewhere, adjust the path.
try {
  importScripts('llm.js'); // Import the script containing getRelevantClipboardItems
} catch (e) {
  console.error("BACKGROUND FATAL: Failed to import llm.js", e); // Keep this as console.error
}

// --- Offscreen Document Management ---
let offscreenDocument = null;

async function createOffscreenDocument() {
    debugLog("Creating offscreen document...");
    try {
        // Check if offscreen document already exists
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        
        if (existingContexts.length > 0) {
            debugLog("Offscreen document already exists");
            return true;
        }
        
        // Create new offscreen document
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['CLIPBOARD'],
            justification: 'Read clipboard content'
        });
        
        debugLog("Offscreen document created successfully");
        return true;
    } catch (error) {
        debugError("Error creating offscreen document:", error);
        return false;
    }
}

// --- Permission Management ---
async function requestPermissions() {
    debugLog("Requesting permissions...");
    try {
        const permissions = {
            permissions: ['clipboardRead'],
            origins: ['<all_urls>']
        };
        
        const granted = await chrome.permissions.request(permissions);
        debugLog("Permission request result:", granted);
        return granted;
    } catch (error) {
        debugError("Error requesting permissions:", error);
        return false;
    }
}

// --- Clipboard History Management ---
let clipboardHistory = [];

async function initializeStorage() {
    debugLog("Initializing storage...");
    try {
        const result = await chrome.storage.local.get('clipboardHistory');
        clipboardHistory = result.clipboardHistory || [];
        debugLog("Storage initialized with", clipboardHistory.length, "items");
        return true;
    } catch (error) {
        debugError("Error initializing storage:", error);
        return false;
    }
}

// --- Initialization ---
async function initializeExtension() {
    debugLog("Initializing extension...");
    
    // Request permissions first
    const permissionsGranted = await requestPermissions();
    if (!permissionsGranted) {
        debugError("Required permissions not granted");
        return false;
    }
    
    // Create offscreen document
    const offscreenCreated = await createOffscreenDocument();
    if (!offscreenCreated) {
        debugError("Failed to create offscreen document");
        return false;
    }
    
    // Initialize storage
    const storageInitialized = await initializeStorage();
    if (!storageInitialized) {
        debugError("Failed to initialize storage");
        return false;
    }
    
    debugLog("Extension initialized successfully");
    return true;
}

// --- Event Listeners ---
chrome.runtime.onInstalled.addListener(() => {
    debugLog("Extension installed");
    initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
    debugLog("Extension started");
    initializeExtension();
});

// --- Context Menu ---
async function setupContextMenu() {
    try {
        await chrome.contextMenus.removeAll();
        await chrome.contextMenus.create({
            id: 'open-clipboard',
            title: 'Open Clipboard History',
            contexts: ['all']
        });
        debugLog("Context menu created successfully.");
    } catch (error) {
        debugError("Failed to create context menu:", error);
        throw error;
    }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'open-clipboard') {
        chrome.tabs.create({ url: 'clipboard.html' });
    }
});

// --- Clipboard Monitoring ---
async function startClipboardMonitoring() {
    try {
        // Check permissions
        const hasPermission = await chrome.permissions.contains({ permissions: ['clipboardRead', 'offscreen'] });
        if (!hasPermission) {
            debugError('Missing required permissions: clipboardRead, offscreen');
            throw new Error('Missing required permissions');
        }

        // Setup offscreen document
        await setupOffscreenDocument();
        
        // Start periodic clipboard checking
        checkClipboardPeriodically();
        debugLog('Clipboard monitoring started successfully.');
    } catch (error) {
        debugError('Failed to start clipboard monitoring:', error);
        throw error;
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
    try {
        if (await hasOffscreenDocument()) {
            debugLog("Offscreen document already exists.");
            return;
        }

        if (creatingOffscreenDocument) {
            debugLog("Offscreen document creation already in progress. Waiting...");
            await creatingOffscreenDocument;
            return;
        }

        debugLog("Creating offscreen document...");
        creatingOffscreenDocument = chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: [chrome.offscreen.Reason.CLIPBOARD],
            justification: 'Reading clipboard text requires DOM access.',
        });

        await creatingOffscreenDocument;
        debugLog("Offscreen document created successfully.");
    } catch (error) {
        debugError("Failed to create offscreen document:", error);
        throw error;
    } finally {
        creatingOffscreenDocument = null;
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
    debugLog("Received message:", message);
    
    if (message.action === 'getClipboardHistory') {
        debugLog("Getting clipboard history...");
        sendResponse({ success: true, history: clipboardHistory });
        return false;
    }
    
    if (message.action === 'addToClipboardHistory') {
        debugLog("Adding to clipboard history...");
        const newItem = {
            text: message.text,
            timestamp: Date.now()
        };
        clipboardHistory.unshift(newItem);
        chrome.storage.local.set({ clipboardHistory });
        sendResponse({ success: true });
        return false;
    }
    
    if (message.action === 'clearClipboardHistory') {
        debugLog("Clearing clipboard history...");
        clipboardHistory = [];
        chrome.storage.local.set({ clipboardHistory });
        sendResponse({ success: true });
        return false;
    }
    
    return false;
});

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

async function deleteClipboardItem(id, sendResponse) {
    try {
        const result = await chrome.storage.local.get('clipboardHistory');
        const history = result.clipboardHistory || [];
        const updatedHistory = history.filter(item => item.id !== id);
        await chrome.storage.local.set({ clipboardHistory: updatedHistory });
        debugLog(`Background: Deleted clipboard item with ID ${id}`);
        sendResponse({ success: true });
    } catch (error) {
        debugError("Background: Error deleting clipboard item:", error);
        sendResponse({ success: false, error: error.message });
    }
}

async function clearClipboardHistory(sendResponse) {
    try {
        await chrome.storage.local.set({ clipboardHistory: [] });
        debugLog("Background: Cleared clipboard history");
        sendResponse({ success: true });
    } catch (error) {
        debugError("Background: Error clearing clipboard history:", error);
        sendResponse({ success: false, error: error.message });
    }
} 