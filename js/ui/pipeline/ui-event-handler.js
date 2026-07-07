/**
 * UIEventHandler - Handles keyboard shortcuts, drag and drop events, and selection management
 */
import { PipelineCore } from './pipeline-core.js';
import { PluginListManager } from '../plugin-list-manager.js'; // Temporary path
import { readTextFromClipboard } from '../../utils/clipboard-utils.js';
import { handlePipelineKeyboardShortcut, handlePipelinePasteEvent } from './keyboard-shortcut-handler.js';

const PLAYBACK_AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'opus', 'm4a', 'aac', 'webm'];
const PLAYBACK_AUDIO_EXTENSION_PATTERN = new RegExp(`\\.(${PLAYBACK_AUDIO_EXTENSIONS.join('|')})$`, 'i');
const PLAYLIST_EXTENSION_PATTERN = /\.(m3u8?|pls|xspf)$/i;

function isSupportedPlaybackAudioFile(file) {
    return !!(file && PLAYBACK_AUDIO_EXTENSION_PATTERN.test(file.name || ''));
}

function isPlaylistFile(file) {
    return !!(file && PLAYLIST_EXTENSION_PATTERN.test(file.name || ''));
}

function isInsideLibraryContent(target) {
    return !!(target?.closest?.('.library-content') && target?.closest?.('.library-view'));
}

function isLibraryPlaylistDrag(event) {
    return isInsideLibraryContent(event.target)
        && Array.from(event.dataTransfer?.types || []).includes('Files');
}

function isLibraryPlaylistDrop(event) {
    return isInsideLibraryContent(event.target)
        && Array.from(event.dataTransfer?.files || []).some(isPlaylistFile);
}

export class UIEventHandler {
    /**
     * Create a new UIEventHandler instance
     * @param {PipelineManager} pipelineManager - The main pipeline manager instance
     * @param {HistoryManager} historyManager - The history manager instance
     * @param {PipelineCore} core - The PipelineCore instance
     */
    constructor(pipelineManager, historyManager, core) {
        this.pipelineManager = pipelineManager;
        this.historyManager = historyManager;
        this.core = core; // Reference to PipelineCore instance
        this.clipboardManager = pipelineManager.clipboardManager;
        this.pipelineListElement = document.getElementById('pipelineList'); 

        if (!this.pipelineListElement) {
            console.error("CRITICAL: Pipeline list element (#pipelineList) not found!");
            return;
        }

        // State for requestAnimationFrame indicator updates
        this.rafId = null;         // ID returned by requestAnimationFrame
        this.isDraggingOver = false; // Flag to track if currently dragging over the drop zone
        this.lastClientX = 0;      // Last known X coordinate
        this.lastClientY = 0;      // Last known Y coordinate
        this.prevClientX = -1;     // Previous X coordinate for change detection
        this.prevClientY = -1;     // Previous Y coordinate for change detection

        this.setupPipelineDropZoneEvents();
        
        // Initialize keyboard events
        this.initKeyboardEvents();
    }
    
    /**
     * Initialize keyboard event handlers
     */
    initKeyboardEvents() {
        // Handle keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            handlePipelineKeyboardShortcut(e, {
                historyManager: this.historyManager,
                pipelineManager: this.pipelineManager,
                core: this.core,
                clipboardManager: this.clipboardManager,
                readTextFromClipboard,
                uiManager: window.uiManager,
                documentRef: document
            });
        });

        document.addEventListener('paste', (e) => {
            handlePipelinePasteEvent(e, {
                clipboardManager: this.clipboardManager
            });
        });
    }
    
    /**
     * Initialize drag and drop functionality
     */
    initDragAndDrop() {
        const pipelineElement = document.getElementById('pipeline');

        // Create file drop area and setup file input
        if (this.pipelineManager.fileProcessor) {
            this.pipelineManager.fileProcessor.createFileDropArea(pipelineElement);
        }
        
        // Setup plugin selection and drag handlers
        this.setupPluginSelectionHandlers(pipelineElement);
        
        // Setup plugin drag and drop handlers
        this.setupPluginDragHandlers(pipelineElement);
        
        // Setup file drag and drop handlers
        if (this.pipelineManager.fileProcessor) {
            this.pipelineManager.fileProcessor.setupFileDropHandlers();
        }
        
        // Setup global drag and drop handlers (for browser environment only)
        //
        // IMPORTANT DRAG & DROP BEHAVIOR NOTES:
        // --------------------------------------
        // 1. These handlers are for the entire document and handle both music files and preset files.
        // 2. The behavior differs based on file type and drop target:
        //
        //    A. Music Files (.mp3, .wav, etc.):
        //       - When dragged over the main window (not file-drop-area):
        //         * body gets 'drag-over' class
        //       - When dropped on the main window (not file-drop-area):
        //         * Files are played in the Player
        //       - When dragged/dropped on file-drop-area:
        //         * Handled by FileProcessor.js for offline processing
        //
        //    B. Preset Files (.effetune_preset):
        //       - When dragged over ANY part of the window:
        //         * body gets 'drag-over' class
        //         * file-drop-area should NOT show 'drag-active' class
        //       - When dropped ANYWHERE in the window:
        //         * Preset is loaded into the Effect Pipeline
        //
        // 3. Visual feedback is critical:
        //    - 'drag-over' on body = will be played or loaded as preset
        //    - 'drag-active' on file-drop-area = will be processed offline
        //
        // 4. Event propagation is carefully managed:
        //    - For preset files: events bubble up to document handlers
        //    - For music files on file-drop-area: events are stopped
        //    - For music files elsewhere: events bubble up to document handlers
        //
        // DO NOT MODIFY THIS BEHAVIOR without thorough testing of all drag & drop scenarios!
        if (!window.electronIntegration || !window.electronIntegration.isElectron) {
            // Add CSS for drag-over effect directly to the document
            const style = document.createElement('style');
            style.id = 'drag-drop-style';
            style.textContent = `
                body.drag-over {
                    position: relative;
                }
                
                body.drag-over::before {
                    content: '';
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 120, 255, 0.1);
                    border: 2px dashed rgba(0, 120, 255, 0.5);
                    pointer-events: none;
                    z-index: 9999;
                }
            `;
            
            // Remove any existing style with the same ID
            const existingStyle = document.getElementById('drag-drop-style');
            if (existingStyle) {
                existingStyle.remove();
            }
            
            // Add the new style
            document.head.appendChild(style);

            // Global drag/drop listeners for FILES (Music & Presets)
            document.addEventListener('dragover', (e) => {
                // Always prevent default for dragover to enable drop
                e.preventDefault();
                
                // Check if this is a FILE drag (not a plugin drag)
                if (e.dataTransfer && (
                    // Check for items
                    (e.dataTransfer.items && Array.from(e.dataTransfer.items).some(item => item.kind === 'file')) ||
                    // Also check types array
                    (e.dataTransfer.types && e.dataTransfer.types.includes('Files') &&
                     !e.dataTransfer.types.includes('application/plugin-id') && // Ensure it's not a plugin drag
                     !e.dataTransfer.types.includes('application/plugin-index') &&
                     !e.dataTransfer.types.includes('text/plain') // Also exclude plain text which is used for new plugins
                    )
                )) {
                    if (isLibraryPlaylistDrag(e)) {
                        document.body.classList.remove('drag-over');
                        e.dataTransfer.dropEffect = 'copy';
                        return;
                    }
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                    
                    // Check if the target is the file-drop-area or a child of it
                    const fileDropArea = e.target.closest('.file-drop-area');
                    if (fileDropArea) {
                        // Remove drag-over from body when over file-drop-area
                        document.body.classList.remove('drag-over');
                        return;
                    }
                    
                    // Check for preset files or music files
                    const items = Array.from(e.dataTransfer.items);
                    
                    // Add visual feedback for any file drag
                    document.body.classList.add('drag-over');
                    
                    // Force a reflow to ensure the style is applied
                    void document.body.offsetHeight;
                    
                    return false;
                }
            }, true); // Use capture phase
            
            document.addEventListener('dragleave', (e) => {
                // Only remove the body class if leaving the document
                if ((!e.relatedTarget || e.relatedTarget === document.documentElement) &&
                    document.body.classList.contains('drag-over')) {
                    document.body.classList.remove('drag-over');
                }
            }, true); // Use capture phase
            
            document.addEventListener('drop', (e) => {
                // Only handle FILE drops here
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0 &&
                    e.dataTransfer.types.includes('Files') &&
                    !e.dataTransfer.types.includes('application/plugin-id') &&
                    !e.dataTransfer.types.includes('application/plugin-index') &&
                    !e.dataTransfer.types.includes('text/plain')) {
                    if (isLibraryPlaylistDrop(e)) {
                        document.body.classList.remove('drag-over');
                        return;
                    }
                    // Check if the target is the file-drop-area or a child of it
                    const fileDropArea = e.target.closest('.file-drop-area');
                    if (fileDropArea) {
                        // Allow the drop event to propagate to the file-drop-area handler
                        document.body.classList.remove('drag-over');
                        return;
                    }
                    
                    // For other areas, prevent default behavior
                    e.preventDefault();
                    e.stopPropagation();
                    document.body.classList.remove('drag-over');
                    
                    // Process the dropped files
                    const files = Array.from(e.dataTransfer.files);
                    
                    // Check for preset files
                    const presetFiles = files.filter(file =>
                        (file.name || '').toLowerCase().endsWith('.effetune_preset')
                    );
                    
                    // Check for music files
                    const musicFiles = files.filter(isSupportedPlaybackAudioFile);
                    
                    // Process preset files first (if any)
                    if (presetFiles.length > 0) {
                        // Read the preset file content
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            try {
                                const fileData = event.target.result;
                                const presetData = JSON.parse(fileData);
                                
                                // Load the preset using the UI manager
                                if (window.uiManager) {
                                    window.uiManager.loadPreset(presetData);
                                }
                            } catch (error) {
                                console.error('Failed to parse preset file:', error);
                                if (window.uiManager) {
                                    window.uiManager.setError('Invalid preset file format', true);
                                }
                            }
                        };
                        reader.onerror = (error) => {
                            console.error('Failed to read preset file:', error);
                            if (window.uiManager) {
                                window.uiManager.setError('Failed to read preset file', true);
                            }
                        };
                        reader.readAsText(presetFiles[0]);
                    }
                    // Process music files (if any and no preset files)
                    else if (musicFiles.length > 0) {
                        // For browser environment, create audio player directly with the files
                        if (window.uiManager) {
                            // Pass the File objects directly to preserve original file names
                            window.uiManager.createAudioPlayer(musicFiles, false);
                        }
                    }
                    
                    return false;
                }
            }, true); // Use capture phase
        }
    }
    
    /**
     * Sets up plugin selection handlers
     * @param {HTMLElement} pipelineElement - The pipeline container element
     */
    setupPluginSelectionHandlers(pipelineElement) {
        pipelineElement.addEventListener('click', (e) => {
            const pipelineHeader = pipelineElement.querySelector('.pipeline-header');
            
            // Skip selection clearing if the click is on the clipboard buttons
            if (e.target.closest('.cut-button') || 
                e.target.closest('.copy-button') || 
                e.target.closest('.paste-button')) {
                return;
            }
            
            if (e.target === pipelineElement ||
                e.target === this.core.pipelineList ||
                e.target === pipelineHeader ||
                pipelineHeader.contains(e.target)) {
                this.core.selectedPlugins.clear();
                this.core.updateSelectionClasses();
            }
        });
    }
    
    /**
     * Sets up plugin drag and drop handlers
     * @param {HTMLElement} pipelineElement - The pipeline container element
     */
    setupPluginDragHandlers(pipelineElement) {
        // NOTE: The dragover logic for updating the insertion indicator is now handled 
        //       by the listener on `pipelineListElement` in `setupPipelineDropZoneEvents`,
        //       which uses requestAnimationFrame and handles zoom correction via `updateIndicatorLoop`.
        //       Adding a listener here on the parent `pipelineElement` caused conflicts 
        //       and incorrect indicator updates (e.g., passing only clientY).

        // Handle plugin drag leave
        pipelineElement.addEventListener('dragleave', (e) => {
            if (!pipelineElement.contains(e.relatedTarget)) {
                this.pipelineManager.pluginListManager.getInsertionIndicator().style.display = 'none';
            }
        });
        
        // Handle dropped plugins
        pipelineElement.addEventListener('drop', (e) => {
            const pipelineList = document.getElementById('pipelineList');

            // --- Check if the drop occurred within the pipelineList area ---
            if (pipelineList && pipelineList.contains(e.target)) {
                // Let the pipelineList's drop handler manage this event.
                return; 
            }

            // --- Handle drops occurring directly on the pipeline background/header ---

            // Skip if this is a file drop (handled elsewhere)
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                return; 
            }

            e.preventDefault(); // Prevent default as we are handling it here
            e.stopPropagation(); // Stop propagation as we've handled it

            // Check for plugin reordering (Should not happen directly on pipeline, but check anyway)
            const sourceIndex = e.dataTransfer.getData('application/plugin-index'); // Corrected key
            if (sourceIndex !== null && sourceIndex !== undefined && sourceIndex !== '') {
                return;
            }

            // Handle new plugin creation if dropped directly on pipeline background/header
            const newPluginName = e.dataTransfer.getData('text/plain');
            if (newPluginName) {
                 this.handleNewPluginDrop(e); 
            } else {
            }
        });
    }
    
    /**
     * Set up drag events for a pipeline item handle
     * @param {HTMLElement} handle - The handle element
     * @param {HTMLElement} item - The pipeline item element
     * @param {Object} plugin - The plugin instance
     */
    setupDragEvents(handle, item, plugin) {
        const pipeline = this.pipelineManager?.audioManager?.pipeline;
        if (!pipeline) {
            console.error("Cannot setup drag events: Pipeline not available.");
            return;
        }
        const initialIndex = pipeline.indexOf(plugin);
        if (initialIndex === -1) {
             console.warn("Plugin not found in pipeline for drag setup:", plugin.name);
             return; 
        }

        let isTouchDragging = false; // Flag for touch drag state
        this.draggingPluginInfo = null; // Initialize dragging info storage

        // --- Mouse Drag Events ---
        handle.addEventListener('dragstart', (e) => { 
           e.stopPropagation(); 
           e.dataTransfer.setData('application/plugin-id', plugin.id.toString()); 
           e.dataTransfer.setData('application/plugin-index', initialIndex.toString());
           item.classList.add('dragging');
           e.dataTransfer.effectAllowed = 'move';
           // Start indicator updates via pipelineListElement's dragenter
        });

        handle.addEventListener('dragend', (e) => { 
            e.stopPropagation();
            item.classList.remove('dragging');
            // Indicator updates stop via pipelineListElement's dragleave/drop
        });

        // --- Touch Drag Events ---
        handle.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            // Prevent default scroll/zoom behavior ONLY for the handle
            e.preventDefault(); 

            isTouchDragging = true;
            this.draggingPluginInfo = { // Store info for touchend
                id: plugin.id.toString(),
                index: initialIndex 
            };
            item.classList.add('dragging');

            // Show indicator and start the rAF loop
            const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
            if (pluginListManager) {
                pluginListManager.getInsertionIndicator().style.display = 'block';
            }
            this.isDraggingOver = true; // Use the same flag as mouse drag
            this.prevClientX = -1;
            this.prevClientY = -1;
            if (!this.rafId) {
                this.updateIndicatorLoop();
            }
            
            // Update initial position for the loop
            if (e.touches[0]) {
                this.lastClientX = e.touches[0].clientX;
                this.lastClientY = e.touches[0].clientY;
            }

        }, { passive: false }); // IMPORTANT: passive: false to allow preventDefault

        handle.addEventListener('touchmove', (e) => {
            if (!isTouchDragging) return;
            e.stopPropagation();
            // Prevent scrolling while dragging the handle
            e.preventDefault(); 

            if (e.touches[0]) {
                 // Update coordinates for the rAF loop
                 this.lastClientX = e.touches[0].clientX;
                 this.lastClientY = e.touches[0].clientY;
                 this.isDraggingOver = true; // Keep flag set
            }
        }, { passive: false }); // IMPORTANT: passive: false to allow preventDefault

        handle.addEventListener('touchend', (e) => {
            if (!isTouchDragging) return;
            e.stopPropagation();
            e.preventDefault(); // Prevent potential click events after drag

            isTouchDragging = false;
            item.classList.remove('dragging');
            this.isDraggingOver = false; // Reset flag to stop rAF loop

            // Hide indicator immediately
            const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
            if (pluginListManager) {
                pluginListManager.getInsertionIndicator().style.display = 'none';
            }
            // Cancel any pending rAF update
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }

            // Check if we have stored dragging info
            if (this.draggingPluginInfo && this.draggingPluginInfo.index !== undefined) {
                const sourceIndex = this.draggingPluginInfo.index;
                const touch = e.changedTouches[0];

                if (touch) {
                    // Create a mock event object similar to DropEvent for handlePluginReordering
                    const mockDropEvent = {
                        clientX: touch.clientX,
                        clientY: touch.clientY,
                        preventDefault: () => {},
                        stopPropagation: () => {},
                        target: document.elementFromPoint(touch.clientX, touch.clientY) // Find element under touch end
                        // dataTransfer is not needed as we pass sourceIndex directly
                    };

                    // Check if the drop occurred within the pipelineList area
                    const pipelineList = document.getElementById('pipelineList');
                    if (pipelineList && pipelineList.contains(mockDropEvent.target)) {
                         this.handlePluginReordering(mockDropEvent, sourceIndex);
                    } else {
                         // console.warn("Touch drag ended outside pipelineList.");
                         // Even if dropped outside, ensure UI updates like removing 'dragging' class
                         requestAnimationFrame(() => {
                             if (this.core?.updatePipelineUI) {
                                 this.core.updatePipelineUI(false); 
                             }
                         });
                    }
                }
            } else {
                 // console.warn("Missing draggingPluginInfo on touchend.");
                 // Ensure UI updates even if info is missing
                 requestAnimationFrame(() => {
                     if (this.core?.updatePipelineUI) {
                         this.core.updatePipelineUI(false);
                     }
                 });
            }
            
            this.draggingPluginInfo = null; // Clear stored info
        });

        // Handle touch cancel (e.g., interrupted by system UI)
         handle.addEventListener('touchcancel', (e) => {
             if (!isTouchDragging) return;
             e.stopPropagation();

             isTouchDragging = false;
             item.classList.remove('dragging');
             this.isDraggingOver = false; // Reset flag

             // Hide indicator
             const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
             if (pluginListManager) {
                 pluginListManager.getInsertionIndicator().style.display = 'none';
             }
             if (this.rafId) {
                 cancelAnimationFrame(this.rafId);
                 this.rafId = null;
             }
             this.draggingPluginInfo = null; // Clear stored info
             // Ensure UI updates on cancel
             requestAnimationFrame(() => {
                 if (this.core?.updatePipelineUI) {
                     this.core.updatePipelineUI(false);
                 }
             });
         });
    }
    
    /**
     * Handles plugin reordering on drop
     * @param {Event} e - The drop event (or a mock event from touchend)
     * @param {number} sourceIndex - The source index of the plugin being moved
     */
    handlePluginReordering(e, sourceIndex) {
        // Ensure PluginListManager reference is valid using the safe access pattern
        const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
        if (!pluginListManager) {
            console.error("PluginListManager not found in handlePluginReordering");
            return;
        }

        // Ensure audioManager and pipeline exist
        if (!this.pipelineManager?.audioManager?.pipeline) {
             console.error("Pipeline array not found in handlePluginReordering");
             return;
        }
        const pipeline = this.pipelineManager.audioManager.pipeline;

        // Validate sourceIndex
        if (sourceIndex < 0 || sourceIndex >= pipeline.length) {
             console.error(`Invalid sourceIndex ${sourceIndex} for pipeline length ${pipeline.length}.`);
             // Update UI to remove dragging state if applicable
             requestAnimationFrame(() => {
                 if (this.core?.updatePipelineUI) {
                     this.core.updatePipelineUI(false);
                 }
             });
             return;
        }

        const plugin = pipeline[sourceIndex];
        if (!plugin) {
             console.error(`Plugin at sourceIndex ${sourceIndex} not found.`);
             // Update UI
             requestAnimationFrame(() => {
                 if (this.core?.updatePipelineUI) {
                     this.core.updatePipelineUI(false);
                 }
             });
             return; // Safety check
        }
        
        // Use clientX/clientY available in both DragEvent and the mock touch event
        const rawEventX = e.clientX;
        const rawEventY = e.clientY;
        
        if (typeof rawEventX !== 'number' || typeof rawEventY !== 'number') {
             console.error("Invalid coordinates in reordering event:", e);
             // Update UI
             requestAnimationFrame(() => {
                 if (this.core?.updatePipelineUI) {
                     this.core.updatePipelineUI(false);
                 }
             });
             return;
        }

        const targetIndex = pluginListManager.findInsertionIndex(
            rawEventX, 
            rawEventY, 
            pipeline
        );

        // Adjust target index if it's after the source index in the same drag operation
        // This is necessary because removing the item first shifts subsequent indices
        let adjustedTargetIndex = targetIndex;
        if (targetIndex > sourceIndex) {
            adjustedTargetIndex--;
        }
        
        // Ensure adjustedTargetIndex is within valid bounds
        if (adjustedTargetIndex < 0) adjustedTargetIndex = 0;
        if (adjustedTargetIndex > pipeline.length -1 ) adjustedTargetIndex = pipeline.length -1; // account for removed item

        // Prevent dropping onto itself (or the position immediately after itself before adjustment)
        if (adjustedTargetIndex === sourceIndex) {
             // console.log("Drop target is the same as source, no reordering needed.");
             // Ensure UI is updated even if no reorder happens (e.g., remove dragging class)
             requestAnimationFrame(() => {
                 if (this.core?.updatePipelineUI) {
                     this.core.updatePipelineUI(false); // Update UI without forced rebuild
                 }
             });
             return;
        }
        
        // --- Perform Reordering ---
        // Reordering operation starts - no need to save state here

        // Remove the plugin from its original position
        pipeline.splice(sourceIndex, 1);
        
        // Insert the plugin at the new adjusted position
        // Ensure target index is still valid after splice
        const finalInsertionIndex = Math.min(adjustedTargetIndex, pipeline.length);
        pipeline.splice(finalInsertionIndex, 0, plugin);
        
        // --- Post-Reorder Updates ---
        // Update selection to the moved plugin
        // Pass the original event 'e' which might be needed by selection logic downstream
        this.core.handlePluginSelection(plugin, e); 
        
        // Update the audio worklet with the new pipeline order
        this.core.updateWorkletPlugins();
        
        // Update UI (async to ensure it runs after drop/touchend completes)
        requestAnimationFrame(() => {
            if (this.core?.updatePipelineUI) {
                 // Use true to force full UI rebuild after reordering
                 this.core.updatePipelineUI(true); 
            } else {
                console.error("Missing core or updatePipelineUI in handlePluginReordering's rAF callback");
            }
        });
        
        // Save state after the operation is complete
        this.historyManager.saveState();
    }
    
    /**
     * Handles dropping a new plugin
     * @param {DragEvent} e - The drop event
     */
    async handleNewPluginDrop(e) {
        // Ensure PluginListManager reference is valid using the safe access pattern
        const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
        if (!pluginListManager) {
             console.error("PluginListManager not found in handleNewPluginDrop");
             return;
        }
        
        // --- Add check for this.pipelineManager --- 
        if (!this.pipelineManager) {
            console.error("PipelineManager instance is missing in handleNewPluginDrop!");
            return;
        }

        const dataText = e.dataTransfer.getData('text/plain');
        
        // Try to parse as JSON to check if it's a preset
        try {
            const data = JSON.parse(dataText);
            if (data.type === 'preset' && data.name) {
                // Handle system preset drop
                await this.handlePresetDrop(e, data.name);
                return;
            } else if (data.type === 'userPreset' && data.name) {
                // Handle user preset drop
                await this.handleUserPresetDrop(e, data.name);
                return;
            }
        } catch (error) {
            // Not JSON, continue with plugin handling
        }

        const pluginName = dataText;
        // Access pluginManager safely
        if (pluginName && this.pipelineManager.pluginManager?.pluginClasses[pluginName]) {
            // Access createPlugin safely
            const plugin = this.pipelineManager.pluginManager.createPlugin?.(pluginName);
            if (!plugin) {
                console.error(`Failed to create plugin instance: ${pluginName}`);
                return; 
            }
            
            // Ensure expandedPlugins and audioManager exist before using them
            if (!this.pipelineManager.expandedPlugins || !this.pipelineManager.audioManager) {
                console.error("Missing expandedPlugins or audioManager in handleNewPluginDrop");
                return;
            }
            this.pipelineManager.expandedPlugins.add(plugin);

            // Pass raw event coordinates directly
            const rawDropEventX = e.clientX;
            const rawDropEventY = e.clientY;

            const targetIndex = pluginListManager.findInsertionIndex(
                rawDropEventX, 
                rawDropEventY, 
                this.pipelineManager.audioManager.pipeline
            );

            // Add the plugin at the calculated position
            this.pipelineManager.audioManager.pipeline.splice(targetIndex, 0, plugin);
            
            // Ensure core and handlePluginSelection exist
            if (!this.core?.handlePluginSelection) { /* Error handled inside */ return; }
            this.core.handlePluginSelection(plugin, e);
            
            // Ensure core and updateWorkletPlugins exist
            if (!this.core?.updateWorkletPlugins) { /* Error handled inside */ return; }
            this.core.updateWorkletPlugins();
            
            // Ensure historyManager and saveState exist
            if (!this.historyManager?.saveState) { /* Error handled inside */ return; }
            this.historyManager.saveState();
            
            // Use rAF to ensure UI update happens after drop event processing
            requestAnimationFrame(() => {
                if (this.core?.updatePipelineUI) {
                     this.core.updatePipelineUI(true); // Pass true for immediate update
                } else {
                    console.error("Missing core or updatePipelineUI in handleNewPluginDrop's rAF callback");
                }
            });
            
            // Check window width and adjust plugin list collapse state after adding a plugin
            pluginListManager.checkWindowWidthAndAdjust();
        } else {
            // This can happen if the drag source is not a valid plugin
        }
    }

    async handleUserPresetDrop(e, presetName) {
        try {
            const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
            if (!pluginListManager) {
                console.error("PluginListManager not found in handleUserPresetDrop");
                return;
            }

            // Calculate insertion index
            const rawDropEventX = e.clientX;
            const rawDropEventY = e.clientY;

            const targetIndex = pluginListManager.findInsertionIndex(
                rawDropEventX, 
                rawDropEventY, 
                this.pipelineManager.audioManager.pipeline
            );

            // Use the plugin list manager's user preset handling
            await pluginListManager.addUserPresetToPipeline(presetName, targetIndex);

            // Check window width and adjust plugin list collapse state after adding a preset
            pluginListManager.checkWindowWidthAndAdjust();
        } catch (error) {
            console.error('Error handling user preset drop:', error);
            if (window.uiManager) {
                window.uiManager.setError(`Error adding user preset: ${error.message}`, true);
            }
        }
    }

    async handlePresetDrop(e, presetName) {
        try {
            const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
            if (!pluginListManager) {
                console.error("PluginListManager not found in handlePresetDrop");
                return;
            }

            // Calculate insertion index
            const rawDropEventX = e.clientX;
            const rawDropEventY = e.clientY;

            const targetIndex = pluginListManager.findInsertionIndex(
                rawDropEventX, 
                rawDropEventY, 
                this.pipelineManager.audioManager.pipeline
            );

            // Get preset manager from plugin list manager
            await pluginListManager.initPresetManager();
            await pluginListManager.presetManager.addPresetToPipeline(presetName, targetIndex);

            // Check window width and adjust plugin list collapse state after adding a preset
            pluginListManager.checkWindowWidthAndAdjust();
        } catch (error) {
            console.error('Error handling preset drop:', error);
            if (window.uiManager) {
                window.uiManager.setError(`Error adding preset: ${error.message}`, true);
            }
        }
    }

    // Centralized function to start indicator updates - REMOVED
    // startIndicatorUpdates() { ... }

    // Centralized function to stop indicator updates - REMOVED
    // stopIndicatorUpdates() { ... }

    setupPipelineDropZoneEvents() {
        const dropZone = this.pipelineListElement;

        if (!dropZone) {
            console.error("CRITICAL: setupPipelineDropZoneEvents - dropZone (#pipelineList) is null or undefined!");
            return; // Exit if dropZone is not found
        }

        // Drag Enter: Show indicator, start rAF loop
        dropZone.addEventListener('dragenter', (e) => {
            const types = e.dataTransfer.types;
            const isPluginDrag = types.includes('application/plugin-id') || 
                                 types.includes('application/plugin-index') || 
                                 (types.includes('text/plain') && !types.includes('Files'));

            if (isPluginDrag) {
                e.preventDefault(); // Allow drop for plugins
                // Show indicator immediately
                const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
                 if (pluginListManager) {
                      pluginListManager.getInsertionIndicator().style.display = 'block';
                 }
                this.isDraggingOver = true; // Set flag when entering
                this.prevClientX = -1; // Reset previous coords on enter
                this.prevClientY = -1;
                // Start the rAF loop if not already running
                 if (!this.rafId) {
                     this.updateIndicatorLoop();
                 }
            } else {                
            }
        });

        // Dragover listener using requestAnimationFrame
        dropZone.addEventListener('dragover', (e) => {
            const types = e.dataTransfer.types;
            const isPluginDrag = types.includes('application/plugin-id') || 
                                 types.includes('application/plugin-index') || 
                                 (types.includes('text/plain') && !types.includes('Files'));

            if (isPluginDrag) {
                e.preventDefault(); // Required to allow dropping plugins
                e.dataTransfer.dropEffect = 'move';

                // Update coordinates continuously
                this.lastClientX = e.clientX;
                this.lastClientY = e.clientY;
                this.isDraggingOver = true; // Ensure flag is set while dragging over

                // The actual update is handled by the rAF loop (updateIndicatorLoop)
                // which is started on dragenter
            } else {
                // Do not prevent default for files here, let other handlers manage
            }
        });

        dropZone.addEventListener('dragleave', (e) => {
            const rect = dropZone.getBoundingClientRect();
            // Check if the mouse truly left the element bounds
            if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
                   this.isDraggingOver = false; // Reset flag when leaving
                  // Hide indicator immediately
                  const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
                  if (pluginListManager) {
                      pluginListManager.getInsertionIndicator().style.display = 'none';
                  }
                  // Cancel any pending rAF update
                  if (this.rafId) {
                      cancelAnimationFrame(this.rafId);
                      this.rafId = null;
                  }
            } else {
            }
        });

        // Modify drop listener to use arrow function AND ADD STOP PROPAGATION
        dropZone.addEventListener('drop', (e) => { // Changed to arrow function
             e.preventDefault(); // Prevent default for this drop zone
              this.isDraggingOver = false; // Reset flag on drop
              
              // Hide indicator
              const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
              if (pluginListManager) {
                  pluginListManager.getInsertionIndicator().style.display = 'none';
              }
              // Cancel any pending rAF update
              if (this.rafId) {
                  cancelAnimationFrame(this.rafId);
                  this.rafId = null;
              }

              // Get data
              const sourcePluginId = e.dataTransfer.getData('application/plugin-id');
              const sourceIndexStr = e.dataTransfer.getData('application/plugin-index'); // Corrected key
              const newPluginName = e.dataTransfer.getData('text/plain');
              
              
              let handled = false; // Flag to check if drop was handled
              if (sourceIndexStr !== null && sourceIndexStr !== undefined && sourceIndexStr !== "") {
                   const sourceIndex = parseInt(sourceIndexStr, 10);
                   // `this` now correctly refers to UIEventHandler instance
                   if (!isNaN(sourceIndex)) {
                       this.handlePluginReordering(e, sourceIndex); 
                       handled = true;
                   }
              } else if (newPluginName) {
                  // `this` now correctly refers to UIEventHandler instance
                  this.handleNewPluginDrop(e); 
                  handled = true;
              }

              // *** Add stopPropagation if the event was handled here ***
              if (handled) {
                  e.stopPropagation(); 
              } else {
              }
        });
    }

    /**
     * RAF loop to update the insertion indicator position.
     */
    updateIndicatorLoop() {
        if (!this.isDraggingOver) { 
             this.rafId = null; // Stop the loop if not dragging over anymore
             this.prevClientX = -1; // Reset previous coords
             this.prevClientY = -1;
             return;
        }

        const pluginListManager = this.pipelineManager?.pluginListManager || window.uiManager?.pluginListManager;
        if (pluginListManager && typeof this.lastClientX === 'number' && typeof this.lastClientY === 'number') {
            // Pass raw client coordinates directly
            const rawClientX = this.lastClientX;
            const rawClientY = this.lastClientY;
            
            pluginListManager.updateInsertionIndicator(rawClientX, rawClientY);
            
            // Store current coordinates as previous for next frame check
            this.prevClientX = this.lastClientX;
            this.prevClientY = this.lastClientY;
        }

        // Schedule the next frame
        this.rafId = requestAnimationFrame(() => this.updateIndicatorLoop());
    }
}
