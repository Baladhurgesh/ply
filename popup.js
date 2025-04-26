document.addEventListener('DOMContentLoaded', function() {
  const clipboardHistory = document.getElementById('clipboardHistory');
  const refreshButton = document.getElementById('refreshButton');
  const clearHistoryButton = document.getElementById('clear-history');
  const filterInput = document.getElementById('filter-input');
  const notification = document.getElementById('notification');
  let clipboardItems = [];
  let recentlyDeletedItems = new Set(); // Track recently deleted items

  // Function to show notification
  function showNotification(message, duration = 2000) {
    notification.textContent = message;
    notification.style.display = 'block';
    setTimeout(() => {
      notification.style.display = 'none';
    }, duration);
  }

  // Function to format timestamp
  function formatTimestamp(date) {
    return date.toLocaleTimeString();
  }

  // Function to create a clipboard item element
  function createClipboardItem(text, timestamp) {
    const item = document.createElement('div');
    item.className = 'clipboard-item';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.onclick = function() {
      const index = clipboardItems.findIndex(item => item.timestamp === timestamp);
      if (index !== -1) {
        const deletedText = clipboardItems[index].text;
        clipboardItems.splice(index, 1);
        recentlyDeletedItems.add(deletedText);
        // Remove from recentlyDeletedItems after 5 seconds
        setTimeout(() => {
          recentlyDeletedItems.delete(deletedText);
        }, 5000);
        saveClipboardHistory();
        updateClipboardDisplay();
        showNotification('Item deleted');
      }
    };

    const content = document.createElement('div');
    content.className = 'item-text';
    content.textContent = text;

    const time = document.createElement('div');
    time.className = 'item-timestamp';
    time.textContent = formatTimestamp(new Date(timestamp));

    item.appendChild(deleteBtn);
    item.appendChild(content);
    item.appendChild(time);
    return item;
  }

  // Function to update the display
  function updateClipboardDisplay() {
    clipboardHistory.innerHTML = '';
    
    if (clipboardItems.length === 0) {
      clipboardHistory.innerHTML = '<div class="empty-message">No clipboard items</div>';
      return;
    }

    const filterText = filterInput.value.toLowerCase();
    const filteredItems = clipboardItems.filter(item => 
      item.text.toLowerCase().includes(filterText)
    );

    if (filteredItems.length === 0) {
      clipboardHistory.innerHTML = '<div class="empty-message">No items match your search</div>';
      return;
    }

    filteredItems.forEach(item => {
      clipboardHistory.appendChild(createClipboardItem(item.text, item.timestamp));
    });
  }

  // Function to save clipboard history to storage
  function saveClipboardHistory() {
    chrome.storage.local.set({ clipboardHistory: clipboardItems });
  }

  // Function to load clipboard history from storage
  function loadClipboardHistory() {
    chrome.storage.local.get(['clipboardHistory'], function(result) {
      if (result.clipboardHistory) {
        clipboardItems = result.clipboardHistory;
        updateClipboardDisplay();
      }
    });
  }

  // Function to update clipboard content
  async function updateClipboardContent() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && 
        !recentlyDeletedItems.has(text) && // Don't add if recently deleted
        (!clipboardItems.length || text !== clipboardItems[0].text)) {
        clipboardItems.unshift({
          text: text,
          timestamp: Date.now()
        });
        // Keep only the last 50 items
        if (clipboardItems.length > 50) {
          clipboardItems = clipboardItems.slice(0, 50);
        }
        saveClipboardHistory();
        updateClipboardDisplay();
        showNotification('New item added');
      }
    } catch (err) {
      console.error('Error reading clipboard:', err);
    }
  }

  // Event listeners
  refreshButton.addEventListener('click', updateClipboardContent);
  
  clearHistoryButton.addEventListener('click', function() {
    clipboardItems = [];
    recentlyDeletedItems.clear(); // Clear the recently deleted items set
    saveClipboardHistory();
    updateClipboardDisplay();
    showNotification('History cleared');
  });

  filterInput.addEventListener('input', updateClipboardDisplay);

  // Initial load
  loadClipboardHistory();

  // Check clipboard every 2 seconds
  setInterval(updateClipboardContent, 2000);
}); 