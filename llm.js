// llm.js - Handles interaction with the Claude API

const CLAUDE_API_ENDPOINT = 'https://api.anthropic.com/v1/messages'; // Adjust if using a different endpoint/version
const CLAUDE_MODEL = 'claude-3-5-sonnet-20240620'; // Main model
const MAX_TOKENS_TO_SAMPLE = 150; // Keep low for single suggestion, adjust as needed
const MAX_TOKENS_FOR_FULL_RESPONSE = 2000; // Increased limit for generative tasks
const MAX_CLIPBOARD_ITEMS_FOR_PROMPT = 50; // Limit how many items we send to keep prompt size reasonable

// --- Site-Specific Formatting Rules (as per spec) ---
const FORMATTING_RULES = [
  {
    match: /mail\.google\.com|outlook\.live\.com|outlook\.office\.com/i, // Added outlook variants
    instructions: "Format the response as a professional email. Use appropriate greeting, clear body paragraphs, and a standard sign-off."
  },
  {
    match: /github\.com|gitlab\.com|bitbucket\.org|stackoverflow\.com/i, // Added alternatives
    instructions: "If including code samples, wrap them in markdown triple-backticks (\`\`\`) with the language identifier if known (e.g., \`\`\`python). Comment code concisely where necessary."
  },
  {
    match: /docs\.google\.com\/spreadsheets/i,
    instructions: "Output data strictly in Tab-Separated Values (TSV) format, using **actual \t tab characters** between columns, with each row on a new line. Do not include any surrounding text, code fences, or explanations. Example: Column1\tColumn2\tColumn3\nRow1\tRow2\tRow3"
  },
  {
    match: /linkedin\.com\/(feed|posts?)/i, // Match feed or post pages
    instructions: "Format the response as a LinkedIn post: start with a punchy first line (hook), use bullet points or short paragraphs for readability, include relevant hashtags if appropriate, and maintain a professional but engaging tone. Avoid corporate jargon."
  },
  // Add more rules here as needed
];
const DEFAULT_FORMATTING_INSTRUCTIONS = "Adapt the response format based on the input field context provided in the JSON below.";
// --- End Formatting Rules ---

// System prompts for different modes
const SYSTEM_PROMPT_SUGGEST = "You are an AI assistant suggesting relevant text for insertion based on context and clipboard history. Respond *only* with the JSON array containing zero or one suggested string, as per instructions.";
// Updated system prompt for generation mode
const SYSTEM_PROMPT_GENERATE = "You are an intelligent personal assistant. Your goal is to fulfill the user's instruction by logically synthesizing information from the provided input field context (JSON) and the user's recent clipboard history. Adapt your response format based on the context, as detailed in the user message. Respond *only* with a JSON array containing the single generated text string as its only element.";

/**
 * Calls the Claude API to get relevant clipboard items or generate content based on context.
 * @param {object} contextData - The context object from the content script.
 * @param {Array<object>} clipboardHistory - Array of {text: string, timestamp: string}.
 * @param {string} apiKey - The Anthropic API key.
 * @param {boolean} isFullResponseRequest - Explicitly indicates if generation is requested.
 * @param {string|null} instruction - The instruction for generation (null for suggestion).
 * @returns {Promise<Array<string>>} - A promise that resolves to an array containing a suggestion, generated content, or empty.
 */
async function getRelevantClipboardItems(contextData, clipboardHistory, apiKey, isFullResponseRequest, instruction) {
    if (!apiKey) {
        console.error("LLM Error: API key is missing.");
        return [];
    }

    // Log the determined mode
    console.log(`LLM Info: getRelevantClipboardItems called. Mode: ${isFullResponseRequest ? 'Generate' : 'Suggest'}. Instruction: ${instruction || 'N/A'}`);

    // Exit early if suggestion mode requested but no history provided
    if (!isFullResponseRequest && (!clipboardHistory || clipboardHistory.length === 0)) {
        console.log("LLM Info: Suggestion mode requested but no clipboard history provided.");
        return [];
    }

    // Limit the number of history items sent (still relevant for both modes if history exists)
    const relevantHistory = clipboardHistory ? clipboardHistory.slice(0, MAX_CLIPBOARD_ITEMS_FOR_PROMPT) : [];

    // --- Get separated prompt parts (pass explicit mode/instruction) ---
    const {
        staticBoilerplate,
        dynamicContextJsonString,
        dynamicHistoryString,
        dynamicTaskInstruction // Will be populated based on passed-in instruction
    } = constructPromptParts(contextData, relevantHistory, isFullResponseRequest, instruction); // Pass params through

    // --- Assemble multi-block user message for caching ---
    const userContentBlocks = [];
    // Block 1: Static Boilerplate (Cacheable)
    userContentBlocks.push({ type: "text", text: staticBoilerplate });
    // Block 2: Dynamic Context (Not Cacheable)
    userContentBlocks.push({ type: "text", text: "\n\nCurrent Input Field Context:\n" + dynamicContextJsonString });
    // Block 3: Dynamic History (Not Cacheable)
    // Prefix text is already included in dynamicHistoryString by constructPromptParts
    userContentBlocks.push({ type: "text", text: "\n\n" + dynamicHistoryString });
    // Block 4: Dynamic Task Instruction (Not Cacheable - only if present)
    if (dynamicTaskInstruction)
    {
        // Prefix text is already included in dynamicTaskInstruction by constructPromptParts
        userContentBlocks.push({ type: "text", text: "\n\n" + dynamicTaskInstruction });
    }
    const messages = [{ role: "user", content: userContentBlocks }];
    // --- End multi-block assembly ---

    // Determine API parameters based on request type
    const systemPrompt = isFullResponseRequest ? SYSTEM_PROMPT_GENERATE : SYSTEM_PROMPT_SUGGEST;
    const maxTokens = isFullResponseRequest ? MAX_TOKENS_FOR_FULL_RESPONSE : MAX_TOKENS_TO_SAMPLE;
    const temperature = isFullResponseRequest ? 0.5 : 0.3; // Slightly higher temp for generation

    console.log(`LLM DEBUG: Sending request. Mode: ${isFullResponseRequest ? 'Generate' : 'Suggest'}, System: ${systemPrompt}, Max Tokens: ${maxTokens}, Temp: ${temperature}`);
    // Log the re-assembled message for debugging consistency with previous version - REMOVED as userMessageContent no longer exists
    // console.log("LLM DEBUG: (Re-assembled) User message:", userMessageContent);

    // --- Log the full request body before sending ---
    const requestBody = {
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        temperature: temperature,
        system: systemPrompt,
        messages: messages // Use the new multi-block messages array
    };
    console.log("LLM DEBUG: Full API Request Body: (Using console.error)", JSON.stringify(requestBody, null, 2));
    // console.log("LLM DEBUG: Full API Request Body Object:", requestBody); // Alternative: log the object itself
    // --- End log ---

    try
    {
        const response = await fetch(CLAUDE_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01', // Required header
                'anthropic-dangerous-direct-browser-access': 'true' // Add this header
            },
            body: JSON.stringify(requestBody), // Use the constructed body object
        });

        if (!response.ok)
        {
            const errorBody = await response.text();
            console.error(`LLM Error: API request failed with status ${response.status}: ${errorBody}`);
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        // console.log("LLM DEBUG: Received raw response from Claude:", data); // Log raw response

        if (data.content && data.content.length > 0 && data.content[0].type === 'text')
        {
             const resultText = data.content[0].text.trim();
             console.log("LLM DEBUG: Extracted text content:", resultText);
             // Attempt to parse the result as JSON
             try
             {
                 // Handle potential markdown ```json ... ``` block
                 let jsonString = resultText;
                 if (jsonString.startsWith("```json"))
                 {
                    jsonString = jsonString.substring(7);
                    if (jsonString.endsWith("```"))
                    {
                        jsonString = jsonString.substring(0, jsonString.length - 3);
                    }
                 }
                 jsonString = jsonString.trim(); // Trim again

                 // --- Preprocessing to handle unescaped newlines --- 
                 // Check if it looks like our expected single-string array format
                 if (jsonString.startsWith('["') && jsonString.endsWith('"]') && jsonString.length >= 4) {
                     // Extract the inner content
                     const innerContent = jsonString.substring(2, jsonString.length - 2);
                     // Escape newlines and potentially other problematic chars within the inner content
                     const escapedContent = innerContent
                         .replace(/\\/g, '\\\\') // Escape backslashes first
                         .replace(/"/g, '\\"')   // Escape double quotes
                         .replace(/\n/g, '\\n')  // Escape newlines
                         .replace(/\r/g, '\\r')  // Escape carriage returns
                         .replace(/\t/g, '\\t'); // Escape tabs
                     // Reconstruct the valid JSON string
                     jsonString = '["' + escapedContent + '"]';
                     console.log("LLM DEBUG: Preprocessed jsonString for parsing:", jsonString);
                 } else {
                     console.log("LLM DEBUG: String does not match expected [\"...\"] format, attempting direct parse.");
                 }
                 // --- End Preprocessing ---

                 // Ensure non-empty string before parsing
                 if (!jsonString) {
                    console.warn("LLM Warning: Received empty string after trimming potentially wrapped JSON.");
                    // If generation mode expected something, returning [] might be wrong?
                    // But the prompt asks for ["string"], so [] is technically valid JSON result.
                    // Let caller handle empty array if it means failure for generation.
                    return [];
                 }

                 const parsedResult = JSON.parse(jsonString);

                 // Validate format: Expecting ["string"] or [] for suggestions, ["string"] for generation
                 if (Array.isArray(parsedResult) && parsedResult.length <= 1 && (parsedResult.length === 0 || typeof parsedResult[0] === 'string'))
                 {
                    // For generation mode, ensure we didn't get an empty array unless intended (which it shouldn't be based on prompt)
                    if (isFullResponseRequest && parsedResult.length === 0) { 
                        console.warn("LLM Warning: Full response request resulted in an empty array. Returning as is, but check Claude's reasoning if this is unexpected.");
                    }
                    return parsedResult;
                 } else {
                     console.warn("LLM Warning: Parsed result is not a valid array with 0 or 1 string:", parsedResult);
                     return []; // Return empty if format is wrong
                 }
             } catch (parseError)
             {
                 console.error("LLM Error: Failed to parse Claude's response as JSON:", parseError, "Response text:", resultText);

                 // --- Special handling for Spreadsheet context on parse error ---
                 // Use the spreadsheet regex from FORMATTING_RULES for consistency
                 const spreadsheetRule = FORMATTING_RULES.find(rule => rule.instructions.includes('Tab-Separated Values'));
                 const isSpreadsheet = spreadsheetRule && spreadsheetRule.match.test(contextData?.url || '');

                 if (isSpreadsheet) {
                     console.log("LLM Info: JSON parse failed, but context is a spreadsheet. Attempting to extract potential raw/TSV data.");
                     let potentialRawData = resultText.trim();
                     // If it started like JSON array but failed, try stripping the likely prefix/suffix
                     if (potentialRawData.startsWith('["')) {
                         potentialRawData = potentialRawData.substring(2);
                         if (potentialRawData.endsWith('"]')) { // Check if suffix exists and remove
                             potentialRawData = potentialRawData.substring(0, potentialRawData.length - 2);
                         }
                     }
                     // Further cleanup might involve unescaping JSON escapes if needed, but start simple
                     const cleanedData = potentialRawData.trim();
                     console.log("LLM Warning: Returning potentially raw data extracted after JSON parse failure for spreadsheet:", cleanedData);
                     return [cleanedData]; // Return extracted content wrapped in array
                 } else {
                     // Not a spreadsheet context, or parse failed for other reasons.
                     // Log based on whether it looked like malformed JSON or not
                     const trimmedResult = resultText.trim();
                     if (trimmedResult && (trimmedResult.startsWith('[') || trimmedResult.startsWith('{'))) {
                          console.warn("LLM Warning: JSON parse failed for text that appears to be malformed JSON (and not in spreadsheet context). Returning empty.");
                     } else {
                          console.warn("LLM Warning: JSON parse failed for unexpected raw text (not in spreadsheet context). Returning empty.");
                     }
                     return [];
                 }
                 // --- End Special Handling ---
             }
         } else
         {
             console.warn("LLM Warning: No text content found in Claude's response:", data);
             return [];
         }

    } catch (error)
    {
        console.error("LLM Error: Error during API call or processing:", error);
        return []; // Return empty array on error
    }
}

/**
 * Generates the static boilerplate portion of the prompt.
 * @param {boolean} isFullResponseRequest - Flag indicating the mode.
 * @param {string | null} instruction - The user instruction (for generation mode).
 * @returns {string} - The static boilerplate text.
 */
function getStaticBoilerplateText(isFullResponseRequest, instruction) {
    if (isFullResponseRequest) {
        // Static part for Generation mode
        // Includes determining site-specific instructions based *only* on URL if available
        // (Assumes contextData is needed for the URL, which means it's slightly less static,
        // but the core instructions and formatting guidelines are static)
        let dynamicFormattingInstructions = DEFAULT_FORMATTING_INSTRUCTIONS; // Start with default
        // We need the URL here to determine formatting rules
        // This slightly deviates from pure static, but necessary for format instructions
        // const urlString = contextData?.url || contextData?.fullUrl || ''; // Get URL safely - MOVED OUT
        // if (urlString) {
        //     try {
        //         const url = new URL(urlString);
        //         const siteIdentifier = url.hostname + url.pathname;
        //         for (const rule of FORMATTING_RULES) {
        //           if (rule.match.test(siteIdentifier)) {
        //             dynamicFormattingInstructions = rule.instructions;
        //             break;
        //           }
        //         }
        //     } catch (e) {
        //         console.warn("LLM constructPrompt (static part): Could not parse URL for formatting rules:", urlString, e);
        //     }
        // }
        // NOTE: The formatting instructions *themselves* are static, but *which one* is chosen depends on the URL.
        // We'll handle selecting the correct instruction *outside* this static function.

        return `You are an intelligent personal assistant fulfilling a user request by logically synthesizing information from context and clipboard history, adapting your output format as needed.
The user's specific instruction for this request is provided separately below.
The current input field context and relevant clipboard history are also provided separately below.

Your Task Guidelines:
1. Carefully understand the user's specific instruction (provided below).
2. Analyze the provided 'Current Input Field Context' JSON (provided below) to understand the situation (element tag, type, label, url, etc.).
3. Review the 'Recent Clipboard History' (provided below). Logically relate items in the history to the instruction and the context. Synthesize relevant information from the history to fulfill the request.
4. Generate the requested content. Follow the site-specific formatting guidelines (provided below based on the context's URL).
5. Respond *only* with a JSON array containing the single, complete, contextually-formatted generated text string as its only element.
6. Do not include the original instruction or any explanations in your response string. Just provide the generated text.
7. If the history is irrelevant or insufficient, do your best based on the instruction and context alone.
`;
    } else {
        // Static part for Suggestion mode
        return `You are an AI assistant providing intelligent text insertion suggestions for a browser extension. Your task is to suggest the single most likely string value the user wants to insert *immediately following* the text currently in the input field ('value' in the JSON context below), based on the field's context description (JSON below) and recent clipboard history (provided below).

Based *only* on the provided context JSON and clipboard history:
1. Determine the most relevant piece of information from the clipboard history that could logically complete or follow the 'value' in the context JSON.
2. You *can and should* modify the clipboard item if appropriate. For example, extract just an email address, a phone number, a specific ID, the remainder of a sentence, or a relevant phrase from a larger copied text block. You can also return an item unmodified if it's the best fit for completing the current value.
3. Return a JSON array containing *only the single best suggested string value* to insert *after* the current content.
4. If no clipboard item seems relevant or appropriate for completing the current field value, return an empty JSON array ([]).
5. Respond *only* with the JSON array (containing zero or one string element), and nothing else. No explanations.

Example Context:
${JSON.stringify({ tag: "INPUT", type: "email", id: "user_email", label: "Email Address", value: "test@" }, null, 2)}
Example History: ["1. test@example.com"]
Example Output: ["example.com"]

Example Context:
${JSON.stringify({ tag: "TEXTAREA", label: "Comments", value: "My name is" }, null, 2)}
Example History: ["1. My name is Claude."]
Example Output: [" Claude."]

Example Context:
${JSON.stringify({ tag: "INPUT", type: "text", label: "First Name", value: "" }, null, 2)}
Example History: ["1. Full Name: John Doe"]
Example Output: ["John Doe"]

Example Context:
${JSON.stringify({ tag: "INPUT", type: "text", value: "abc" }, null, 2)}
Example History: ["1. unrelated@email.com"]
Example Output: []
`; // End of suggestion mode static part
    }
}

/**
 * Constructs the different parts of the user message content for the Claude API prompt.
 * Separates static boilerplate from dynamic context, history, and instructions.
 * @param {object} contextData - The raw context object.
 * @param {Array<object>} historyItems - The clipboard items to consider.
 * @param {boolean} isFullResponseRequest - Flag indicating if a full response is requested.
 * @param {string | null} instruction - The instruction extracted from the input field, if any.
 * @returns {object} - An object containing { staticBoilerplate, dynamicContextJsonString, dynamicHistoryString, dynamicTaskInstruction }.
 */
function constructPromptParts(contextData, historyItems, isFullResponseRequest, instruction) {
    // --- 1. Generate Dynamic Context JSON ---
    const simplifiedContext = {};
    if (contextData) {
        const currentValueSource = contextData?.current_field_value_for_suggestion !== undefined
            ? contextData.current_field_value_for_suggestion
            : contextData?.currentValue !== undefined
                ? contextData.currentValue
                : contextData?.currentTextContent !== undefined
                    ? contextData.currentTextContent
                    : '';
        const currentVal = String(currentValueSource).trim();

        simplifiedContext.tag = contextData.tagName || null;
        simplifiedContext.type = contextData.inputType || contextData.type || null;
        simplifiedContext.id = contextData.inputId || contextData.id || null;

        let label = contextData.ariaLabel || null;
        if (!label && Array.isArray(contextData.associatedLabels) && contextData.associatedLabels.length > 0) {
            label = contextData.associatedLabels[0];
        }
        if (!label) {
            label = contextData.inputName || null;
        }
        simplifiedContext.label = label ? String(label).trim() : null;

        simplifiedContext.value = currentVal;
        simplifiedContext.url = contextData.url || contextData.fullUrl || null;

        if (contextData.associatedLabels && typeof contextData.associatedLabels === 'string' && contextData.associatedLabels.trim().length > 0) {
            simplifiedContext.associatedLabelsText = contextData.associatedLabels.trim();
        } else {
             simplifiedContext.associatedLabelsText = null;
        }

        Object.keys(simplifiedContext).forEach(key => {
            if (simplifiedContext[key] === null || simplifiedContext[key] === undefined) {
                if (simplifiedContext[key] !== "") {
                   delete simplifiedContext[key];
                }
            }
        });

        if (contextData.pageTitle) simplifiedContext.pageTitle = contextData.pageTitle;
        if (contextData.mainHeading) simplifiedContext.mainHeading = contextData.mainHeading;
        if (contextData.selectedTextOnPage) simplifiedContext.selectedTextOnPage = contextData.selectedTextOnPage;
    }
    const dynamicContextJsonString = JSON.stringify(simplifiedContext, null, 2);

    // --- 2. Generate Dynamic History String ---
    let dynamicHistoryString = "Recent Clipboard History (most recent first, items truncated for brevity):";
    if (!historyItems || historyItems.length === 0)
    {
        dynamicHistoryString += "\n(No clipboard items provided)";
    } else
    {
        historyItems.forEach((item, index) =>
        {
            dynamicHistoryString += `\n${index + 1}. ${JSON.stringify(item.text)}`;
        });
    }

    // --- 3. Generate Dynamic Task Instruction (only for generation mode) ---
    let dynamicTaskInstruction = "";
    let staticBoilerplate = "";

    if (isFullResponseRequest && instruction) { // Check instruction exists
        // Determine site-specific formatting instructions (dynamic based on URL)
        let formattingInstructions = DEFAULT_FORMATTING_INSTRUCTIONS;
        let siteMatch = 'default';
        if (simplifiedContext.url) {
            try {
                const url = new URL(simplifiedContext.url);
                const siteIdentifier = url.hostname + url.pathname;
                for (const rule of FORMATTING_RULES) {
                    if (rule.match.test(siteIdentifier)) {
                        formattingInstructions = rule.instructions;
                        siteMatch = rule.match.toString();
                        break;
                    }
                }
            } catch (e) {
                console.warn("LLM constructPromptParts: Could not parse URL for formatting rules:", simplifiedContext.url, e);
            }
        }
        console.log(`LLM constructPromptParts: Using formatting rule [${siteMatch}]: "${formattingInstructions}"`);

        // Get static part and add dynamic formatting instructions to the task
        staticBoilerplate = getStaticBoilerplateText(true, instruction); // Pass true for generation mode

        // Use the PASSED-IN instruction here
        dynamicTaskInstruction = `Specific User Instruction: "${instruction}"\nFormatting Guideline: ${formattingInstructions}`;

    } else {
        // Suggestion mode: No specific task instruction needed here.
        staticBoilerplate = getStaticBoilerplateText(false, null); // Pass false for suggestion mode
        dynamicTaskInstruction = ""; // Empty for suggestion mode
    }


    // --- 4. Return Separated Parts ---
    return {
        staticBoilerplate,
        dynamicContextJsonString,
        dynamicHistoryString,
        dynamicTaskInstruction
    };
}

// Export the function if using modules (optional for simple scripts)
// export { getRelevantClipboardItems }; 