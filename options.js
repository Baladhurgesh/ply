// --- Debug Flag ---
const DEBUG_MODE = false; // Set to true to enable options script logging

// --- Helper Debug Logging Functions ---
function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log("OPTIONS LOG:", ...args);
    }
}
function debugWarn(...args) {
    if (DEBUG_MODE) {
        console.warn("OPTIONS WARN:", ...args);
    }
}
function debugError(...args) {
    if (DEBUG_MODE) {
        console.error("OPTIONS ERROR:", ...args);
    }
}

// --- Options Management ---
function saveOptions() {
    debugLog('Saving options...');
    const backendUrl = document.getElementById('backendUrl').value;
    const claudeApiKey = document.getElementById('claudeApiKey').value;

    // Validate inputs
    if (!backendUrl) {
        showStatus('Error: Backend URL is required', 'error');
        return;
    }

    chrome.storage.sync.set({
        backendUrl: backendUrl,
        claudeApiKey: claudeApiKey
    }, function() {
        if (chrome.runtime.lastError) {
            debugError('Error saving options:', chrome.runtime.lastError);
            showStatus(`Error saving options: ${chrome.runtime.lastError.message}`, 'error');
        } else {
            debugLog('Options saved successfully');
            showStatus('Options saved successfully!', 'success');
        }
    });
}

function restoreOptions() {
    debugLog('Restoring options...');
    // Default values
    chrome.storage.sync.get({
        backendUrl: 'http://localhost:5000/receive_context',
        claudeApiKey: ''
    }, function(items) {
        if (chrome.runtime.lastError) {
            debugError('Error restoring options:', chrome.runtime.lastError);
            showStatus(`Error restoring options: ${chrome.runtime.lastError.message}`, 'error');
        } else {
            document.getElementById('backendUrl').value = items.backendUrl;
            document.getElementById('claudeApiKey').value = items.claudeApiKey;
            debugLog('Options restored successfully');
        }
    });
}

// --- Status Display ---
function showStatus(message, type = 'info') {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    
    // Clear status after delay
    setTimeout(function() {
        status.textContent = '';
        status.className = 'status';
    }, 3000);
}

// --- Log Management ---
function downloadLogs() {
    debugLog('Downloading logs...');
    const logStatus = document.getElementById('logStatus');
    logStatus.textContent = 'Retrieving logs...';
    logStatus.className = 'status info';

    chrome.runtime.sendMessage({ action: 'getLLMLogs' }, function(response) {
        if (chrome.runtime.lastError) {
            debugError('Error retrieving logs:', chrome.runtime.lastError);
            logStatus.textContent = `Error retrieving logs: ${chrome.runtime.lastError.message}`;
            logStatus.className = 'status error';
            return;
        }

        if (response && response.success) {
            if (!response.logs || response.logs.length === 0) {
                logStatus.textContent = 'No logs found to download.';
                logStatus.className = 'status info';
                return;
            }

            try {
                const logData = JSON.stringify(response.logs, null, 2);
                const blob = new Blob([logData], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `ghosttab_llm_logs_${timestamp}.json`;

                chrome.downloads.download({
                    url: url,
                    filename: filename,
                    saveAs: true
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        debugError('Error starting download:', chrome.runtime.lastError);
                        logStatus.textContent = `Error starting download: ${chrome.runtime.lastError.message}`;
                        logStatus.className = 'status error';
                    } else {
                        debugLog('Logs downloaded successfully');
                        logStatus.textContent = `Logs downloaded as ${filename}.`;
                        logStatus.className = 'status success';
                    }
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                });

            } catch (e) {
                debugError('Error processing log data:', e);
                logStatus.textContent = 'Error processing log data for download.';
                logStatus.className = 'status error';
            }

        } else {
            logStatus.textContent = `Error retrieving logs: ${response?.error || 'Unknown error'}`;
            logStatus.className = 'status error';
        }
    });
}

function clearLogs() {
    debugLog('Clearing logs...');
    const logStatus = document.getElementById('logStatus');
    if (confirm("Are you sure you want to clear all stored LLM logs? This cannot be undone.")) {
        logStatus.textContent = 'Clearing logs...';
        logStatus.className = 'status info';

        chrome.runtime.sendMessage({ action: 'clearLLMLogs' }, function(response) {
            if (chrome.runtime.lastError) {
                debugError('Error clearing logs:', chrome.runtime.lastError);
                logStatus.textContent = `Error clearing logs: ${chrome.runtime.lastError.message}`;
                logStatus.className = 'status error';
            } else if (response && response.success) {
                debugLog('Logs cleared successfully');
                logStatus.textContent = 'LLM logs cleared successfully.';
                logStatus.className = 'status success';
            } else {
                logStatus.textContent = `Error clearing logs: ${response?.error || 'Unknown error'}`;
                logStatus.className = 'status error';
            }
            setTimeout(() => {
                logStatus.textContent = '';
                logStatus.className = 'status';
            }, 3000);
        });
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', function() {
    debugLog('DOM content loaded, initializing options page');
    restoreOptions();
    
    // Add listeners for log buttons
    document.getElementById('downloadLogs').addEventListener('click', downloadLogs);
    document.getElementById('clearLogs').addEventListener('click', clearLogs);
    
    // Add listener for the main save button
    document.getElementById('save').addEventListener('click', saveOptions);
}); 