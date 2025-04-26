(function()
{
    // Remove hardcoded ghost text
    // const GHOST_TEXT = 'ghost';

    // --- Constants for Debouncing --- 
    const DEBOUNCE_DELAY = 10000; // milliseconds
    const MIN_CHARS_TO_TRIGGER = 5;

    let activeTarget = null;
    let overlay = null;
    let currentSuggestions = []; // Store LLM suggestions
    let currentSuggestionIndex = 0; // Index of the suggestion being shown
    let currentWordIndex = 0; // Index for word-by-word filling
    let originalPlaceholder = null; // Store the original placeholder text
    let processingIndicator = null; // Reference to the processing indicator element
    let llmRequestTimer = null; // Timer for debouncing LLM requests
    let contextForCurrentSuggestion = null; // <-- Store context for logging accepted suggestions
    let isProcessingGeneration = false; // Flag to prevent re-triggering during modification

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);

    // --- Message Listener (from background script) ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("Content Script Received message:", message);
        if (message.action === 'requestContextForManualTrigger') {
            console.log("Content: Received requestContextForManualTrigger from background.");
            handleManualTrigger();
        } else if (message.action === 'fillWordByWord') {
            console.log("Content: Received fillWordByWord from background.");
            handleFillWordByWord();
        } else if (message.action === 'commitSuggestionAlias') { // Handle new action
            console.log("Content: Received commitSuggestionAlias from background.");
            commitFullSuggestion(); // Call the refactored commit function
        } else if (message.action === 'notifyPasteReady') { // Handle spreadsheet notification
            console.log("Content: Received notifyPasteReady from background.");
            // Display the feedback message provided by the background script
            showTemporaryFeedback(message.message);
        }
    });

    // --- New Handler for Debounced LLM Requests --- 
    function handleInputForLLM(event) {
        if (!activeTarget || isProcessingGeneration) return; // Prevent loops

        // Hide suggestion overlay immediately on input
        if (!isProcessingGeneration && overlay && overlay.style.display !== 'none') {
            // console.log("Input detected, hiding suggestion overlay."); // Less verbose log
            overlay.style.display = 'none';
        }

        // Clear previous suggestion debounce timer
        clearTimeout(llmRequestTimer);

        const currentText = getTextFromTarget(activeTarget);

        // --- New Generative Trigger Detection (using ```) ---
        // Check on every input if the text matches the pattern
        const match = currentText.match(/^(.*)```([\s\S]+?)```$/); // Match ```instruction``` at the end
        if (match) {
            const precedingText = match[1];
            const instruction = match[2].trim(); // Get instruction between backticks

            if (instruction) {
                console.log(`Content: Detected generative trigger \`\`\`${instruction}\`\`\`. Preceding text: "${precedingText}"`);

                // --- Modify Input Field & Trigger ---
                isProcessingGeneration = true; // Set flag

                // Programmatically update the field value to remove the trigger text
                if (activeTarget.tagName === 'INPUT' || activeTarget.tagName === 'TEXTAREA') {
                    activeTarget.value = precedingText;
                } else if (activeTarget.isContentEditable) {
                     activeTarget.textContent = precedingText;
                     try { // Restore cursor position (best effort)
                        const range = document.createRange();
                        const sel = window.getSelection();
                        range.selectNodeContents(activeTarget);
                        range.collapse(false);
                        sel.removeAllRanges();
                        sel.addRange(range);
                     } catch(e) { console.warn("Couldn't reset cursor position in contentEditable after trigger."); }
                }

                 // Dispatch input event
                activeTarget.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

                // Call LLM request with the extracted instruction
                triggerLLMRequest(activeTarget, instruction); // Pass instruction

                 // Reset flag after a short delay
                setTimeout(() => { isProcessingGeneration = false; }, 50);

                return; // Stop further processing
                // --- End Modify Input Field & Trigger ---
            }
        }
         // --- End Generative Trigger ---

        // --- Existing Suggestion Debounce Logic ---
        // (Keep this part exactly as it was)
        if (!isProcessingGeneration && currentText.length >= MIN_CHARS_TO_TRIGGER) {
            console.log(`Input length (${currentText.length}) >= ${MIN_CHARS_TO_TRIGGER}. Setting suggestion debounce timer for ${DEBOUNCE_DELAY}ms.`);
            llmRequestTimer = setTimeout(() => {
                // Check flag again before triggering suggestion
                if (!isProcessingGeneration) {
                     console.log(`Suggestion debounce timer finished. Triggering suggestion LLM.`);
                     triggerLLMRequest(activeTarget); // No instruction means suggestion mode
                } else {
                     console.log(`Suggestion debounce timer finished, but generation is processing. Skipping suggestion.`);
                }
            }, DEBOUNCE_DELAY);
        } else if (!isProcessingGeneration) {
             console.log(`Input length (${currentText.length}) < ${MIN_CHARS_TO_TRIGGER}. Suggestion debounce timer not set.`);
        }
    }

    function handleFocusIn(event)
    {
        const target = event.target;
    
        if (!isEditable(target))
        {
            return;
        }
    
        // Log detailed info about the focused element
        logElementInfo(target);
    
        // If focus shifts to a new element, ensure the overlay/listeners on the old one are removed
        if (activeTarget && activeTarget !== target) {
             handleFocusOut({ target: activeTarget });
        } else if (activeTarget === target) {
            // Already focused on this element, potentially update overlay state if needed
            return; // Avoid redundant setup
        }
    
        activeTarget = target;
        originalPlaceholder = target.getAttribute('placeholder'); // <-- Store original placeholder
        attachOverlay(target);
        target.addEventListener('input', handleInputForLLM); // <-- Use new debounced handler
        target.addEventListener('keydown', handleKeyDown);
    
        // Log hierarchy when element gains focus
        logElementHierarchy(activeTarget);
    
        // --- Trigger LLM on Initial Focus (Optional) --- 
        // Let's keep the initial trigger on focus for now.
        // Debouncing will handle triggers *after* subsequent typing.
        console.log("Focus detected, triggering initial LLM request.");
        triggerLLMRequest(target); 
    }

    function handleFocusOut(event)
    {
        const target = event.target;
        if (target !== activeTarget)
        {
            return;
        }

        // Clear any pending debounced request
        clearTimeout(llmRequestTimer);

        // Restore placeholder if it was modified
        if (originalPlaceholder !== null && target.getAttribute('placeholder') !== originalPlaceholder) {
            target.setAttribute('placeholder', originalPlaceholder);
        }

        detachOverlay();
        target.removeEventListener('input', handleInputForLLM); // <-- Detach new handler
        target.removeEventListener('keydown', handleKeyDown);
        activeTarget = null;
        currentSuggestions = [];
        contextForCurrentSuggestion = null; // <-- Clear context on focus out
        currentSuggestionIndex = 0;
        currentWordIndex = 0; 
        originalPlaceholder = null; 
    }

    // Checks if an element is a standard editable field
    function isEditable(el)
    {
        if (!el)
        {
            return false;
        }
    
        // Standard input types that behave like text boxes
        if (el.tagName === 'INPUT')
        {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            const allowedInputTypes = ['text', '', 'search', 'url', 'tel', 'email'];
            return allowedInputTypes.includes(type);
        }
        // Standard multi-line text area
        if (el.tagName === 'TEXTAREA')
        {
            return true;
        }
        // Catch-all for rich text editors or other custom editable regions
        if (el.isContentEditable)
        {
            return true;
        }
        return false;
    }

    // Creates and attaches the overlay element
    function attachOverlay(target)
    {
        // Avoid creating multiple overlays
        if (overlay)
        {
            return;
        }
        overlay = document.createElement('span');
        overlay.className = 'ghost-overlay';
        overlay.style.position = 'absolute';
        overlay.style.pointerEvents = 'none'; // Allow clicks to pass through
        overlay.style.whiteSpace = 'pre'; // Preserve suggestion whitespace

        // Inherit font styles for alignment
        const computedTargetStyle = getComputedStyle(target);
        overlay.style.font = computedTargetStyle.font;
        overlay.style.lineHeight = computedTargetStyle.lineHeight;

        // Insert into DOM, preferably right after the target
        if (target.parentNode)
        {
             target.parentNode.insertBefore(overlay, target.nextSibling);
        }
        else
        {
            // Fallback if target is detached or has no parent somehow
            document.body.appendChild(overlay);
        }

        // Perform initial update for positioning and visibility
        updateOverlay();
    }

    // Removes the overlay element from the DOM
    function detachOverlay()
    {
        if (!overlay)
        {
            return;
        }
        // Check if it's still in the DOM before trying removal
        if (overlay.parentNode)
        {
            overlay.parentNode.removeChild(overlay);
        }
        overlay = null; // Clear reference
    }

    // Updates the overlay's content, position, and visibility based on LLM suggestions
    function updateOverlay()
    {
        console.log("updateOverlay called.");
        if (!activeTarget || !overlay) { 
            console.log("updateOverlay: No active target or overlay, returning.");
            return;
        }

        let suggestionText = null;
        // Expect 0 or 1 suggestion
        if (currentSuggestions.length > 0) {
            suggestionText = currentSuggestions[0];
        }
        const prefix = getTextFromTarget(activeTarget);

        console.log(`updateOverlay: Prefix='${prefix}', Suggestion='${suggestionText}'`);

        // --- Check for Command Prefix and Starred Replacement ---
        let isCommandPrefix = prefix.length > 2 && prefix.startsWith('*') && prefix.endsWith('*');
        let isReplacementSuggestion = suggestionText && suggestionText.length > 1 && suggestionText.startsWith('*') && suggestionText.endsWith('*');
        let actualSuggestion = suggestionText;

        if (isReplacementSuggestion) {
            actualSuggestion = suggestionText.substring(1, suggestionText.length - 1); // Remove stars if present
        }
        // --- End Check ---

        // Determine if overlay should be shown
        let showOverlay = false;
        let overlayDisplayContent = '';

        if (actualSuggestion !== null) { // Check if we have *any* suggestion
            if (isCommandPrefix || isReplacementSuggestion) {
                // If user typed command OR LLM sent starred suggestion, treat as full replacement
                showOverlay = true;
                overlayDisplayContent = actualSuggestion;
            } else {
                // --- Standard append/completion logic --- 
                // *** KEY CHANGE: Show the suggestion if it exists and isn't empty ***
                // (No need for startsWith check here, as prompt asks for text to *follow* prefix)
                if (actualSuggestion.length > 0) {
                    showOverlay = true;
                    // Display the *full* suggestion, but it will be positioned after the prefix
                    overlayDisplayContent = actualSuggestion;
                } else {
                    // Handle case where LLM suggests an empty string - don't show overlay
                    showOverlay = false;
                }
                // --- End Standard append --- 
            }
        }

        // --- Placeholder Handling ---
        if (showOverlay) {
            if (activeTarget.hasAttribute('placeholder')) {
                activeTarget.removeAttribute('placeholder');
            }
        } else {
            if (originalPlaceholder !== null && !activeTarget.hasAttribute('placeholder')) {
                 activeTarget.setAttribute('placeholder', originalPlaceholder);
            }
        }
        // --- End Placeholder Handling ---

        // Update Overlay Content and Visibility
        if (showOverlay) {
            overlay.textContent = overlayDisplayContent;
            console.log(`Positioning: Overlay text set. Natural offsetWidth=${overlay.offsetWidth}, scrollWidth=${overlay.scrollWidth}`);
            overlay.style.display = '';
        } else {
            overlay.textContent = '';
            overlay.style.display = 'none';
        }

        // Only run positioning if overlay is visible
        if (showOverlay)
        {
             // --- Positioning logic ---
             try
             {
                 // Common calculations
                 const computedTargetStyle = getComputedStyle(activeTarget);
                 const font = computedTargetStyle.font;
                 const overlayParent = overlay.offsetParent || document.body;
                 const parentRect = overlayParent.getBoundingClientRect();
                 let overlayTop = 0;
                 let overlayLeft = 0;

                 // Check if target is multi-line
                 if (activeTarget.tagName === 'TEXTAREA' || activeTarget.isContentEditable)
                 {
                     console.log("Positioning: Multi-line mode (textarea/contentEditable)");
                     const selection = window.getSelection();
                     if (selection && selection.rangeCount > 0)
                     {
                         const range = selection.getRangeAt(0).cloneRange();
                         range.collapse(false); // Collapse to the end/cursor position
                         const rects = range.getClientRects();
                         if (rects.length > 0)
                         {
                             // Use the last rect for multi-line positioning
                             const lastRect = rects[rects.length - 1];
                             overlayTop = lastRect.bottom - parentRect.top + overlayParent.scrollTop;
                             overlayLeft = lastRect.right - parentRect.left + overlayParent.scrollLeft;
                             console.log(`Positioning: Range rect found. lastRect.bottom=${lastRect.bottom}, lastRect.right=${lastRect.right}`);
                         }
                         else
                         {
                             // Fallback for empty elements or if no rects found
                             console.log("Positioning: Range rect NOT found, using fallback.");
                             // IMPROVED FALLBACK: Position based on padding, like single-line start
                             const targetRect = activeTarget.getBoundingClientRect();
                             const targetPaddingTop = parseFloat(computedTargetStyle.paddingTop) || 0;
                             const targetBorderTop = parseFloat(computedTargetStyle.borderTopWidth) || 0;
                             const targetPaddingLeft = parseFloat(computedTargetStyle.paddingLeft) || 0;
                             const targetBorderLeft = parseFloat(computedTargetStyle.borderLeftWidth) || 0;
                             overlayTop = targetRect.top - parentRect.top + overlayParent.scrollTop + targetPaddingTop + targetBorderTop;
                             overlayLeft = targetRect.left - parentRect.left + overlayParent.scrollLeft + targetPaddingLeft + targetBorderLeft;
                         }
                     }
                     else
                     {
                         // Fallback if no selection/range (should be rare)
                         console.warn("Positioning: Could not get selection range for positioning, using fallback.");
                         const targetRect = activeTarget.getBoundingClientRect();
                         overlayTop = targetRect.top - parentRect.top + overlayParent.scrollTop;
                         overlayLeft = targetRect.left - parentRect.left + overlayParent.scrollLeft;
                     }
                 }
                 else // Handle single-line INPUT elements
                 {
                     console.log("Positioning: Single-line mode (input)");
                     const targetRect = activeTarget.getBoundingClientRect();
                     const targetPaddingLeft = parseFloat(computedTargetStyle.paddingLeft) || 0;
                     const targetPaddingRight = parseFloat(computedTargetStyle.paddingRight) || 0;
                     const targetPaddingTop = parseFloat(computedTargetStyle.paddingTop) || 0;
                     const targetBorderLeft = parseFloat(computedTargetStyle.borderLeftWidth) || 0;
                     const targetBorderRight = parseFloat(computedTargetStyle.borderRightWidth) || 0;
                     const targetBorderTop = parseFloat(computedTargetStyle.borderTopWidth) || 0;
                     const inputClientWidth = activeTarget.clientWidth;
                     console.log(`Positioning: Target Info - clientWidth=${inputClientWidth}, padL=${targetPaddingLeft}, padR=${targetPaddingRight}, borderL=${targetBorderLeft}, borderR=${targetBorderRight}`);
                     const prefix = getTextFromTarget(activeTarget);
                     const scrollLeft = activeTarget.scrollLeft || 0;

                     // Calculate text width, considering scrollLeft
                     // If it's a command/replacement, position at start (width 0)
                     const fullPrefixWidth = (isCommandPrefix || isReplacementSuggestion) ? 0 : measureTextWidth(prefix, font);
                     const visiblePrefixWidth = Math.max(0, fullPrefixWidth - scrollLeft);
                     console.log(`Positioning: prefix='${prefix}', fullPrefixWidth=${fullPrefixWidth}, scrollLeft=${scrollLeft}, visiblePrefixWidth=${visiblePrefixWidth}`);

                     const relativeTop = targetRect.top - parentRect.top + overlayParent.scrollTop;
                     const relativeLeft = targetRect.left - parentRect.left + overlayParent.scrollLeft; // CORRECTED: Use parentRect.left

                     overlayTop = relativeTop + targetPaddingTop + targetBorderTop;
                     // Position after padding, border, and visible text width
                     overlayLeft = relativeLeft + targetPaddingLeft + targetBorderLeft + visiblePrefixWidth;

                     // --- Add clipping/maxWidth for single-line inputs ---
                     // Calculate suggestion start X relative to input's left *padding* edge
                     const suggestionStartX = visiblePrefixWidth;
                     // Calculate available width from suggestion start to right padding edge
                     const availableWidth = inputClientWidth - targetPaddingLeft - targetPaddingRight - suggestionStartX;
                     console.log(`Positioning: Calculated availableWidth=${availableWidth} (clientWidth=${inputClientWidth} - padL=${targetPaddingLeft} - padR=${targetPaddingRight} - suggestionStartX=${suggestionStartX})`);
                     overlay.style.maxWidth = Math.max(0, availableWidth) + 'px';
                     overlay.style.overflow = 'hidden';
                     overlay.style.whiteSpace = 'nowrap'; // Prevent wrapping in overlay
                     overlay.style.textOverflow = 'ellipsis'; // Optional: show ellipsis
                     console.log(`Positioning: Applied maxWidth=${overlay.style.maxWidth}`);
                     // --- End clipping ---
                 }

                 // Reset clipping styles if not single-line input (or handled differently)
                 // Ensure styles appropriate for multi-line are set/reset here
                 if (activeTarget.tagName === 'TEXTAREA' || activeTarget.isContentEditable) {
                    // --- Add clipping/maxWidth for multi-line inputs ---
                    const multiTargetPaddingLeft = parseFloat(computedTargetStyle.paddingLeft) || 0;
                    const multiTargetPaddingRight = parseFloat(computedTargetStyle.paddingRight) || 0;
                    const multiClientWidth = activeTarget.clientWidth;
                    // Use clientWidth minus padding as max width for multi-line
                    const multiAvailableWidth = multiClientWidth - multiTargetPaddingLeft - multiTargetPaddingRight;
                    console.log(`Positioning: Multi-line clipping - availableWidth=${multiAvailableWidth}`);
                    overlay.style.maxWidth = Math.max(0, multiAvailableWidth) + 'px';
                    overlay.style.overflow = 'hidden'; // Hide overflow
                    overlay.style.whiteSpace = 'pre'; // Allow wrapping within the available width
                    overlay.style.textOverflow = 'clip'; // Clip overflow without ellipsis
                    // --- End multi-line clipping ---
                 } else {
                    overlay.style.maxWidth = ''; // Reset maxWidth
                    overlay.style.overflow = ''; // Reset overflow
                    overlay.style.whiteSpace = 'pre'; // Restore default whitespace for multi-line
                    overlay.style.textOverflow = ''; // Reset textOverflow
                 }

                 console.log(`Positioning: Final calculated - overlayTop=${overlayTop}, overlayLeft=${overlayLeft}`);
                 // Apply calculated position
                 overlay.style.top = overlayTop + 'px';
                 overlay.style.left = overlayLeft + 'px';

                 // Apply styles that depend on the target element
                 const finalOverlayStyle = getComputedStyle(overlay);
                 overlay.style.lineHeight = computedTargetStyle.lineHeight;
                 overlay.style.font = font;
                 overlay.style.color = 'rgba(0, 0, 0, 0.35)'; // Or get from config if needed

                 // Log computed styles and final dimensions
                 console.log(`Positioning: Final Computed Styles - maxWidth=${finalOverlayStyle.maxWidth}, overflow=${finalOverlayStyle.overflow}, whiteSpace=${finalOverlayStyle.whiteSpace}, textOverflow=${finalOverlayStyle.textOverflow}`);
                 console.log(`Positioning: Final Computed Styles - top=${finalOverlayStyle.top}, left=${finalOverlayStyle.left}`);
                 console.log(`Positioning: Final overlay offsetWidth=${overlay.offsetWidth}`);

             } catch (e) {
                 console.error("GhostTab: Error calculating overlay position:", e);
                 overlay.style.display = 'none'; // Hide overlay on error
             }
             // --- End Positioning ---
        }
    }

    // Handles key presses on the target element
    function handleKeyDown(event)
    {
        if (!activeTarget) return;

        const isOverlayVisible = overlay && overlay.style.display !== 'none';

        // --- Suggestion Commit (Tab key) ---
        // Tab commits the *entire remaining* suggestion
        if (event.key === 'Tab' && !event.shiftKey && isOverlayVisible) {
            event.preventDefault();
            commitFullSuggestion(); // Call the refactored commit function
        }
        // --- End Suggestion Commit ---

        // --- Other Key Handlers (e.g., Escape to hide) can go here if needed --- 
        else if (event.key === 'Escape' && isOverlayVisible) {
            event.preventDefault();
            console.log("Content (Escape): Hiding suggestion and resetting state.");
            // Hide overlay and clear state without applying suggestion
            overlay.style.display = 'none';
            currentSuggestions = [];
            contextForCurrentSuggestion = null; // <-- Clear context on escape
            currentSuggestionIndex = 0;
            currentWordIndex = 0;
            // Restore placeholder
            if (originalPlaceholder !== null && !activeTarget.hasAttribute('placeholder')) {
                 activeTarget.setAttribute('placeholder', originalPlaceholder);
            }
        }
    }

    // Gets the current text from the target element
    function getTextFromTarget(target)
    {
        if (!target) return '';
        
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        { 
            return target.value || '';
        }
        if (target.isContentEditable)
        { 
            return target.textContent || '';
        }
        return '';
    }

    // Inserts (appends) the suggestion text into the target element (Existing function)
    function commitText(target, textToAppend)
    {
        if (!textToAppend) return; // Don't append empty string

        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        {
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const currentValue = target.value;
            // Append text. Assumes cursor is usually at the end when accepting.
            // More robust would be to check if start/end match prefix length.
            target.value = currentValue.slice(0, end) + textToAppend + currentValue.slice(end);
            // Move cursor to the end of the inserted text
            const newPos = end + textToAppend.length;
            target.setSelectionRange(newPos, newPos);
            target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }
        else if (target.isContentEditable)
        {
            // For contentEditable, insertText usually inserts at cursor
            document.execCommand('insertText', false, textToAppend);
            target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }
    }

    // --- New Function: Replaces the entire text ---
    function replaceText(target, newText)
    {
         if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
         {
             target.value = newText;
             // Move cursor to the end
             target.setSelectionRange(newText.length, newText.length);
             target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
         }
         else if (target.isContentEditable)
         {
             // Select all existing content and replace it
             const selection = window.getSelection();
             const range = document.createRange();
             range.selectNodeContents(target);
             selection.removeAllRanges();
             selection.addRange(range);
             document.execCommand('insertText', false, newText);
             // Collapse selection to the end (optional, good practice)
             selection.collapseToEnd();
             target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
         }
    }
    // --- End New Function ---

    // Measures text width using a hidden canvas for accurate positioning
    let canvasContext = null;
    function measureTextWidth(text, font)
    { 
        // Create canvas context only once for performance
        if (!canvasContext)
        { 
            const canvas = document.createElement('canvas');
            canvasContext = canvas.getContext('2d');
        }
        // Set the font context before measuring
        if (font && canvasContext)
        { 
            canvasContext.font = font;
        }
        return canvasContext ? canvasContext.measureText(text).width : 0;
    }

    // Logs detailed context information about the focused element
    function logElementInfo(element)
    {
        if (!element) return;

        // Use collapsed group to avoid cluttering the console
        console.groupCollapsed(`GhostTab: Context Info for Focused Element`); 

        try { 
            console.log("Element:", element); 
            console.log(`TagName: ${element.tagName}`);
            
            if (element.tagName === 'INPUT') {
                console.log(`Type: ${element.type || 'text'}`);
            }
            
            // Current Content
            try {
                if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                    console.log(`Current Value:`, element.value);
                } else if (element.isContentEditable) {
                    console.log(`Current TextContent:`, element.textContent);
                }
            } catch (e) {
                console.warn("Could not read value/textContent:", e);
            }
            
            // Key Context Attributes
            const placeholder = element.getAttribute('placeholder');
            if (placeholder) console.log(`Placeholder: ${placeholder}`);

            const ariaLabel = element.getAttribute('aria-label');
            if (ariaLabel) console.log(`Aria-Label: ${ariaLabel}`);

            if (element.id) console.log(`ID: ${element.id}`);
            if (element.name) console.log(`Name: ${element.name}`);

            const testId = element.getAttribute('data-testid');
            if (testId) console.log(`Data-TestID: ${testId}`);

            // Associated Labels (via for attribute or wrapping)
            if (element.labels && element.labels.length > 0) {
                const labelTexts = Array.from(element.labels).map(label => label.textContent?.trim()).filter(Boolean);
                if (labelTexts.length > 0) console.log(`Associated Label(s) Text:`, labelTexts);
            }

            // ARIA labels/descriptions pointing to other elements
            const labelledBy = element.getAttribute('aria-labelledby');
            if (labelledBy) {
                const labelElements = labelledBy.split(' ').map(id => document.getElementById(id));
                const labelledByTexts = labelElements.map(el => el?.textContent?.trim()).filter(Boolean);
                if (labelledByTexts.length > 0) console.log(`ARIA Labelled By Text:`, labelledByTexts);
            }

            const describedBy = element.getAttribute('aria-describedby');
            if (describedBy) {
                const descElements = describedBy.split(' ').map(id => document.getElementById(id));
                const describedByTexts = descElements.map(el => el?.textContent?.trim()).filter(Boolean);
                if (describedByTexts.length > 0) console.log(`ARIA Described By Text:`, describedByTexts);
            }

            // Accessibility Role
            const role = element.getAttribute('role');
            if (role) console.log(`Role: ${role}`);

            // Immediate Parent Context
            if (element.parentNode) {
                console.log(`Parent Node: <${element.parentNode.tagName} id='${element.parentNode.id || 'N/A'}' class='${element.parentNode.className || 'N/A'}'>`);
            }

            // Website Context
            console.log(`Website Origin: ${window.location.origin}`);
            console.log(`Full URL: ${window.location.href}`);

            // Associated Form Context
            if (element.form) {
                 console.log(`Associated Form: <form id='${element.form.id || 'N/A'}' name='${element.form.name || 'N/A'}'>`);
            }

            // Final Summary Line
            const elementType = (element.tagName === 'INPUT') ? (element.type || 'text') : element.tagName;
            const elementPlaceholder = element.getAttribute('placeholder') || 'N/A';
            const elementId = element.id || 'N/A';
            const elementUrl = window.location.href;
            console.log(`Summary: type=${elementType}, placeholder=${elementPlaceholder}, url=${elementUrl}, id=${elementId}`);

        } catch (error) {
            console.error("GhostTab: Error logging element context info:", error);
        }

        console.groupEnd();
    }

    // --- New Function: Gather Context Data --- 
    // Collects key context information into a structured object
    function getContextData(element) {
        console.log("GhostTab DEBUG: getContextData START for element:", element); // Log entry
        if (!element) return null;

        const data = {}; // Create an empty object to hold the data

        try {
            // Basic element info
            data.tagName = element.tagName;
            if (element.tagName === 'INPUT') {
                data.type = element.type || 'text';
            }
            data.id = element.id || null; // Use null if attribute is missing
            data.name = element.name || null;

            // Content and Hints
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                data.currentValue = element.value;
            } else if (element.isContentEditable) {
                // Limit length to avoid sending huge amounts of data
                data.currentTextContent = element.textContent?.substring(0, 2000); 
            }
            data.placeholder = element.getAttribute('placeholder');

            // --- Add Page-Level Context ---
            try {
                data.pageTitle = document.title || null;
                data.mainHeading = document.querySelector('h1')?.textContent?.trim() || null;
                
                // Get selected text, ensuring it's not from the active input itself
                const selection = window.getSelection();
                const selectedText = selection?.toString().trim();
                if (selectedText && selection.anchorNode && !element.contains(selection.anchorNode)) {
                   data.selectedTextOnPage = selectedText;
                } else {
                   data.selectedTextOnPage = null;
                }
                console.log(`Context Gathering: Title='${data.pageTitle}', H1='${data.mainHeading}', Selection='${data.selectedTextOnPage}'`);
            } catch (e) {
                console.error("Context Gathering: Error getting page-level info:", e);
                data.pageTitle = null;
                data.mainHeading = null;
                data.selectedTextOnPage = null;
            }
            // --- End Page-Level Context ---

            // Accessibility Info
            data.ariaLabel = element.getAttribute('aria-label');
            data.role = element.getAttribute('role');
            // Add more ARIA or data-* attributes if needed
            data.dataTestId = element.getAttribute('data-testid');

            // Associated Labels Text (Combined)
            let labelsText = [];
            if (element.labels && element.labels.length > 0) {
                labelsText = labelsText.concat(Array.from(element.labels).map(label => label.textContent?.trim()).filter(Boolean));
            }
            const labelledBy = element.getAttribute('aria-labelledby');
            if (labelledBy) {
                const labelElements = labelledBy.split(' ').map(id => document.getElementById(id));
                labelsText = labelsText.concat(labelElements.map(el => el?.textContent?.trim()).filter(Boolean));
            }
            data.associatedLabels = labelsText.join('; '); // Join multiple labels

            // Description Text (Combined)
            const describedBy = element.getAttribute('aria-describedby');
            if (describedBy) {
                const descElements = describedBy.split(' ').map(id => document.getElementById(id));
                data.description = descElements.map(el => el?.textContent?.trim()).filter(Boolean).join('; ');
            }

            // Location Info
            data.websiteOrigin = window.location.origin;
            data.fullUrl = window.location.href;

            // Form Info (Basic)
            if (element.form) {
                data.formInfo = {
                    id: element.form.id || null,
                    name: element.form.name || null
                };
            } else {
                data.formInfo = null;
            }

            console.log("GhostTab DEBUG: getContextData SUCCESS, returning data:", data); // Log success before return
            return data; // Return the populated data object

        } catch (error) {
            // Make catch log more prominent
            console.error("!!!!!!!! GhostTab: CRITICAL ERROR gathering context data: !!!!!!!!", error);
            return null; // Return null if data gathering fails
        }
    }

    // --- Modified Function: Send Data to Backend ---
    // Sends the provided data object to the backend URL stored in configuration
    function sendContextToBackend(contextData) {
        if (!contextData) {
            console.warn("GhostTab: Attempted to send null context data.");
            return;
        }

        // --- Get Backend URL from Storage ---
        // Define a default URL in case nothing is stored yet
        const defaultBackendUrl = 'http://localhost:5000/receive_context';

        // Check if Chrome APIs are available
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            // Use chrome.storage.sync.get to retrieve the saved URL
            chrome.storage.sync.get({
                backendUrl: defaultBackendUrl // Provide the default value here
            }, function(items) {
                const backendUrl = items.backendUrl; // Use the retrieved URL or the default

                if (!backendUrl) {
                    console.warn("GhostTab: Backend URL is not configured. Skipping sending data.");
                    return;
                }

                console.log(`GhostTab DEBUG: Attempting fetch to: ${backendUrl}`);

                console.log(`GhostTab: Sending context to configured backend: ${backendUrl}`, contextData);

                // Use the Fetch API to send a POST request
                fetch(backendUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(contextData)
                })
                .then(response => {
                    if (!response.ok) {
                        console.error(`GhostTab: Backend request failed! Status: ${response.status} ${response.statusText}`);
                        return response.text().then(text => { throw new Error(text || `Status ${response.status}`) });
                    }
                    console.log("GhostTab: Context sent successfully to backend.");
                })
                .catch(error => {
                    console.error('GhostTab: Error sending context data to backend:', error);
                });
            });
        } else {
            // Chrome API not available, use default URL
            console.warn("GhostTab: Chrome storage API not available, using default backend URL.");
            
            const backendUrl = defaultBackendUrl;
            console.log(`GhostTab: Sending context to default backend: ${backendUrl}`, contextData);
            
            // Use the Fetch API to send a POST request with default URL
            fetch(backendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(contextData)
            })
            .then(response => {
                if (!response.ok) {
                    console.error(`GhostTab: Backend request failed! Status: ${response.status} ${response.statusText}`);
                    return response.text().then(text => { throw new Error(text || `Status ${response.status}`) });
                }
                console.log("GhostTab: Context sent successfully to backend.");
            })
            .catch(error => {
                console.error('GhostTab: Error sending context data to backend:', error);
            });
        }
    }

    // --- Manual Trigger Handling ---
    function handleManualTrigger() {
        const focusedElement = document.activeElement;
        if (focusedElement && isEditable(focusedElement)) {
            console.log("Content: Manual trigger requested for active element:", focusedElement);
            // Ensure overlay and listeners are set up if this element wasn't the one most recently focused *by this script*
            // (This handles cases where focus might have been set programmatically without triggering focusin)
            if (activeTarget !== focusedElement) {
                // Clean up any old target first
                if (activeTarget) {
                    handleFocusOut({target: activeTarget});
                }
                // Set up for the currently focused element
                activeTarget = focusedElement;
                originalPlaceholder = activeTarget.getAttribute('placeholder');
                attachOverlay(activeTarget);
                activeTarget.addEventListener('input', updateOverlay, { passive: true });
                activeTarget.addEventListener('keydown', handleKeyDown);
                logElementInfo(activeTarget);
            }
            // Trigger the LLM request for the currently focused element
            triggerLLMRequest(focusedElement);
        } else {
            console.log("Content: Manual trigger requested, but no editable element has focus.");
        }
    }

    // --- New Functions for Processing Indicator ---
    function showProcessingIndicator() {
        // Remove existing indicator if any (shouldn't happen often, but safety check)
        hideProcessingIndicator(); 

        processingIndicator = document.createElement('div');
        processingIndicator.textContent = 'Processing...';
        
        // Apply styles for visibility (adjust as needed)
        processingIndicator.style.position = 'fixed';
        processingIndicator.style.top = '15px';
        processingIndicator.style.right = '15px';
        processingIndicator.style.padding = '5px 10px';
        processingIndicator.style.backgroundColor = 'rgba(240, 240, 240, 0.9)'; // Light grey
        processingIndicator.style.color = '#333';
        processingIndicator.style.border = '1px solid #ccc';
        processingIndicator.style.borderRadius = '4px';
        processingIndicator.style.zIndex = '2147483646'; // High, but below feedback div
        processingIndicator.style.fontSize = '12px';
        processingIndicator.style.fontFamily = 'sans-serif';
        processingIndicator.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)';

        document.body.appendChild(processingIndicator);
        console.log("DEBUG: Showing processing indicator.");
    }

    function hideProcessingIndicator() {
        if (processingIndicator) {
            if (processingIndicator.parentNode) {
                processingIndicator.parentNode.removeChild(processingIndicator);
            }
            processingIndicator = null; // Clear the reference
            console.log("DEBUG: Hiding processing indicator.");
        }
    }

    // --- LLM Request Trigger Function ---
    function triggerLLMRequest(targetElement, generationInstruction = null) {
        console.log("GhostTab DEBUG: triggerLLMRequest called. Instruction:", generationInstruction);

        const isGeneration = generationInstruction !== null;
        const actionType = isGeneration ? "Generation" : "Suggestion";

        showProcessingIndicator(); // Show indicator

        // Get context data *after* potential modification by handleInputForLLM
        const contextData = getContextData(targetElement);
        contextForCurrentSuggestion = contextData; // Store context for potential acceptance logging

        console.log(`GhostTab DEBUG: getContextData for ${actionType} returned:`, contextData);

        if (contextData) {
            console.log(`GhostTab: Sending context to background for LLM ${actionType}...`);
            chrome.runtime.sendMessage(
                {
                    action: 'getLLMSuggestions', // Keep same action name for background listener
                    contextData: contextData,
                    // Add explicit flags/data based on mode
                    isGenerationRequest: isGeneration,
                    instruction: generationInstruction // Will be null for suggestions
                },
                (response) => {
                    hideProcessingIndicator(); // Hide indicator on response

                    // --- Keep existing response handling logic ---
                    if (chrome.runtime.lastError) {
                        console.error("GhostTab LLM Error:", chrome.runtime.lastError.message);
                        currentSuggestions = [];
                        contextForCurrentSuggestion = null;
                        updateOverlay();
                        return;
                    }

                    if (response && response.success) {
                         console.log(`GhostTab: Received LLM ${actionType} response:`, response.suggestions);

                        if (response.suggestions && response.suggestions.length === 0 && !isGeneration) { // Only show feedback for empty *suggestions*
                            console.log("GhostTab: No relevant suggestions found. Displaying feedback.");
                            showTemporaryFeedback("More context needed for a suggestion.");
                            currentSuggestions = [];
                            contextForCurrentSuggestion = null;
                            currentWordIndex = 0;
                            updateOverlay();
                        } else {
                            // Handle valid suggestions OR generation results
                            currentSuggestions = response.suggestions || [];
                            currentSuggestionIndex = 0;
                            currentWordIndex = 0;
                            updateOverlay(); // Update overlay to show suggestion or generation result
                            // --- Auto-commit generation result? ---
                            // If it was a generation request and we got a result, potentially
                            // commit it immediately instead of showing as ghost text?
                            if (isGeneration && currentSuggestions.length > 0) {
                                console.log("Content: Auto-committing generation result.");
                                // We need to decide if we show generation as ghost text or insert directly.
                                // For now, let's just insert it directly.
                                commitFullSuggestion(true); // Pass a flag to indicate auto-commit
                            }
                             // --- End Auto-commit ---
                        }
                    } else {
                        console.warn(`GhostTab: Failed to get LLM ${actionType} response.`, response?.error);
                        currentSuggestions = [];
                        contextForCurrentSuggestion = null;
                        currentWordIndex = 0;
                        updateOverlay();
                    }
                    // --- End response handling ---
                }
            );
        } else {
            hideProcessingIndicator(); // Hide indicator if no context data
            console.warn(`GhostTab DEBUG: contextData is null or undefined, skipping LLM ${actionType} request.`);
            currentSuggestions = [];
            contextForCurrentSuggestion = null; // Clear context if request skipped
            currentWordIndex = 0;
            updateOverlay();
        }
    }

    // --- Word-by-Word Filling ---
    function handleFillWordByWord() {
        if (!activeTarget || !overlay || overlay.style.display === 'none') {
            console.log("WordFill: No active target or suggestion visible.");
            return;
        }

        const fullSuggestionText = currentSuggestions.length > 0 ? currentSuggestions[0] : null;
        if (!fullSuggestionText) {
             console.log("WordFill: No suggestion text available.");
             return;
        }

        // Handle potential starred replacement suggestion format
        let isReplacementSuggestion = fullSuggestionText.length > 1 && fullSuggestionText.startsWith('*') && fullSuggestionText.endsWith('*');
        let actualSuggestion = isReplacementSuggestion ? fullSuggestionText.substring(1, fullSuggestionText.length - 1) : fullSuggestionText;

        // Split suggestion into words (handle multiple spaces)
        const words = actualSuggestion.split(/\s+/).filter(word => word.length > 0);

        if (currentWordIndex >= words.length) {
            console.log("WordFill: No more words to fill.");
            // Optionally hide overlay and reset state here? Or let Tab handle the final clear.
            return;
        }

        const wordToFill = words[currentWordIndex];
        const textToAppend = wordToFill + ' '; // Append word and a space

        console.log(`WordFill: Appending word ${currentWordIndex + 1}: "${wordToFill}"`);

        // --- Determine if this is a replacement context ---
        const currentPrefix = getTextFromTarget(activeTarget);
        const isCommandPrefixNow = currentPrefix.length > 2 && currentPrefix.startsWith('*') && currentPrefix.endsWith('*');
        const replaceMode = isCommandPrefixNow || isReplacementSuggestion;
        // --- End replacement check ---

        if (replaceMode && currentWordIndex === 0) {
            // If it's the *first* word in replacement mode, replace the whole field content
            replaceText(activeTarget, textToAppend);
        } else {
            // Otherwise, append the word
            commitText(activeTarget, textToAppend);
        }

        currentWordIndex++;

        // --- Update Overlay --- 
        // Recalculate the remaining text based on words already filled
        const remainingWords = words.slice(currentWordIndex);
        const remainingText = remainingWords.join(' ');

        if (remainingText.length > 0) {
             overlay.textContent = remainingText;
             // Ensure overlay position is updated (might shift due to added word)
             updateOverlay(); // Call updateOverlay to reposition based on new prefix
        } else {
             console.log("WordFill: All words filled.");
             overlay.textContent = '';
             overlay.style.display = 'none';
             // Clear suggestion state as it's fully consumed
             currentSuggestions = [];
             currentSuggestionIndex = 0;
             currentWordIndex = 0;
             // Restore placeholder if needed
             if (originalPlaceholder !== null && !activeTarget.hasAttribute('placeholder')) {
                  activeTarget.setAttribute('placeholder', originalPlaceholder);
             }
        }
        // --- End Update Overlay ---
    }

    // --- Modified Commit Logic ---
    function commitFullSuggestion(isAutoCommit = false) {
        if (!activeTarget) {
            console.log("Commit: No active target.");
            return;
        }
        // Allow commit even if overlay isn't visible for auto-commit case
        if (!isAutoCommit && (!overlay || overlay.style.display === 'none')) {
            console.log("Commit: No suggestion visible to commit manually.");
            return;
        }

        // Get the suggestion text (either from overlay or stored suggestions for auto-commit)
        const suggestionToCommit = currentSuggestions.length > 0 ? currentSuggestions[0] : (overlay ? overlay.textContent : null);

        if (!suggestionToCommit) {
            console.log("Commit: No suggestion text found to commit.");
             // Clear state even if nothing to commit? Maybe not needed here.
            return;
        }

         // --- Existing logging and conditional logic ---
         const isSpreadsheet = isSpreadsheetContext(activeTarget);
         // Check original suggestion for TSV, not remainder/committed text
         const originalSuggestionTextForCheck = currentSuggestions.length > 0 ? currentSuggestions[0] : null;
         const suggestionIsTSV = originalSuggestionTextForCheck ? isTSV(originalSuggestionTextForCheck) : false;

         console.log(`Commit: Spreadsheet context? ${isSpreadsheet}, Suggestion is TSV? ${suggestionIsTSV}`);

         // Log Acceptance (if not auto-commit? Or always log if we have context?)
         // Let's log always if we have the needed info
         if (originalSuggestionTextForCheck && contextForCurrentSuggestion && activeTarget) {
              const domParentHierarchy = getDomHierarchy(activeTarget, 10);
              const nearbyContext = findNearbyContextualElements(activeTarget, 3);
              const logEntry = {
                 timestamp: new Date().toISOString(),
                 type: 'suggestion_accepted', // Log type might need update for generation?
                 context: contextForCurrentSuggestion,
                 suggestion: originalSuggestionTextForCheck,
                 domParentHierarchy: domParentHierarchy,
                 nearbyContext: nearbyContext
             };
             console.log("Content: Logging accepted suggestion/generation:", logEntry);
             try {
                  chrome.runtime.sendMessage({ action: 'logAcceptedSuggestion', data: logEntry });
             } catch (error) {
                  console.error("Content: Error sending log message to background:", error);
             }
         } else {
               console.warn("Commit: Cannot log acceptance - missing original suggestion, context, or activeTarget.");
         }


         // --- Conditional Action ---
         if (isSpreadsheet && suggestionIsTSV) {
            // Action: Copy TSV to clipboard
            console.log("Commit: Spreadsheet context and TSV data detected. Copying to clipboard...");
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(suggestionToCommit) // Use suggestionToCommit
                    .then(() => {
                        console.log("Commit: TSV data copied to clipboard. Please PASTE manually (Cmd/Ctrl+V) into the desired cell.");
                        showTemporaryFeedback("Copied! Press Cmd/Ctrl+V to paste."); // Simplified feedback
                    })
                    .catch(err => {
                        console.error('Commit: Failed to copy TSV data to clipboard:', err);
                    });
            } else {
                console.warn("Commit: Clipboard API (writeText) not available.");
            }
             // State clearing happens AFTER conditional action

         } else {
             // Action: Normal text commit/replace
             console.log("Commit: Performing standard text insertion.");
             // Replace or append? For generation, it usually replaces. For suggestions, it appends remainder.
             // Let's simplify: For now, `commitFullSuggestion` *appends* the full text.
             // If generation (`isAutoCommit`) needs replacement, we need more specific logic here or separate functions.
             // For now, let's assume we append the generated text after the cleaned precedingText.
             commitText(activeTarget, suggestionToCommit);
             console.log("Commit: Appended text.");
         }

         // --- Clear State --- 
         if(overlay) {
            overlay.style.display = 'none';
            overlay.textContent = '';
         }
         currentSuggestions = [];
         contextForCurrentSuggestion = null;
         currentSuggestionIndex = 0;
         currentWordIndex = 0;
         if (originalPlaceholder !== null && activeTarget && !activeTarget.hasAttribute('placeholder')) {
              activeTarget.setAttribute('placeholder', originalPlaceholder);
         }
         // --- End Clear State ---
    }

    // --- Helper Functions ---
    function isSpreadsheetContext(element) {
        console.log("GhostTab DEBUG: isSpreadsheetContext called with element:", element);
        if (!element) return false;
        const currentUrl = window.location.href;
        console.log("GhostTab DEBUG: currentUrl:", currentUrl);
        // Basic URL checks (can be expanded)
        if (currentUrl.includes('spreadsheets')) {
            // Google Sheets often uses role='gridcell' or elements within role='grid'/'spreadsheet'
            return true;
        }
        // Add checks for other spreadsheet apps if needed (e.g., Excel Online)
        // if (currentUrl.includes('onedrive.live.com') && element.closest('.cv-gvs')) { return true; }
        return false;
    }

    function isTSV(text) {
        console.log("--------------------------------");
        console.log("GhostTab ISTSV DEBUG: isTSV called with text:", text);
        // Simple check for presence of both tab and newline characters
        console.log(text.includes('\t'));
        console.log(text.includes('\n'));
        console.log(typeof text);
        console.log("--------------------------------");
        return typeof text === 'string' && text.includes('\t') && text.includes('\n');
    }

    // --- Temporary Feedback Display --- 
    function showTemporaryFeedback(message, duration = 2500, fadeDuration = 500) {
        // Remove existing feedback if any
        const existingFeedback = document.getElementById('ghosttab-feedback-div');
        if (existingFeedback) {
            existingFeedback.parentNode.removeChild(existingFeedback);
        }

        const feedbackDiv = document.createElement('div');
        feedbackDiv.id = 'ghosttab-feedback-div'; // Assign ID for removal
        feedbackDiv.textContent = message;

        // Apply styles (same as before, ensure consistency)
        feedbackDiv.style.position = 'fixed';
        feedbackDiv.style.top = '20px';
        feedbackDiv.style.left = '50%';
        feedbackDiv.style.transform = 'translateX(-50%)'; 
        feedbackDiv.style.padding = '10px 15px';
        feedbackDiv.style.backgroundColor = '#d4edda'; 
        feedbackDiv.style.color = '#155724'; 
        feedbackDiv.style.border = '1px solid #c3e6cb';
        feedbackDiv.style.borderRadius = '5px';
        feedbackDiv.style.zIndex = '2147483647'; 
        feedbackDiv.style.fontSize = '14px';
        feedbackDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        feedbackDiv.style.fontFamily = 'sans-serif';
        feedbackDiv.style.transition = `opacity ${fadeDuration / 1000}s ease-out`; 
        feedbackDiv.style.opacity = '1';

        document.body.appendChild(feedbackDiv);
        console.log("DEBUG: Added temporary feedback div with message:", message);

        // Remove the feedback div after a delay
        setTimeout(() => {
            feedbackDiv.style.opacity = '0'; // Start fade out
            setTimeout(() => { // Wait for fade out before removing
                    if (feedbackDiv.parentNode) { // Check again before removing
                    feedbackDiv.parentNode.removeChild(feedbackDiv);
                    console.log("DEBUG: Removed temporary feedback div.");
                }
            }, fadeDuration);
        }, duration);
    }

    // Log hierarchy when element gains focus
    function logElementHierarchy(element) {
        if (!element) return;
        console.groupCollapsed(`Hierarchy Info for: <${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}${element.className ? '.' + element.className.trim().replace(/\s+/g, '.') : ''}>`);
        try {
            // Log self
            console.log("Target:", element);

            // Log Parent
            const parent = element.parentElement;
            if (parent) {
                console.log(`Parent: <${parent.tagName.toLowerCase()}${parent.id ? '#' + parent.id : ''}${parent.className ? '.' + parent.className.trim().replace(/\s+/g, '.') : ''}>`, parent);
            } else {
                console.log("Parent: None");
            }

            // Log Siblings
            const prevSibling = element.previousElementSibling;
            const nextSibling = element.nextElementSibling;
            if (prevSibling) {
                 console.log(`Prev Sibling: <${prevSibling.tagName.toLowerCase()}${prevSibling.id ? '#' + prevSibling.id : ''}${prevSibling.className ? '.' + prevSibling.className.trim().replace(/\s+/g, '.') : ''}>`, prevSibling);
            } else {
                console.log("Prev Sibling: None");
            }
             if (nextSibling) {
                 console.log(`Next Sibling: <${nextSibling.tagName.toLowerCase()}${nextSibling.id ? '#' + nextSibling.id : ''}${nextSibling.className ? '.' + nextSibling.className.trim().replace(/\s+/g, '.') : ''}>`, nextSibling);
            } else {
                console.log("Next Sibling: None");
            }

            // Log Direct Children
            const children = element.children;
            if (children && children.length > 0) {
                console.log(`Children (${children.length}):`);
                // Log first few children to avoid clutter
                for (let i = 0; i < Math.min(children.length, 5); i++) {
                     const child = children[i];
                     console.log(`  - Child ${i}: <${child.tagName.toLowerCase()}${child.id ? '#' + child.id : ''}${child.className ? '.' + child.className.trim().replace(/\s+/g, '.') : ''}>`, child);
                }
                if (children.length > 5) {
                    console.log(`  ... (${children.length - 5} more)`);
                }
            } else {
                 console.log("Children: None");
            }

        } catch (e) {
            console.error("Error logging hierarchy:", e);
        }
        console.groupEnd();
    }

    // --- New DOM Hierarchy Capture Function ---
    /**
     * Captures the hierarchy of DOM elements up from a starting element.
     * @param {HTMLElement} element The starting element.
     * @param {number} maxLevels The maximum number of parent levels to capture.
     * @returns {Array<object>|null} An array of simplified element representations, or null if input is invalid.
     */
    function getDomHierarchy(element, maxLevels) {
        if (!element || !(element instanceof HTMLElement) || maxLevels <= 0) {
            return null;
        }

        const hierarchy = [];
        let currentElement = element;
        let level = 0;

        while (currentElement && level < maxLevels) {
            hierarchy.push({
                level: level,
                tagName: currentElement.tagName.toLowerCase(),
                id: currentElement.id || null,
                // Store classes as a string, handle potential SVGAnimatedString
                className: typeof currentElement.className === 'string' ? currentElement.className : (currentElement.className?.baseVal || '')
                // Add other attributes if needed, e.g., role, data-testid
                // role: currentElement.getAttribute('role') || null,
                // dataTestId: currentElement.getAttribute('data-testid') || null
            });

            currentElement = currentElement.parentElement;
            level++;
        }

        return hierarchy;
    }
    // --- End DOM Hierarchy Capture Function ---

    /**
     * Finds nearby elements (siblings, parent, parent's siblings) that have labels,
     * text content, or are editable fields themselves.
     * @param {HTMLElement} startElement The starting element.
     * @param {number} searchRange Max siblings/parent-siblings to check in each direction.
     * @returns {Array<object>} An array of simplified representations of relevant nearby elements.
     */
    function findNearbyContextualElements(startElement, searchRange) {
        const relevantElements = [];
        const visitedElements = new Set(); // Prevent processing the same element multiple times

        // Helper to check and add element if relevant
        const checkAndAdd = (el) => {
            if (!el || visitedElements.has(el)) {
                return;
            }
            visitedElements.add(el);

            let labelText = null;
            let textContent = (el.textContent || '').trim();
            let isEditableField = isEditable(el); // Use your existing isEditable function

            // Try finding associated labels
            if (el.labels && el.labels.length > 0) {
                labelText = Array.from(el.labels).map(lbl => lbl.textContent?.trim()).filter(Boolean).join('; ');
            } else if (el.getAttribute('aria-label')) {
                labelText = el.getAttribute('aria-label');
            } else if (el.getAttribute('aria-labelledby')) {
                const labelerIds = el.getAttribute('aria-labelledby').split(' ');
                labelText = labelerIds.map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join('; ');
            } else if (el.tagName === 'LABEL' && el.textContent?.trim()) {
                 labelText = el.textContent.trim(); // Label element itself
            }

            // Simple filter: Keep if it has a label, non-trivial text content (adjust length), OR is another editable field
            const hasMeaningfulText = textContent.length > 5; // Example threshold

            if (labelText || hasMeaningfulText || isEditableField) {
                 relevantElements.push({
                    tagName: el.tagName.toLowerCase(),
                    id: el.id || null,
                    className: typeof el.className === 'string' ? el.className : (el.className?.baseVal || ''),
                    label: labelText,
                    textContent: hasMeaningfulText ? textContent.substring(0, 100) : null, // Limit text length
                    isEditable: isEditableField,
                    // Optionally add relative position? (e.g., 'prevSibling', 'parent', 'parentNextSibling')
                 });
            }
        };

        // 1. Check Siblings
        let currentPrev = startElement.previousElementSibling;
        for (let i = 0; i < searchRange && currentPrev; i++) {
            checkAndAdd(currentPrev);
            currentPrev = currentPrev.previousElementSibling;
        }
        let currentNext = startElement.nextElementSibling;
        for (let i = 0; i < searchRange && currentNext; i++) {
            checkAndAdd(currentNext);
            currentNext = currentNext.nextElementSibling;
        }

        // 2. Check Parent and Parent's Siblings (e.g., up to 2 levels)
        let parent = startElement.parentElement;
        if (parent) {
            checkAndAdd(parent); // Check parent itself

            // Parent's siblings
            let parentPrev = parent.previousElementSibling;
            for (let i = 0; i < searchRange && parentPrev; i++) {
                checkAndAdd(parentPrev);
                parentPrev = parentPrev.previousElementSibling;
            }
            let parentNext = parent.nextElementSibling;
            for (let i = 0; i < searchRange && parentNext; i++) {
                checkAndAdd(parentNext);
                parentNext = parentNext.nextElementSibling;
            }

            // Optional: Go one level higher (Grandparent)
            let grandparent = parent.parentElement;
            if (grandparent) {
                checkAndAdd(grandparent);
                // Could add grandparent's siblings here too if desired
            }
        }

        return relevantElements;
    }
})();