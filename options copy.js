// Saves options to chrome.storage.sync.
function saveOptions() {
  const backendUrl = document.getElementById('backendUrl').value;
  const claudeApiKey = document.getElementById('claudeApiKey').value;

  chrome.storage.sync.set({
    backendUrl: backendUrl,
    claudeApiKey: claudeApiKey // Save the API key
  }, function() {
    // Update status to let user know options were saved.
    const status = document.getElementById('status');
    status.textContent = 'Options saved successfully!';
    setTimeout(function() {
      status.textContent = '';
    }, 2000);
  });
}

// Restores options state using the preferences stored in chrome.storage.
function restoreOptions() {
  // Default values
  chrome.storage.sync.get({
    backendUrl: 'http://localhost:5000/receive_context', // Default backend URL
    claudeApiKey: '' // Default empty API key
  }, function(items) {
    document.getElementById('backendUrl').value = items.backendUrl;
    document.getElementById('claudeApiKey').value = items.claudeApiKey; // Restore API key
  });
}

// --- Log Handling ---
function downloadLogs() {
    const logStatus = document.getElementById('logStatus');
    logStatus.textContent = 'Retrieving logs...';

    chrome.runtime.sendMessage({ action: 'getLLMLogs' }, function(response) {
        if (chrome.runtime.lastError) {
            logStatus.textContent = `Error retrieving logs: ${chrome.runtime.lastError.message}`;
            console.error(chrome.runtime.lastError);
            return;
        }
        if (response && response.success) {
            if (!response.logs || response.logs.length === 0) {
                logStatus.textContent = 'No logs found to download.';
                return;
            }

            try {
                const logData = JSON.stringify(response.logs, null, 2); // Pretty print JSON
                const blob = new Blob([logData], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `ghosttab_llm_logs_${timestamp}.json`;

                chrome.downloads.download({
                    url: url,
                    filename: filename,
                    saveAs: true // Prompt user for save location
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        logStatus.textContent = `Error starting download: ${chrome.runtime.lastError.message}`;
                        console.error(chrome.runtime.lastError);
                    } else {
                        logStatus.textContent = `Logs downloaded as ${filename}.`;
                    }
                    // Clean up the object URL after a short delay
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                });

            } catch (e) {
                 logStatus.textContent = 'Error processing log data for download.';
                 console.error("Error creating log file:", e);
            }

        } else {
            logStatus.textContent = `Error retrieving logs: ${response?.error || 'Unknown error'}`;
        }
    });
}

function clearLogs() {
    const logStatus = document.getElementById('logStatus');
    if (confirm("Are you sure you want to clear all stored LLM logs? This cannot be undone.")) {
        logStatus.textContent = 'Clearing logs...';
        chrome.runtime.sendMessage({ action: 'clearLLMLogs' }, function(response) {
             if (chrome.runtime.lastError) {
                 logStatus.textContent = `Error clearing logs: ${chrome.runtime.lastError.message}`;
                 console.error(chrome.runtime.lastError);
             } else if (response && response.success) {
                 logStatus.textContent = 'LLM logs cleared successfully.';
             } else {
                 logStatus.textContent = `Error clearing logs: ${response?.error || 'Unknown error'}`;
             }
             setTimeout(() => { logStatus.textContent = ''; }, 3000); // Clear status after a bit
        });
    }
}

document.addEventListener('DOMContentLoaded', function() {
    restoreOptions();
    // Add listeners for log buttons
    document.getElementById('downloadLogs').addEventListener('click', downloadLogs);
    document.getElementById('clearLogs').addEventListener('click', clearLogs);
});

// Listener for the main save button
document.getElementById('save').addEventListener('click', saveOptions); 