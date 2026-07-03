export class PluginManager {
    constructor() {
        this.pluginClasses = {};
        this.nextPluginId = 1;
        this.effectCategories = {};
    }
    
    /**
     * Check if a plugin is available in the current configuration
     * @param {string} name - The name of the plugin to check
     * @returns {boolean} - True if the plugin is available, false otherwise
     */
    isPluginAvailable(name) {
        return name && typeof name === 'string' && Object.prototype.hasOwnProperty.call(this.pluginClasses, name);
    }

    createPlugin(name) {
        if (!this.isPluginAvailable(name)) {
            console.error(`Plugin '${name}' is not available`);
            throw new Error(`Plugin '${name}' is not available`);
        }
        const plugin = new this.pluginClasses[name]();
        plugin.id = this.nextPluginId++;
        this.captureDefaultParameters(plugin);
        return plugin;
    }

    captureDefaultParameters(plugin) {
        if (!plugin || typeof plugin.getParameters !== 'function') {
            plugin.defaultParameters = {};
            return;
        }

        try {
            const defaultParameters = JSON.parse(JSON.stringify(plugin.getParameters()));
            delete defaultParameters.type;
            delete defaultParameters.id;
            delete defaultParameters.enabled;
            delete defaultParameters.inputBus;
            delete defaultParameters.outputBus;
            delete defaultParameters.channel;
            plugin.defaultParameters = defaultParameters;
        } catch (error) {
            console.warn(`Failed to capture default parameters for ${plugin.name}:`, error);
            plugin.defaultParameters = {};
        }
    }

    async loadPlugins() {
        try {
            // Start loading resources
            const devCacheToken = this.createDevelopmentCacheToken();
            
            // First load and parse plugins.txt to know what to load
            const pluginsText = await fetch(this.withDevelopmentCacheBuster('plugins/plugins.txt', devCacheToken)).then(r => r.text());
            const { categories, pluginDefinitions } = this.parsePluginsDefinition(pluginsText);

            // Collect all resource URLs
            const jsUrls = [this.withDevelopmentCacheBuster('plugins/plugin-base.js', devCacheToken)];
            const cssUrls = [];
            for (const {path, hasCSS} of pluginDefinitions.values()) {
                jsUrls.push(this.withDevelopmentCacheBuster(`${path}.js`, devCacheToken));
                if (hasCSS) cssUrls.push(this.withDevelopmentCacheBuster(`${path}.css`, devCacheToken));
            }

            // Calculate total files to load for progress tracking
            const totalFiles = jsUrls.length + cssUrls.length;
            let loadedFiles = 0;
            
            // Show initial progress
            if (window.uiManager) window.uiManager.updateLoadingProgress(0);
            
            // Function to update progress
            const updateProgress = () => {
                loadedFiles++;
                // Calculate progress percentage based on loaded files (0-100%)
                const percent = Math.round((loadedFiles / totalFiles) * 100);
                if (window.uiManager) window.uiManager.updateLoadingProgress(percent);
            };

            // Custom script loader with progress tracking
            const loadScriptWithProgress = async (url) => {
                return new Promise((resolve) => {
                    const script = document.createElement('script');
                    script.src = url;
                    script.onload = () => {
                        updateProgress();
                        resolve();
                    };
                    script.onerror = (error) => {
                        console.error(`Failed to load script: ${url}`, error);
                        updateProgress();
                        resolve(); // Continue even if a single script fails
                    };
                    document.head.appendChild(script);
                });
            };

            // Custom CSS loader with progress tracking
            const loadCSSWithProgress = async (url) => {
                return new Promise((resolve) => {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = url;
                    link.onload = () => {
                        updateProgress();
                        resolve();
                    };
                    link.onerror = (error) => {
                        console.error(`Failed to load CSS: ${url}`, error);
                        updateProgress();
                        resolve(); // Continue even if a single CSS file fails
                    };
                    document.head.appendChild(link);
                });
            };

            // Load plugin-base.js first as it's a dependency for other plugins
            try {
                const baseJsUrl = jsUrls.shift(); // Remove and get the first item (plugin-base.js)
                await loadScriptWithProgress(baseJsUrl);
            } catch (error) {
                console.error('Error loading base plugin file:', error);
                // Continue with application
            }
            
            // Load remaining JS files in parallel with error handling
            try {
                // Create batches of JS files to load in parallel (6 at a time to respect browser connection limits)
                const batchSize = 6;
                for (let i = 0; i < jsUrls.length; i += batchSize) {
                    const batch = jsUrls.slice(i, i + batchSize);
                    await Promise.all(batch.map(url => loadScriptWithProgress(url)));
                }
            } catch (error) {
                console.error('Error loading JS files:', error);
                // Continue with application
            }
            
            // Load CSS files in parallel with error handling
            try {
                // Create batches of CSS files to load in parallel (6 at a time to respect browser connection limits)
                const batchSize = 6;
                for (let i = 0; i < cssUrls.length; i += batchSize) {
                    const batch = cssUrls.slice(i, i + batchSize);
                    await Promise.all(batch.map(url => loadCSSWithProgress(url)));
                }
            } catch (error) {
                console.error('Error loading CSS files:', error);
                // Continue with application
            }

            // Resources loaded

            // Initialize plugins sequentially to avoid Promise.all rejection on error
            for (const [displayName, {className}] of pluginDefinitions.entries()) {
                try {
                    if (!window[className]) {
                        console.error(`Plugin class ${className} not found`);
                        continue;
                    }
                    this.pluginClasses[displayName] = window[className];
                } catch (error) {
                    console.error(`Failed to initialize plugin ${displayName}:`, error);
                    // Continue with other plugins
                }
            }

            // Store categories
            this.effectCategories = categories;


            return {
                pluginClasses: this.pluginClasses,
                effectCategories: this.effectCategories
            };
        } catch (error) {
            console.error('Error loading plugins:', error);
            throw error;
        }
    }

    isDevelopmentDynamicLoadingEnabled() {
        return typeof window !== 'undefined' && window.EFFECTUNE_DEV_SERVER === true;
    }

    createDevelopmentCacheToken() {
        return this.isDevelopmentDynamicLoadingEnabled() ? Date.now().toString(36) : null;
    }

    withDevelopmentCacheBuster(url, token) {
        if (!token) return url;
        return `${url}${url.includes('?') ? '&' : '?'}dev=${token}`;
    }

    parsePluginsDefinition(text) {
        const categories = {};
        const pluginDefinitions = new Map();
        let currentSection = null;

        text.split('\n').forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) return;

            if (line === '[categories]') {
                currentSection = 'categories';
            } else if (line === '[plugins]') {
                currentSection = 'plugins';
            } else if (currentSection === 'categories') {
                const [name, description] = line.split(':').map(s => s.trim());
                categories[name] = {
                    description,
                    plugins: []
                };
            } else if (currentSection === 'plugins') {
                const [path, info] = line.split(':').map(s => s.trim());
                const [displayName, category, className, hasCSS] = info.split('|').map(s => s.trim());
                pluginDefinitions.set(displayName, {
                    path: `plugins/${path}`,
                    category,
                    className,
                    hasCSS: hasCSS === 'css'
                });
                categories[category].plugins.push(displayName);
            }
        });

        return { categories, pluginDefinitions };
    }
}
