/**
 * PipelineAIDialog - Handles the AI question dialog for effectors
 * Manages the UI for asking AI about plugin functionality
 */
export class PipelineAIDialog {
    /**
     * Create a new PipelineAIDialog instance
     * @param {PipelineCore} pipelineCore - Reference to pipeline core instance
     */
    constructor(pipelineCore) {
        this.pipelineCore = pipelineCore;
        this.pluginManager = pipelineCore.pluginManager;
    }

    /**
     * Show the AI dialog for a plugin
     * @param {Object} plugin - The plugin to ask AI about
     * @param {HTMLElement} button - The button that was clicked
     */
    showAIDialog(plugin, button) {
        // Remove any existing dialog
        const existingDialog = document.querySelector('.ai-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }
        
        // Create dialog
        const dialog = document.createElement('div');
        dialog.className = 'ai-dialog';
        
        // Create dialog header
        const header = this.createDialogHeader();
        dialog.appendChild(header);
        
        // Create caption
        const caption = this.createCaption(plugin);
        dialog.appendChild(caption);
        
        // Create text input area
        const textArea = this.createTextArea();
        dialog.appendChild(textArea);
        
        // Create button container
        const buttonContainer = this.createButtonContainer(plugin, textArea);
        dialog.appendChild(buttonContainer);
        
        // Position the dialog
        this.positionDialog(dialog);
        
        // Add dialog to the document
        document.body.appendChild(dialog);
        
        // Setup close handler
        this.setupCloseHandler(dialog);
        
        // Focus the text area
        textArea.focus();
    }

    /**
     * Create dialog header with close button
     * @returns {HTMLElement} The header element
     */
    createDialogHeader() {
        const header = document.createElement('div');
        header.className = 'ai-dialog-header';
        header.textContent = window.uiManager
            ? window.uiManager.t('ui.askAITitle')
            : 'Ask the AI about this effector';
        
        // Create close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ai-dialog-close';
        closeBtn.textContent = '✕';
        closeBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.close')
            : 'Close';
        closeBtn.onclick = () => {
            const dialog = document.querySelector('.ai-dialog');
            if (dialog) dialog.remove();
        };
        header.appendChild(closeBtn);
        
        return header;
    }

    /**
     * Create caption with effector name
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The caption element
     */
    createCaption(plugin) {
        const caption = document.createElement('div');
        caption.className = 'ai-dialog-caption';
        caption.textContent = window.uiManager
            ? window.uiManager.t('ui.askAICaption', { effectName: plugin.name })
            : `Question about ${plugin.name}:`;
        return caption;
    }

    /**
     * Create text input area
     * @returns {HTMLElement} The text area element
     */
    createTextArea() {
        const textArea = document.createElement('textarea');
        textArea.className = 'ai-dialog-textarea';
        textArea.placeholder = window.uiManager
            ? window.uiManager.t('ui.askAIPlaceholder')
            : 'Type your question about this effect...';
        textArea.rows = 4;
        return textArea;
    }

    /**
     * Create button container with ChatGPT and Perplexity buttons
     * @param {Object} plugin - The plugin
     * @param {HTMLElement} textArea - The text area element
     * @returns {HTMLElement} The button container
     */
    createButtonContainer(plugin, textArea) {
        const container = document.createElement('div');
        container.className = 'ai-dialog-buttons';
        
        // ChatGPT button
        const chatGPTBtn = document.createElement('button');
        chatGPTBtn.className = 'ai-dialog-button';
        chatGPTBtn.textContent = window.uiManager
            ? window.uiManager.t('ui.askChatGPT')
            : 'Ask ChatGPT';
        chatGPTBtn.onclick = () => {
            this.askAI('chatgpt', plugin, textArea.value);
        };
        container.appendChild(chatGPTBtn);
        
        // Perplexity button
        const perplexityBtn = document.createElement('button');
        perplexityBtn.className = 'ai-dialog-button';
        perplexityBtn.textContent = window.uiManager
            ? window.uiManager.t('ui.askPerplexity')
            : 'Ask Perplexity';
        perplexityBtn.onclick = () => {
            this.askAI('perplexity', plugin, textArea.value);
        };
        container.appendChild(perplexityBtn);
        
        return container;
    }

    /**
     * Ask AI about the plugin
     * @param {string} service - The AI service to use ('chatgpt' or 'perplexity')
     * @param {Object} plugin - The plugin
     * @param {string} userText - The user's question
     */
    async askAI(service, plugin, userText) {
        try {
            // Create a query that references the plugin
            const query = `${userText}\n\nThis is about the ${plugin.name} effect in EffeTune audio processor.`;
            const encodedQuery = encodeURIComponent(query);
            
            // Construct the URL based on the service
            let url;
            if (service === 'chatgpt') {
                url = `https://chatgpt.com/?q=${encodedQuery}`;
            } else if (service === 'perplexity') {
                url = `https://www.perplexity.ai/search?q=${encodedQuery}`;
            }
            
            // Open the URL in a new tab/window
            if (window.electronAPI && window.electronAPI.openExternalUrl) {
                // In Electron, use shell.openExternal to open in default browser
                window.electronAPI.openExternalUrl(url)
                    .catch(err => {
                        // Fallback to window.open
                        window.open(url, '_blank');
                    });
            } else {
                // Regular browser environment
                window.open(url, '_blank');
            }
            
            // Close the dialog
            const dialog = document.querySelector('.ai-dialog');
            if (dialog) dialog.remove();
            
        } catch (error) {
            console.error('Error asking AI:', error);
        }
    }

    /**
     * Position the dialog in the center of the viewport
     * @param {HTMLElement} dialog - The dialog element
     */
    positionDialog(dialog) {
        if (window.uiManager?.layoutMode?.isMobile) {
            dialog.style.position = 'fixed';
            dialog.style.zIndex = '1001';
            return;
        }
        dialog.style.position = 'fixed';
        dialog.style.top = '50%';
        dialog.style.left = '50%';
        dialog.style.transform = 'translate(-50%, -50%)';
        dialog.style.zIndex = '1001';
    }

    /**
     * Setup close handler for the dialog
     * @param {HTMLElement} dialog - The dialog element
     */
    setupCloseHandler(dialog) {
        // Prevent immediate closing by delaying the click handler
        setTimeout(() => {
            // Close dialog when clicking outside
            document.addEventListener('click', function closeDialog(e) {
                if (!dialog.contains(e.target)) {
                    dialog.remove();
                    document.removeEventListener('click', closeDialog);
                }
            });
        }, 100);
    }
}
