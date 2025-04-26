// clipboard.js - Handles clipboard event detection and UI interaction

document.addEventListener('DOMContentLoaded', function() 
{
    // Show loading state first
    const historyContainer = document.getElementById('clipboard-history');
    historyContainer.innerHTML = '<div class="empty-message">Loading clipboard history...</div>';
    
    // Request a clipboard check and wait for it to complete before loading history
    chrome.runtime.sendMessage({ action: 'checkClipboard' }, function() {
        // After clipboard check completes, load the history with a small delay to ensure storage is updated
        setTimeout(loadClipboardHistory, 150);
    });
    
    // Set up event listeners for UI buttons
    document.getElementById('clear-history').addEventListener('click', clearHistory);
    document.getElementById('refresh-history').addEventListener('click', function() {
        // Show loading indicator
        historyContainer.innerHTML = '<div class="empty-message">Refreshing clipboard history...</div>';
        
        // Try to capture the latest clipboard content and then refresh the view
        chrome.runtime.sendMessage({ action: 'checkClipboard' }, function() {
            // Wait a bit to ensure storage is updated
            setTimeout(loadClipboardHistory, 150);
        });
    });
    
    // Handle filtering
    document.getElementById('filter-input').addEventListener('input', filterClipboardItems);
});

// Load clipboard history from storage and display in UI
function loadClipboardHistory() 
{
    chrome.runtime.sendMessage({ action: 'getClipboardHistory' }, function(response) {
        const historyContainer = document.getElementById('clipboard-history');
        historyContainer.innerHTML = ''; // Clear existing items
        
        if (!response.history || response.history.length === 0) {
            historyContainer.innerHTML = '<div class="empty-message">No clipboard history found</div>';
            return;
        }
        
        // Create clipboard items
        response.history.forEach(item => {
            const clipboardItem = createClipboardItemElement(item);
            historyContainer.appendChild(clipboardItem);
        });
    });
}

// Create a clipboard item element
function createClipboardItemElement(item) 
{
    const clipboardItem = document.createElement('div');
    clipboardItem.className = 'clipboard-item';
    
    // Format the timestamp
    const timestamp = new Date(item.timestamp);
    const formattedDate = timestamp.toLocaleDateString();
    const formattedTime = timestamp.toLocaleTimeString();
    
    // Truncate text if it's too long for preview
    const displayText = item.text.length > 100 
        ? item.text.substring(0, 100) + '...' 
        : item.text;
    
    // Set the HTML content
    clipboardItem.innerHTML = `
        <div class="item-content">
            <div class="item-text">${displayText}</div>
            <div class="item-timestamp">${formattedDate} ${formattedTime}</div>
        </div>
        <div class="item-actions">
            <button class="copy-btn" title="Copy to clipboard">Copy</button>
            <button class="delete-btn" title="Delete from history">Delete</button>
        </div>
    `;
    
    // Store the full text as a data attribute
    clipboardItem.dataset.text = item.text;
    
    // Set up event listeners for the buttons
    clipboardItem.querySelector('.copy-btn').addEventListener('click', function() {
        copyToClipboard(item.text);
    });
    
    clipboardItem.querySelector('.delete-btn').addEventListener('click', function() {
        deleteClipboardItem(clipboardItem, item.text);
    });
    
    return clipboardItem;
}

// Copy text to clipboard
function copyToClipboard(text) 
{
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy: ', err);
        showNotification('Failed to copy text', true);
    });
}

// Delete an item from clipboard history
function deleteClipboardItem(element, text) 
{
    chrome.runtime.sendMessage({ action: 'getClipboardHistory' }, function(response) {
        const history = response.history || [];
        const updatedHistory = history.filter(item => item.text !== text);
        
        chrome.storage.local.set({ clipboardHistory: updatedHistory }, function() {
            element.remove();
            showNotification('Item deleted');
            
            // Show empty message if history is now empty
            if (updatedHistory.length === 0) {
                const historyContainer = document.getElementById('clipboard-history');
                historyContainer.innerHTML = '<div class="empty-message">No clipboard history found</div>';
            }
        });
    });
}

// Filter clipboard items based on search input
function filterClipboardItems() 
{
    const filterText = document.getElementById('filter-input').value.toLowerCase();
    const clipboardItems = document.querySelectorAll('.clipboard-item');
    
    clipboardItems.forEach(item => {
        const itemText = item.dataset.text.toLowerCase();
        if (itemText.includes(filterText)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// Clear all clipboard history
function clearHistory() 
{
    if (confirm('Are you sure you want to clear all clipboard history?')) {
        chrome.runtime.sendMessage({ action: 'clearClipboardHistory' }, function(response) {
            if (response.success) {
                const historyContainer = document.getElementById('clipboard-history');
                historyContainer.innerHTML = '<div class="empty-message">No clipboard history found</div>';
                showNotification('Clipboard history cleared');
            }
        });
    }
}

// Show notification message
function showNotification(message, isError = false) 
{
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = isError ? 'notification error' : 'notification';
    notification.style.display = 'block';
    
    // Hide notification after 3 seconds
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
} 