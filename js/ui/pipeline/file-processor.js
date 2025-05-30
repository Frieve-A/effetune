/**
 * FileProcessor - Handles audio file processing, progress UI, and download handling
 */
export class FileProcessor {
    /**
     * Create a new FileProcessor instance
     * @param {Object} pipelineManager - The pipeline manager instance
     */
    constructor(pipelineManager) {
        this.pipelineManager = pipelineManager;
        this.audioManager = pipelineManager.audioManager;
        
        // Initialize properties
        this.dropArea = null;
        this.downloadContainer = null;
        this.progressContainer = null;
        this.progressBar = null;
        this.progressText = null;
        
        // Add a flag to track cancellation
        this.isCancelled = false;
    }
    
    /**
     * Creates the file drop area and file input element
     * @param {HTMLElement} pipelineElement - The pipeline container element
     */
    createFileDropArea(pipelineElement) {
        // Create file input element
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'audio/*';
        fileInput.multiple = true;
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        // Create drop area
        const dropArea = document.createElement('div');
        dropArea.className = 'file-drop-area';
        
        // Check if running in Electron environment
        if (window.electronIntegration && window.electronIntegration.isElectron) {
            // For Electron, only show the link
            const specifyAudioText = window.uiManager && window.uiManager.t ?
                window.uiManager.t('ui.specifyAudioFiles') :
                'Specify the audio files to process using the current effects.';
            const processingText = window.uiManager && window.uiManager.t ?
                window.uiManager.t('ui.processing') :
                'Processing...';
            const cancelText = window.uiManager && window.uiManager.t ?
                window.uiManager.t('ui.cancelButton') :
                'Cancel';
                
            dropArea.innerHTML = `
                <div class="drop-message">
                    <span class="select-files">${specifyAudioText}</span>
                </div>
                <div class="progress-container" style="display: none;">
                    <div class="progress-bar">
                        <div class="progress"></div>
                    </div>
                <div class="progress-text">${processingText}</div>
                <button class="cancel-button">${cancelText}</button>
            </div>
            `;
        } else {
            // For web app, show both drop area and link
            const dropAudioText = window.uiManager && window.uiManager.t ?
                window.uiManager.t('ui.dropAudioFiles') :
                'Drop audio files here to process with current effects';
            const orText = window.uiManager && window.uiManager.t ?
                window.uiManager.t('ui.orText') :
                'or';
            const selectFilesText = window.uiManager && window.uiManager.t ?
                window.uiManager.t('ui.selectFiles') :
                'specify audio files to process';
            const processingText = window.uiManager && window.uiManager.t ?
                window.uiManager.t('ui.processing') :
                'Processing...';
            const cancelText = window.uiManager && window.uiManager.t ?
                window.uiManager.t('ui.cancelButton') :
                'Cancel';
                
            dropArea.innerHTML = `
                <div class="drop-message">
                    <span>${dropAudioText}</span>
                    <span class="or-text">${orText}</span>
                    <span class="select-files">${selectFilesText}</span>
                </div>
                <div class="progress-container" style="display: none;">
                    <div class="progress-bar">
                        <div class="progress"></div>
                    </div>
                <div class="progress-text">${processingText}</div>
                <button class="cancel-button">${cancelText}</button>
            </div>
            `;
        }

        // Add click handler for file selection
        const selectFiles = dropArea.querySelector('.select-files');
        selectFiles.addEventListener('click', () => {
            fileInput.click();
        });

        // Setup file input change handler
        this.setupFileInputHandlers(fileInput);

        // Create download container inside the drop area
        const downloadContainer = document.createElement('div');
        downloadContainer.className = 'download-container';
        downloadContainer.style.display = 'none';

        // Add download container to drop area
        dropArea.appendChild(downloadContainer);

        // Add drop area to pipeline container
        pipelineElement.appendChild(dropArea);

        // Store references
        this.dropArea = dropArea;
        this.downloadContainer = downloadContainer;
        this.progressContainer = dropArea.querySelector('.progress-container');
        this.progressBar = dropArea.querySelector('.progress');
        this.progressText = dropArea.querySelector('.progress-text');
    }
    
    /**
     * Sets up handlers for file input element
     * @param {HTMLInputElement} fileInput - The file input element
     */
    setupFileInputHandlers(fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files).filter(file => file.type.startsWith('audio/'));
            if (files.length === 0) {
                window.uiManager.setError('Please select audio files', true);
                return;
            }

            // Show progress UI
            this.showProgress();

            try {
                // Process multiple files
                const processedFiles = [];
                const totalFiles = files.length;

                // Process each file
                for (let i = 0; i < totalFiles; i++) {
                    const file = files[i];
                    try {
                        // Create progress callback for this file
                        const progressCallback = (percent) => {
                            const totalPercent = (i + percent / 100) / totalFiles * 100;
                            this.progressBar.style.width = `${Math.round(totalPercent)}%`;
                            if (window.uiManager && window.uiManager.t) {
                                this.setProgressText(window.uiManager.t('status.processingFile', {
                                    current: i + 1,
                                    total: totalFiles,
                                    percent: Math.round(percent)
                                }));
                            } else {
                                this.setProgressText(`Processing file ${i + 1}/${totalFiles} (${Math.round(percent)}%)`);
                            }
                        };

                        // Process the file with progress updates
                        const blob = await this.audioManager.processAudioFile(file, progressCallback);
                        if (blob) {
                            const processedName = this.getProcessedFileName(file.name);
                            processedFiles.push({
                                blob,
                                name: processedName
                            });
                        } else {
                            // Processing was cancelled
                            this.setProgressText(window.uiManager && window.uiManager.t ?
                                window.uiManager.t('status.processingCanceled') : 'Processing canceled');
                            return;
                        }
                    } catch (error) {
                        // Error processing file
                        window.uiManager.setError('error.failedToProcessFile', true, { fileName: file.name, errorMessage: error.message });
                    }
                }

                // Set progress to 100%
                this.progressBar.style.width = '100%';
                this.setProgressText(window.uiManager && window.uiManager.t ?
                    window.uiManager.t('status.processingComplete') : 'Processing complete');

                // Create zip if multiple files were processed
                if (processedFiles.length > 0) {
                    if (processedFiles.length === 1) {
                        this.showDownloadLink(processedFiles[0].blob, files[0].name);
                    } else {
                        this.setProgressText(window.uiManager && window.uiManager.t ?
                            window.uiManager.t('status.creatingZipFile') : 'Creating zip file...');
                        const zip = new JSZip();
                        processedFiles.forEach(({blob, name}) => {
                            zip.file(name, blob);
                        });
                        const zipBlob = await zip.generateAsync({type: 'blob'});
                        this.showDownloadLink(zipBlob, 'processed_audio.zip', true);
                    }
                }
            } catch (error) {
                // Error processing files
                window.uiManager.setError('error.failedToProcessAudioFiles', true, { errorMessage: error.message });
            } finally {
                this.hideProgress();
                // Reset file input
                fileInput.value = '';
            }
        });
    }
    
    /**
     * Sets up file drag and drop handlers
     *
     * IMPORTANT DRAG & DROP BEHAVIOR NOTES:
     * --------------------------------------
     * 1. This handler is specifically for the file-drop-area element and should ONLY process audio files.
     * 2. Preset files (.effetune_preset) should NOT be processed by this handler - they should be ignored
     *    and allowed to bubble up to the global document handler in ui-event-handler.js.
     * 3. When audio files are dragged over the file-drop-area:
     *    - The file-drop-area should show the 'drag-active' class
     *    - The body's 'drag-over' class should be removed
     * 4. When preset files are dragged over the file-drop-area:
     *    - The file-drop-area should NOT show any visual feedback
     *    - The event should be prevented but allowed to bubble up
     * 5. When audio files are dropped on the file-drop-area:
     *    - They should be processed for offline processing (not played in the Player)
     * 6. When preset files are dropped on the file-drop-area:
     *    - They should be handled by the global document handler for preset loading
     *
     * DO NOT MODIFY THIS BEHAVIOR without thorough testing of all drag & drop scenarios!
     */
    setupFileDropHandlers() {
        // Handle file drag and drop for audio files only
        this.dropArea.addEventListener('dragenter', (e) => {
            // Skip in Electron environment
            if (window.electronIntegration && window.electronIntegration.isElectron) {
                return;
            }
            
            // Only handle audio files
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                const items = Array.from(e.dataTransfer.items);
                
                // Check for preset files first
                const hasPresetFiles = items.some(item => {
                    if (item.kind === 'file') {
                        const file = item.getAsFile();
                        if (file && file.name.toLowerCase().endsWith('.effetune_preset')) {
                            return true;
                        }
                    }
                    return false;
                });
                
                // If preset files are detected, don't add drag-active class
                if (hasPresetFiles) {
                    // Prevent default to avoid browser opening the file
                    e.preventDefault();
                    return;
                }
                
                // Check for audio files by MIME type or file extension
                const hasAudioFiles = items.some(item => {
                    if (item.kind !== 'file') return false;
                    
                    // Check by MIME type
                    if (item.type.startsWith('audio/')) return true;
                    
                    // For items without a MIME type, check by file extension
                    const file = item.getAsFile();
                    if (file && /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)) {
                        return true;
                    }
                    
                    return false;
                });
                
                if (hasAudioFiles) {
                    e.preventDefault();
                    this.dropArea.classList.add('drag-active');
                }
            }
        }, { passive: false });
        
        this.dropArea.addEventListener('dragover', (e) => {
            // Skip in Electron environment
            if (window.electronIntegration && window.electronIntegration.isElectron) {
                return;
            }
            
            // Only handle audio files
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                // Check for preset files first
                const hasPresetFiles = Array.from(e.dataTransfer.items).some(item => {
                    if (item.kind === 'file') {
                        const file = item.getAsFile();
                        if (file && file.name.toLowerCase().endsWith('.effetune_preset')) {
                            return true;
                        }
                    }
                    return false;
                });
                
                // If preset files are detected, don't add drag-active class
                if (hasPresetFiles) {
                    // Prevent default to avoid browser opening the file
                    e.preventDefault();
                    return;
                }
                
                // For audio files, add drag-active class
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                this.dropArea.classList.add('drag-active');
                
                // Remove drag-over class from body when over drop area
                document.body.classList.remove('drag-over');
                
            }
        }, { passive: false });
        
        this.dropArea.addEventListener('dragleave', (e) => {
            // Only remove drag-active if the mouse actually left the drop area
            // Check if the related target is outside the drop area
            if (!this.dropArea.contains(e.relatedTarget)) {
                this.dropArea.classList.remove('drag-active');
            }
        }, false);
        
        this.dropArea.addEventListener('drop', async (e) => {
            // Skip in Electron environment
            if (window.electronIntegration && window.electronIntegration.isElectron) {
                // Just remove any active classes that might have been applied
                this.dropArea.classList.remove('drag-active');
                return;
            }
            
            // Check if this is a file drop
            if (!e.dataTransfer || !e.dataTransfer.types || !e.dataTransfer.types.includes('Files')) {
                return;
            }
            
            // Always prevent default to avoid browser opening the file
            e.preventDefault();
            
            // Get all dropped files
            const allFiles = Array.from(e.dataTransfer.files);
            
            // Check for preset files
            const presetFiles = allFiles.filter(file =>
                file.name.toLowerCase().endsWith('.effetune_preset')
            );
            
            // Check for audio files
            const audioFiles = allFiles.filter(file =>
                file.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)
            );
            
            
            // If there are preset files, let them be handled by the global handler
            if (presetFiles.length > 0) {
                // Remove drag active class
                this.dropArea.classList.remove('drag-active');
                // Don't call e.stopPropagation() to allow event to bubble up to document handler
                return;
            }
            
            // Handle audio files
            if (audioFiles.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                
                // Ensure insertion indicator is hidden for file drops
                this.pipelineManager.pluginListManager.getInsertionIndicator().style.display = 'none';
                
                // Process audio files
                this.processDroppedAudioFiles(audioFiles);
                
                // Remove drag active class
                this.dropArea.classList.remove('drag-active');
            } else {
                // No audio or preset files
                this.dropArea.classList.remove('drag-active');
            }
        }, { passive: false });
    }
    
    /**
     * Show progress UI
     */
    showProgress() {
        // Reset cancellation flag
        this.isCancelled = false;
        
        this.progressContainer.style.display = 'block';
        this.downloadContainer.style.display = 'none';
        this.progressBar.style.width = '0%';
        
        // Make sure drop message is hidden during processing
        const dropMessage = this.dropArea.querySelector('.drop-message');
        if (dropMessage) {
            dropMessage.style.display = 'none';
        }
        
        // Add cancel button handler with improved styling and event handling
        const cancelButton = this.progressContainer.querySelector('.cancel-button');
        
        // Ensure the button is visible and clickable
        cancelButton.style.position = 'relative';
        cancelButton.style.zIndex = '10000';
        cancelButton.style.pointerEvents = 'auto';
        cancelButton.style.cursor = 'pointer';
        
        // Remove any existing click handlers
        cancelButton.removeEventListener('click', this._cancelHandler);
        
        // Create a new handler and store a reference to it
        this._cancelHandler = () => {
            
            // Set both flags to ensure cancellation
            this.isCancelled = true;
            if (this.audioManager) {
                this.audioManager.isCancelled = true;
            }
            
            // Hide progress and show message
            this.hideProgress();
            this.setProgressText('Processing canceled');
        };
        
        // Add the click handler
        cancelButton.addEventListener('click', this._cancelHandler);
        
    }
    
    /**
     * Hide progress UI
     */
    hideProgress() {
        this.progressContainer.style.display = 'none';
        
        // Show drop message again when progress is hidden
        const dropMessage = this.dropArea.querySelector('.drop-message');
        if (dropMessage) {
            dropMessage.style.display = 'block';
        }
    }
    
    /**
     * Set progress text
     * @param {string} text - The text to display
     */
    setProgressText(text) {
        this.progressText.textContent = text;
    }
    
    /**
     * Get processed file name
     * @param {string} originalName - The original file name
     * @returns {string} The processed file name
     */
    getProcessedFileName(originalName) {
        return originalName.replace(/\.[^/.]+$/, '') + '_effetuned.wav';
    }
    
    /**
     * Show download link
     * @param {Blob} blob - The blob to download
     * @param {string} originalName - The original file name
     * @param {boolean} isZip - Whether the blob is a zip file
     */
    showDownloadLink(blob, originalName, isZip = false) {
        // Create filename based on type
        const filename = isZip ? originalName : this.getProcessedFileName(originalName);

        // Clear previous download links
        this.downloadContainer.innerHTML = '';

        // Create download link
        const downloadLink = document.createElement('a');
        
        // Check if running in Electron environment
        if (window.electronIntegration && window.electronIntegration.isElectron) {
            // For Electron, use save dialog instead of download
            downloadLink.href = '#';
            downloadLink.className = 'download-link';
            const saveText = window.uiManager && window.uiManager.t ?
                (isZip ? window.uiManager.t('ui.saveMultipleFiles', { size: (blob.size / (1024 * 1024)).toFixed(1) }) :
                window.uiManager.t('ui.saveSingleFile', { size: (blob.size / (1024 * 1024)).toFixed(1) })) :
                `Save ${isZip ? 'processed files' : 'processed file'} (${(blob.size / (1024 * 1024)).toFixed(1)} MB)`;
                
            downloadLink.innerHTML = `
                <span class="download-icon">⭳</span>
                ${saveText}
            `;
            
            // Add click handler to show save dialog
            downloadLink.addEventListener('click', async (e) => {
                e.preventDefault();
                
                // Show save dialog
                const result = await window.electronAPI.showSaveDialog({
                    title: 'Save Processed Audio',
                    defaultPath: filename,
                    filters: [
                        { name: isZip ? 'ZIP Archive' : 'WAV Audio', extensions: [isZip ? 'zip' : 'wav'] },
                        { name: 'All Files', extensions: ['*'] }
                    ]
                });
                
                if (!result.canceled && result.filePath) {
                    try {
                        // Convert blob to base64 string for IPC transfer
                        const reader = new FileReader();
                        reader.onload = async () => {
                            // Get base64 data (remove data URL prefix)
                            const base64data = reader.result.split(',')[1];
                            
                            // Save file using Electron API
                            const saveResult = await window.electronAPI.saveFile(
                                result.filePath,
                                base64data
                            );
                            
                            if (saveResult.success) {
                                window.uiManager.setError(`File saved successfully to ${result.filePath}`);
                                setTimeout(() => window.uiManager.clearError(), 3000);
                            } else {
                                window.uiManager.setError(`Failed to save file: ${saveResult.error}`, true);
                            }
                        };
                        
                        reader.onerror = (error) => {
                            // Error reading file
                            window.uiManager.setError(`Error reading file: ${error.message}`, true);
                        };
                        
                        // Start reading the blob as data URL
                        reader.readAsDataURL(blob);
                    } catch (error) {
                        // Error saving file
                        window.uiManager.setError(`Error saving file: ${error.message}`, true);
                    }
                }
            });
        } else {
            // For web browser, use standard download
            downloadLink.href = URL.createObjectURL(blob);
            downloadLink.download = filename;
            downloadLink.className = 'download-link';
            const downloadText = window.uiManager && window.uiManager.t ?
                (isZip ? window.uiManager.t('ui.downloadMultipleFiles', { size: (blob.size / (1024 * 1024)).toFixed(1) }) :
                window.uiManager.t('ui.downloadSingleFile', { size: (blob.size / (1024 * 1024)).toFixed(1) })) :
                `Download ${isZip ? 'processed files' : 'processed file'} (${(blob.size / (1024 * 1024)).toFixed(1)} MB)`;
                
            downloadLink.innerHTML = `
                <span class="download-icon">⭳</span>
                ${downloadText}
            `;
            
            // Clean up object URL when downloaded
            downloadLink.addEventListener('click', () => {
                setTimeout(() => {
                    URL.revokeObjectURL(downloadLink.href);
                }, 100);
            });
        }

        // Hide drop message when showing download link
        const dropMessage = this.dropArea.querySelector('.drop-message');
        if (dropMessage) {
            dropMessage.style.display = 'none';
        }

        // Add to container
        this.downloadContainer.appendChild(downloadLink);
        this.downloadContainer.style.display = 'block';
    }
    
    /**
     * Process dropped audio files
     * @param {File[]} files - Array of audio files to process
     */
    async processDroppedAudioFiles(files) {
        // Show progress UI
        this.showProgress();

        try {
            // Process multiple files
            const processedFiles = [];
            const totalFiles = files.length;

            // Process each file
            for (let i = 0; i < totalFiles; i++) {
                // Check if processing was cancelled
                if (this.isCancelled) {
                    break;
                }
                
                const file = files[i];
                try {
                    // Create progress callback for this file
                    const progressCallback = (percent) => {
                        // Check for cancellation during progress updates
                        if (this.isCancelled) {
                            return true; // Return true to signal cancellation
                        }
                        
                        const totalPercent = (i + percent / 100) / totalFiles * 100;
                        this.progressBar.style.width = `${Math.round(totalPercent)}%`;
                        this.setProgressText(`Processing file ${i + 1}/${totalFiles} (${Math.round(percent)}%)`);
                        return false; // Return false to continue processing
                    };

                    // Process the file with progress updates
                    const blob = await this.audioManager.processAudioFile(file, progressCallback);
                    
                    // Check again if processing was cancelled
                    if (this.isCancelled) {
                        break;
                    }
                    if (blob) {
                        const processedName = this.getProcessedFileName(file.name);
                        processedFiles.push({
                            blob,
                            name: processedName
                        });
                    } else {
                        // Processing was cancelled
                        this.setProgressText(window.uiManager && window.uiManager.t ?
                            window.uiManager.t('status.processingCanceled') : 'Processing canceled');
                        return;
                    }
                } catch (error) {
                    // Error processing file
                    window.uiManager.setError('error.failedToProcessFile', true, { fileName: file.name, errorMessage: error.message });
                }
            }

            // Set progress to 100%
            this.progressBar.style.width = '100%';
            this.setProgressText(window.uiManager && window.uiManager.t ?
                window.uiManager.t('status.processingComplete') : 'Processing complete');

            // Create zip if multiple files were processed
            if (processedFiles.length > 0) {
                if (processedFiles.length === 1) {
                    this.showDownloadLink(processedFiles[0].blob, files[0].name);
                } else {
                    this.setProgressText(window.uiManager && window.uiManager.t ?
                        window.uiManager.t('status.creatingZipFile') : 'Creating zip file...');
                    const zip = new JSZip();
                    processedFiles.forEach(({blob, name}) => {
                        zip.file(name, blob);
                    });
                    const zipBlob = await zip.generateAsync({type: 'blob'});
                    this.showDownloadLink(zipBlob, 'processed_audio.zip', true);
                }
            }
        } catch (error) {
            // Error processing files
            window.uiManager.setError('error.failedToProcessAudioFiles', true, { errorMessage: error.message });
        } finally {
            this.hideProgress();
            
            // Ensure drag-active class is removed
            this.dropArea.classList.remove('drag-active');
            
            // Also remove drag-active class from any other elements
            document.querySelectorAll('.drag-active').forEach(el => {
                el.classList.remove('drag-active');
            });
        }
    }
}