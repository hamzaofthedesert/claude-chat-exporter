function setupClaudeExporter() {
  const originalWriteText = navigator.clipboard.writeText;
  const capturedResponses = [];
  const humanMessages = [];
  let interceptorActive = true;

  // DOM Selectors
  const SELECTORS = {
    userMessage: '[data-testid="user-message"]',
    messageGroup: '.group',
    copyButton: 'button[data-testid="action-bar-copy"]',
    editButton: 'button[aria-label="Edit"]',
    editTextarea: 'textarea',
    conversationTitle: '[data-testid="chat-title-button"] .truncate, button[data-testid="chat-title-button"] div.truncate',
    
    // Pasted document selectors - use attribute selector for complex class names
    pastedDocPreview: 'p[class*="line-clamp"], p[class*="text-text-500"]',
    expandedDocContent: 'div[class*="overflow-y-auto"][class*="font-mono"]'
  };

  const DELAYS = {
    hover: 50,
    edit: 150,
    copy: 100,
    expand: 400  // For pasted doc expansion
  };

  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getConversationTitle() {
    const titleElement = document.querySelector(SELECTORS.conversationTitle);
    const title = titleElement?.textContent?.trim();

    if (!title || title === 'Claude' || title.includes('New conversation')) {
      return 'claude_conversation';
    }

    return title
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .substring(0, 100);
  }

  async function extractPastedDocuments(messageContainer) {
    const documents = [];
    
    try {
      console.log('🔍 Starting pasted document extraction...');
      
      // Strategy 1: Search within the same message group
      const messageGroup = messageContainer.closest(SELECTORS.messageGroup);
      
      if (!messageGroup) {
        console.warn('⚠️ User message not found within a message group');
        return documents;
      }
      
      console.log('📦 Message group found:', messageGroup.className);
      
      let preview = messageGroup.querySelector(SELECTORS.pastedDocPreview);
      
      // Strategy 2: Check sibling groups
      if (!preview) {
        console.log('🔍 Not in same group, checking ALL nearby groups...');
        
        // Go to parent and search ALL descendants
        const parentContainer = messageGroup.parentElement;
        if (parentContainer) {
          // Search for ANY p element with line-clamp
          const allPreviews = parentContainer.querySelectorAll('p[class*="line-clamp"]');
          console.log(`Found ${allPreviews.length} potential pasted doc previews`);
          
          if (allPreviews.length > 0) {
            // Take the first one (or most recent)
            preview = allPreviews[0];
            console.log('✅ Using first found preview');
          }
        }
      }
      
      // Strategy 3: Nuclear option - search entire document
      if (!preview) {
        console.log('🔍 Last resort: searching entire document...');
        const allPreviews = document.querySelectorAll('p[class*="line-clamp"]');
        console.log(`Found ${allPreviews.length} previews in entire document`);
        
        if (allPreviews.length > 0) {
          preview = allPreviews[0];
          console.log('⚠️ Using first preview from document-wide search');
        }
      }
      
      if (!preview) {
        console.log('ℹ️ No pasted document preview found anywhere');
        return documents;
      }
      
      console.log('📄 Found pasted document preview, expanding...');
      console.log('Preview classes:', preview.className);
      console.log('Preview text:', preview.textContent.substring(0, 100));
      
      // Click to expand
      preview.click();
      await delay(DELAYS.expand);
      
      // Find expanded content - try multiple selectors
      const selectors = [
        'div[class*="overflow-y-auto"][class*="font-mono"]',
        'div[class*="whitespace-pre-wrap"][class*="overflow-y-auto"]',
        '.bg-bg-000.rounded-lg.overflow-y-auto',
        // Also try without font-mono requirement
        'div[class*="overflow-y-auto"][class*="bg-bg-000"]'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        console.log(`🔎 Trying selector "${selector}": found ${elements.length} elements`);
        
        for (const el of elements) {
          const text = el.textContent?.trim();
          if (text && text.length > 500) {
            console.log(`✅ Extracted pasted document (${text.length} chars)`);
            documents.push(text);
            
            // Close the expanded view
            preview.click();
            await delay(DELAYS.hover);
            
            return documents;
          }
        }
      }
      
      console.warn('⚠️ Pasted document preview found but could not extract expanded content');
      console.log('Tried all selectors but found no large text blocks');
      
    } catch (error) {
      console.error('❌ Failed to extract pasted document:', error);
    }
    
    return documents;
  }

  async function extractMessageContent(messageContainer, messageIndex) {
    try {
      let fullContent = '';
      
      console.log(`\n--- Extracting message ${messageIndex + 1} ---`);
      
      // STEP 1: Extract pasted documents FIRST (before edit mode)
      const pastedDocs = await extractPastedDocuments(messageContainer);
      console.log(`Found ${pastedDocs.length} pasted documents`);
      
      // STEP 2: Extract textarea content via edit mode
      messageContainer.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await delay(DELAYS.hover);

      const messageGroup = messageContainer.closest(SELECTORS.messageGroup);
      const editButton = messageGroup?.querySelector(SELECTORS.editButton);

      if (editButton) {
        console.log(`📝 Clicking edit button for message ${messageIndex + 1}`);
        editButton.click();
        await delay(DELAYS.edit);

        const editTextarea = document.querySelector(SELECTORS.editTextarea);

        if (editTextarea) {
          fullContent = editTextarea.value;
          console.log(`✅ Got textarea content: ${fullContent.length} chars`);
        } else {
          console.warn('⚠️ Edit textarea not found');
        }

        // Close edit mode
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await delay(DELAYS.hover);
      } else {
        console.warn('⚠️ Edit button not found');
      }

      // STEP 3: Combine textarea + pasted documents
      if (pastedDocs.length > 0) {
        const docsText = pastedDocs.map((doc, i) => 
          `\n\n---\n\n**[Pasted Document ${i + 1}]**\n\n${doc}`
        ).join('');
        
        fullContent = fullContent ? fullContent + docsText : docsText;
        console.log(`✅ Combined content: ${fullContent.length} chars total`);
      }

      if (fullContent) {
        console.log(`✅ Successfully extracted message ${messageIndex + 1}`);
        return fullContent;
      }

      throw new Error(`Could not extract content (no textarea and no pasted docs)`);

    } catch (error) {
      console.error(`❌ Failed to extract message ${messageIndex + 1}:`, error);
      return null;
    } finally {
      messageContainer.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    }
  }

  async function extractAllHumanMessages() {
    const userMessages = document.querySelectorAll(SELECTORS.userMessage);

    console.log(`🔄 Extracting ${userMessages.length} human messages...`);

    for (let i = 0; i < userMessages.length; i++) {
      const content = await extractMessageContent(userMessages[i], i);
      if (content) {
        humanMessages.push({
          type: 'user',
          content: content,
          index: i
        });
        updateStatus();
      }
    }

    console.log(`✅ Extracted ${humanMessages.length} human messages`);
  }

  // Intercept clipboard writes for Claude responses
  navigator.clipboard.writeText = function(text) {
    if (interceptorActive && text && text.length > 20) {
      console.log(`📋 Captured Claude response ${capturedResponses.length + 1}`);
      capturedResponses.push({
        type: 'claude',
        content: text,
        timestamp: Date.now()
      });
      updateStatus();
    }
  };

  // Create status indicator
  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = `
    position: fixed; top: 10px; right: 10px; z-index: 10000;
    background: #2196F3; color: white; padding: 10px 15px;
    border-radius: 5px; font-family: monospace; font-size: 12px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3); max-width: 300px;
  `;
  document.body.appendChild(statusDiv);

  function updateStatus() {
    statusDiv.textContent = `Human: ${humanMessages.length} | Claude: ${capturedResponses.length}`;
  }

  async function triggerClaudeResponseCopy() {
    const copyButtons = document.querySelectorAll(SELECTORS.copyButton);

    if (copyButtons.length === 0) {
      throw new Error('No Claude copy buttons found!');
    }

    console.log(`🚀 Clicking ${copyButtons.length} Claude copy buttons...`);

    for (let i = 0; i < copyButtons.length; i++) {
      const button = copyButtons[i];
      try {
        if (button.offsetParent !== null) {
          button.scrollIntoView({ behavior: 'instant', block: 'nearest' });
          button.click();
          console.log(`🖱️ Clicked copy button ${i + 1}/${copyButtons.length}`);
        }
      } catch (error) {
        console.warn(`Failed to click button ${i + 1}:`, error);
      }

      if (i < copyButtons.length - 1) {
        await delay(DELAYS.copy);
      }
    }
  }

  function buildMarkdown() {
    let markdown = "# Conversation Export\n\n";
    
    // Interleave messages in chronological order
    const maxLength = Math.max(humanMessages.length, capturedResponses.length);

    for (let i = 0; i < maxLength; i++) {
      // Add human message if it exists
      if (i < humanMessages.length && humanMessages[i].content) {
        markdown += `${humanMessages[i].content}\n\n---gmpu.end---\n\n`;
      }
      
      // Add Claude response if it exists
      if (i < capturedResponses.length) {
        markdown += `${capturedResponses[i].content}\n\n---gmpu.end---\n\n`;
      }
    }

    return markdown;
  }

  async function waitForClipboardOperations(expectedCount) {
    const maxWaitTime = 2000;
    const checkInterval = 100;
    let elapsed = 0;

    while (elapsed < maxWaitTime) {
      if (capturedResponses.length >= expectedCount) {
        console.log(`✅ All ${expectedCount} responses captured in ${elapsed}ms`);
        return;
      }
      await delay(checkInterval);
      elapsed += checkInterval;
    }

    console.warn(`⚠️ Timeout: Only captured ${capturedResponses.length}/${expectedCount} responses`);
  }

  async function startExport() {
    try {
      statusDiv.textContent = 'Extracting human messages...';
      await extractAllHumanMessages();

      statusDiv.textContent = 'Copying Claude responses...';
      await triggerClaudeResponseCopy();

      const copyButtons = document.querySelectorAll(SELECTORS.copyButton);
      await waitForClipboardOperations(copyButtons.length);

      completeExport();

    } catch (error) {
      statusDiv.textContent = `Error: ${error.message}`;
      statusDiv.style.background = '#f44336';
      console.error('Export failed:', error);
    } finally {
      setTimeout(cleanup, 3000);
    }
  }

  function completeExport() {
    interceptorActive = false;

    if (humanMessages.length === 0 && capturedResponses.length === 0) {
      statusDiv.textContent = 'No messages captured!';
      statusDiv.style.background = '#f44336';
      return;
    }

    const markdown = buildMarkdown();
    const filename = `${getConversationTitle()}.md`;
    downloadMarkdown(markdown, filename);

    statusDiv.textContent = `✅ Downloaded: ${filename}`;
    statusDiv.style.background = '#4CAF50';

    console.log('🎉 Export complete!');
  }

  function cleanup() {
    navigator.clipboard.writeText = originalWriteText;
    if (document.body.contains(statusDiv)) {
      document.body.removeChild(statusDiv);
    }
  }

  // Initialize
  updateStatus();
  setTimeout(startExport, 1000);
}

// Run the exporter
setupClaudeExporter();
