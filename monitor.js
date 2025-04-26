(function() 
{
    // Monitor copy events and store to history
    document.addEventListener('copy', function(e) {
        // Get the selected text
        const selectedText = window.getSelection().toString();
        
        // Don't proceed if selection is empty
        if (!selectedText || selectedText.trim() === '') {
            return;
        }
        
        // Send the selected text to the background script to add to clipboard history
        chrome.runtime.sendMessage({
            action: 'addToClipboard',
            text: selectedText
        });
        
        // Original event continues normally, no need to preventDefault()
    });
    
    // Listen for keyboard shortcuts (Ctrl+C)
    document.addEventListener('keydown', function(e) {
        // Check if Ctrl+C was pressed
        if (e.ctrlKey && e.key === 'c') {
            // The copy event will handle this, but we can add other
            // keyboard-specific logic here if needed in the future
        }
    });
    
    console.log('GhostTab clipboard monitor initialized');
})(); 