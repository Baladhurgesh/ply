// --- Debug Flag ---
const DEBUG_MODE = false; // Set to true to enable LLM script logging

// --- Helper Debug Logging Functions ---
function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log("LLM LOG:", ...args);
    }
}
function debugWarn(...args) {
    if (DEBUG_MODE) {
        console.warn("LLM WARN:", ...args);
    }
}
function debugError(...args) {
    if (DEBUG_MODE) {
        console.error("LLM ERROR:", ...args);
    }
}

// --- Constants ---
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 4096; // Maximum tokens for Claude 3 Haiku
const MAX_HISTORY_ITEMS = 10; // Maximum number of history items to include in context
const MAX_CONTEXT_LENGTH = 2000; // Maximum characters of context to include
const MAX_SUGGESTIONS = 5; // Maximum number of suggestions to return

// --- Helper Functions ---
function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function formatClipboardHistory(history) {
    if (!history || !Array.isArray(history)) return '';
    return history
        .slice(0, MAX_HISTORY_ITEMS)
        .map(item => `- ${item.text}`)
        .join('\n');
}

function formatContext(contextData) {
    if (!contextData) return '';
    const { beforeCursor, afterCursor, selectedText } = contextData;
    let context = '';
    if (beforeCursor) context += `Before cursor: ${truncateText(beforeCursor, MAX_CONTEXT_LENGTH)}\n`;
    if (afterCursor) context += `After cursor: ${truncateText(afterCursor, MAX_CONTEXT_LENGTH)}\n`;
    if (selectedText) context += `Selected text: ${truncateText(selectedText, MAX_CONTEXT_LENGTH)}\n`;
    return context;
}

// --- Main LLM Function ---
async function getRelevantClipboardItems(contextData, clipboardHistory, apiKey, isGenerationRequest = false, instruction = null) {
    debugLog('LLM: Starting getRelevantClipboardItems');
    
    // Validate inputs
    if (!contextData) {
        debugError('LLM: Missing contextData');
        throw new Error('Missing context data');
    }
    if (!apiKey) {
        debugError('LLM: Missing API key');
        throw new Error('Missing API key');
    }

    try {
        // Format the context and history
        const formattedContext = formatContext(contextData);
        const formattedHistory = formatClipboardHistory(clipboardHistory);

        // Prepare the prompt based on the request type
        let systemPrompt, userPrompt;
        if (isGenerationRequest) {
            systemPrompt = `You are a helpful AI assistant that generates text based on the given context. 
                Generate ${MAX_SUGGESTIONS} relevant and contextually appropriate text completions.
                Each completion should be a complete, coherent piece of text that naturally follows the context.
                Return only the completions, one per line, without any additional text or numbering.`;
            
            userPrompt = `Context:\n${formattedContext}\n\nInstruction: ${instruction || 'Generate relevant completions'}\n\nCompletions:`;
        } else {
            systemPrompt = `You are a helpful AI assistant that suggests relevant clipboard items based on the given context.
                Analyze the context and clipboard history to suggest the most relevant items.
                Return only the most relevant items, one per line, without any additional text or numbering.
                Each item should be a complete, coherent piece of text from the clipboard history.`;
            
            userPrompt = `Context:\n${formattedContext}\n\nClipboard History:\n${formattedHistory}\n\nRelevant items:`;
        }

        debugLog('LLM: Sending request to Anthropic API');
        const response = await fetch(ANTHROPIC_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: MAX_TOKENS,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            debugError('LLM: API request failed', errorData);
            throw new Error(`API request failed: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        debugLog('LLM: Received response from API');

        // Process the response
        const content = data.content[0].text;
        const suggestions = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .slice(0, MAX_SUGGESTIONS);

        debugLog(`LLM: Returning ${suggestions.length} suggestions`);
        return suggestions;

    } catch (error) {
        debugError('LLM: Error in getRelevantClipboardItems', error);
        throw error;
    }
} 