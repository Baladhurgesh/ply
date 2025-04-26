// offscreen.js

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message, sender, sendResponse) {
  if (message.target !== 'offscreen') {
    return; // Ignore messages not intended for the offscreen document
  }

  switch (message.type) {
    case 'read-clipboard':
      try {
        const clipboardText = await readClipboard();
        sendResponse({ success: true, text: clipboardText });
      } catch (error) {
        console.error('Offscreen: Error reading clipboard:', error);
        sendResponse({ success: false, error: error.message });
      }
      // Indicate that the response will be sent asynchronously
      return true; 
    default:
      console.warn(`Offscreen: Unrecognized message type received: ${message.type}`);
      sendResponse({ success: false, error: 'Unrecognized message type' });
  }
}

// Function to read clipboard content using the textarea
async function readClipboard() {
  const textarea = document.getElementById('clipboard-textarea');
  if (!textarea) {
    throw new Error('Clipboard textarea not found in offscreen document.');
  }

  // Clear previous content
  textarea.value = '';

  // Focus the textarea. It's crucial this document has focus, 
  // which it should as an active offscreen document.
  textarea.focus();

  try {
    // Modern async clipboard API (preferred if it works in offscreen)
    // Note: This might still require user interaction/gesture in some contexts,
    // but it's worth trying in the offscreen document.
    if (navigator.clipboard && navigator.clipboard.readText) {
      // console.log("Offscreen: Trying navigator.clipboard.readText()...");
      const text = await navigator.clipboard.readText();
      // console.log("Offscreen: readText() successful.");
      return text;
    }
  } catch (err) {
    //  console.warn('Offscreen: navigator.clipboard.readText() failed, falling back to execCommand.', err);
  }

  // Fallback using document.execCommand('paste')
  // console.log("Offscreen: Falling back to document.execCommand('paste')...");
  const successful = document.execCommand('paste');
  if (!successful) {
    // console.error("Offscreen: execCommand('paste') failed.");
    throw new Error('Failed to execute paste command.');
  }

  const clipboardText = textarea.value;
  // console.log("Offscreen: execCommand('paste') successful.");
  textarea.value = ''; // Clear after reading
  return clipboardText;
}

console.log("Offscreen script loaded."); // Log to confirm loading 