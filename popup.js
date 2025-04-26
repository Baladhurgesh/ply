// --- Debug Flag ---
const DEBUG_MODE = true; // Set to true to enable popup script logging

// --- Helper Debug Logging Functions ---
function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log("POPUP LOG:", ...args);
    }
}
function debugWarn(...args) {
    if (DEBUG_MODE) {
        console.warn("POPUP WARN:", ...args);
    }
}
function debugError(...args) {
    if (DEBUG_MODE) {
        console.error("POPUP ERROR:", ...args);
    }
}

// --- DOM Elements ---
const clipboardItems = document.getElementById('clipboardItems');
const refreshButton = document.getElementById('refreshButton');
const clearHistoryButton = document.getElementById('clearHistoryButton');
const filterInput = document.getElementById('filterInput');
const notification = document.getElementById('notification');

// --- Helper Functions ---
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString();
}

function showNotification(message, type = 'success') {
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

function createClipboardItemElement(item) {
    const div = document.createElement('div');
    div.className = 'clipboard-item';
    
    const text = document.createElement('div');
    text.className = 'item-text';
    text.textContent = item.text;
    
    const timestamp = document.createElement('div');
    timestamp.className = 'item-timestamp';
    timestamp.textContent = formatTimestamp(item.timestamp);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.title = 'Delete item';
    deleteBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ 
            action: 'deleteClipboardItem', 
            id: item.id 
        }, (response) => {
            if (chrome.runtime.lastError) {
                debugError('Error deleting item:', chrome.runtime.lastError);
                showNotification('Error deleting item: ' + chrome.runtime.lastError.message, 'error');
                return;
            }

            if (response && response.success) {
                div.remove();
                showNotification('Item deleted');
            } else {
                showNotification('Error deleting item: ' + (response?.error || 'Unknown error'), 'error');
            }
        });
    });
    
    div.appendChild(text);
    div.appendChild(timestamp);
    div.appendChild(deleteBtn);
    
    return div;
}

function updateClipboardDisplay(items, filter = '') {
    clipboardItems.innerHTML = '';
    
    if (!items || items.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-message';
        emptyMessage.textContent = 'No clipboard items found';
        clipboardItems.appendChild(emptyMessage);
        return;
    }
    
    const filteredItems = filter
        ? items.filter(item => item.text.toLowerCase().includes(filter.toLowerCase()))
        : items;
    
    if (filteredItems.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-message';
        emptyMessage.textContent = 'No items match your search';
        clipboardItems.appendChild(emptyMessage);
        return;
    }
    
    filteredItems.forEach(item => {
        clipboardItems.appendChild(createClipboardItemElement(item));
    });
}

// --- Clipboard History Management ---
async function checkInitialization(retryCount = 0) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'checkInitialization' }, (response) => {
            if (chrome.runtime.lastError) {
                debugError('Error checking initialization:', chrome.runtime.lastError);
                resolve({ initialized: false, error: chrome.runtime.lastError });
                return;
            }
            resolve(response);
        });
    });
}

async function loadClipboardHistory(retryCount = 0) {
    debugLog('Loading clipboard history...');
    
    // Show loading state
    clipboardItems.innerHTML = '<div class="empty-message">Loading clipboard history...</div>';
    
    try {
        // First check if extension is initialized
        const initResponse = await checkInitialization();
        if (!initResponse.initialized) {
            if (retryCount < 5) { // Limit retries to 5 attempts
                debugLog('Extension not initialized yet, waiting... (attempt ' + (retryCount + 1) + ')');
                showNotification('Please wait while the extension initializes...', 'info');
                setTimeout(() => loadClipboardHistory(retryCount + 1), 1000);
                return;
            } else {
                debugError('Max retry attempts reached');
                showNotification('Failed to initialize extension. Please try again.', 'error');
                return;
            }
        }
        
        // Extension is initialized, proceed with loading history
        chrome.runtime.sendMessage({ action: 'getClipboardHistory' }, (response) => {
            if (chrome.runtime.lastError) {
                debugError('Error loading clipboard history:', chrome.runtime.lastError);
                showNotification('Error loading clipboard history: ' + chrome.runtime.lastError.message, 'error');
                return;
            }

            if (response && response.success) {
                debugLog(`Loaded ${response.items.length} clipboard items`);
                updateClipboardDisplay(response.items);
            } else {
                debugError('Failed to load clipboard history:', response?.error);
                showNotification('Error loading clipboard history: ' + (response?.error || 'Unknown error'), 'error');
            }
        });
    } catch (error) {
        debugError('Error in loadClipboardHistory:', error);
        showNotification('Error loading clipboard history: ' + error.message, 'error');
    }
}

// --- Event Listeners ---
refreshButton.addEventListener('click', () => {
    debugLog('Refresh button clicked');
    loadClipboardHistory();
});

clearHistoryButton.addEventListener('click', () => {
    debugLog('Clear history button clicked');
    if (confirm('Are you sure you want to clear all clipboard history?')) {
        chrome.runtime.sendMessage({ action: 'clearClipboardHistory' }, (response) => {
            if (chrome.runtime.lastError) {
                debugError('Error clearing clipboard history:', chrome.runtime.lastError);
                showNotification('Error clearing history: ' + chrome.runtime.lastError.message, 'error');
                return;
            }

            if (response && response.success) {
                debugLog('Clipboard history cleared');
                updateClipboardDisplay([]);
                showNotification('History cleared');
            } else {
                debugError('Failed to clear clipboard history:', response?.error);
                showNotification('Error clearing history: ' + (response?.error || 'Unknown error'), 'error');
            }
        });
    }
});

filterInput.addEventListener('input', () => {
    debugLog('Filter input changed');
    loadClipboardHistory();
});

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    debugLog('Popup initialized');
    loadClipboardHistory();
}); 