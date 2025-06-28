export class PresetManager {
    constructor() {
        this.presetCategories = {};
        this.presetDefinitions = new Map();
    }

    async loadPresets() {
        try {
            const presetsText = await fetch('presets/presets.txt').then(r => r.text());
            const { categories, presetDefinitions } = this.parsePresetsDefinition(presetsText);
            
            this.presetCategories = categories;
            this.presetDefinitions = presetDefinitions;
            
            return { categories, presetDefinitions };
        } catch (error) {
            console.error('Error loading presets:', error);
            return { categories: {}, presetDefinitions: new Map() };
        }
    }

    parsePresetsDefinition(text) {
        const categories = {};
        const presetDefinitions = new Map();
        let currentSection = null;

        text.split('\n').forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) return;

            if (line === '[categories]') {
                currentSection = 'categories';
            } else if (line === '[presets]') {
                currentSection = 'presets';
            } else if (currentSection === 'categories') {
                const [name, description] = line.split(':').map(s => s.trim());
                categories[name] = {
                    description,
                    presets: []
                };
            } else if (currentSection === 'presets') {
                const [path, info] = line.split(':').map(s => s.trim());
                const [displayName, category, description] = info.split('|').map(s => s.trim());
                presetDefinitions.set(displayName, {
                    path: `presets/${path}`,
                    category,
                    description
                });
                if (categories[category]) {
                    categories[category].presets.push(displayName);
                }
            }
        });

        return { categories, presetDefinitions };
    }

    async loadPresetData(presetName) {
        try {
            const presetDef = this.presetDefinitions.get(presetName);
            if (!presetDef) {
                throw new Error(`Preset "${presetName}" not found`);
            }

            const response = await fetch(`${presetDef.path}.effetune_preset`);
            if (!response.ok) {
                throw new Error(`Failed to load preset file: ${response.status}`);
            }

            const presetData = await response.json();
            return presetData;
        } catch (error) {
            console.error(`Error loading preset data for "${presetName}":`, error);
            throw error;
        }
    }

    async addPresetToPipeline(presetName, insertionIndex = null) {
        try {
            const presetData = await this.loadPresetData(presetName);
            
            if (!presetData.pipeline || !Array.isArray(presetData.pipeline)) {
                throw new Error('Invalid preset data format');
            }

            // Get audio manager and plugin manager
            const audioManager = window.audioManager;
            const pluginManager = window.pluginManager;
            const pipelineManager = window.pipelineManager;
            
            if (!audioManager || !pluginManager || !pipelineManager) {
                throw new Error('Required managers not available');
            }

            // Create Section plugin first (if available)
            let sectionPlugin = null;
            try {
                if (pluginManager.isPluginAvailable('Section')) {
                    sectionPlugin = pluginManager.createPlugin('Section');
                    sectionPlugin.setParameters({
                        cm: presetName
                    });
                }
            } catch (error) {
                console.warn('Section plugin not available for preset labeling:', error);
            }

            // Create plugins from preset data
            const presetPlugins = [];
            for (const pluginData of presetData.pipeline) {
                try {
                    const plugin = pluginManager.createPlugin(pluginData.name);
                    
                    // Apply all parameters from preset
                    const params = { ...pluginData.parameters };
                    if (pluginData.enabled !== undefined) {
                        params.enabled = pluginData.enabled;
                    }
                    if (pluginData.inputBus !== undefined) {
                        plugin.inputBus = pluginData.inputBus;
                    }
                    if (pluginData.outputBus !== undefined) {
                        plugin.outputBus = pluginData.outputBus;
                    }
                    if (pluginData.channel !== undefined) {
                        plugin.channel = pluginData.channel;
                    }
                    
                    plugin.setParameters(params);
                    presetPlugins.push(plugin);
                } catch (error) {
                    console.warn(`Failed to create plugin "${pluginData.name}" from preset:`, error);
                }
            }

            // Check if the plugin right after insertion position is a Section plugin
            const targetIndex = insertionIndex !== null ? insertionIndex : audioManager.pipeline.length;
            const isNextPluginSection = targetIndex < audioManager.pipeline.length && 
                                      audioManager.pipeline[targetIndex].name === 'Section';

            // Create end section plugin if needed (when next plugin is not Section AND not at the end of pipeline)
            let endSectionPlugin = null;
            if (!isNextPluginSection && targetIndex < audioManager.pipeline.length) {
                try {
                    if (pluginManager.isPluginAvailable('Section')) {
                        endSectionPlugin = pluginManager.createPlugin('Section');
                        endSectionPlugin.setParameters({
                            cm: ''  // Empty comment as default
                        });
                    }
                } catch (error) {
                    console.warn('Section plugin not available for end section:', error);
                }
            }

            // Prepare all plugins to add
            let allPluginsToAdd = sectionPlugin ? [sectionPlugin, ...presetPlugins] : presetPlugins;
            if (endSectionPlugin) {
                allPluginsToAdd = [...allPluginsToAdd, endSectionPlugin];
            }

            // Add to expanded plugins
            allPluginsToAdd.forEach(plugin => {
                pipelineManager.expandedPlugins.add(plugin);
            });

            // Insert into pipeline
            audioManager.pipeline.splice(targetIndex, 0, ...allPluginsToAdd);

            // Update UI and worklet
            pipelineManager.updatePipelineUI(true);
            pipelineManager.updateWorkletPlugins();
            
            // Save state for undo/redo
            if (pipelineManager.historyManager) {
                pipelineManager.historyManager.saveState();
            }

            return true;
        } catch (error) {
            console.error(`Error adding preset "${presetName}" to pipeline:`, error);
            throw error;
        }
    }
} 