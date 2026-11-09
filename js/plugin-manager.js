import './ui/range-fill.js';
import { PLUGIN_SUPPORT_SCRIPTS } from './plugin-support-scripts.js';

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

    createPlugin(name, { audioHostActive = true } = {}) {
        if (!this.isPluginAvailable(name)) {
            console.error(`Plugin '${name}' is not available`);
            throw new Error(`Plugin '${name}' is not available`);
        }
        const PluginClass = this.pluginClasses[name];
        let constructionTarget = PluginClass;
        if (!audioHostActive) {
            // Make the host gate visible before any constructor runs, without
            // changing the registered class or its constructor-based DSP identity.
            constructionTarget = function DetachedPlugin() {};
            constructionTarget.prototype = Object.create(PluginClass.prototype);
            constructionTarget.prototype.audioHostActive = false;
        }
        const plugin = Reflect.construct(PluginClass, [], constructionTarget);
        plugin.id = this.nextPluginId++;
        const currentPowerUiGate = !audioHostActive ? false : typeof window !== 'undefined'
            ? window.audioManager?.powerPolicyController?.getDspUiActivityAllowed?.()
            : undefined;
        if (typeof currentPowerUiGate === 'boolean') {
            plugin.setPowerUiEnabled?.(currentPowerUiGate);
        }
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
            const jsUrls = PLUGIN_SUPPORT_SCRIPTS
                .map(url => this.withDevelopmentCacheBuster(url, devCacheToken));
            const cssUrls = ['plugins/spectrum-overlay.css', 'plugins/graph-readout.css']
                .map(url => this.withDevelopmentCacheBuster(url, devCacheToken));
            for (const {path, hasCSS} of pluginDefinitions.values()) {
                jsUrls.push(this.withDevelopmentCacheBuster(`${path}.js`, devCacheToken));
                if (hasCSS) cssUrls.push(this.withDevelopmentCacheBuster(`${path}.css`, devCacheToken));
            }

            const totalFiles = jsUrls.length + cssUrls.length;
            let loadedFiles = 0;
            if (window.uiManager) window.uiManager.updateLoadingProgress(0);

            // Resolves once the file has loaded or failed; a failed file is
            // logged and must not stop the others.
            const loadResource = (element, url, kind) => new Promise(resolve => {
                const settle = () => {
                    loadedFiles++;
                    if (window.uiManager) {
                        window.uiManager.updateLoadingProgress(Math.round((loadedFiles / totalFiles) * 100));
                    }
                    resolve();
                };
                element.onload = settle;
                element.onerror = error => {
                    console.error(`Failed to load ${kind}: ${url}`, error);
                    settle();
                };
                document.head.appendChild(element);
            });

            // All files download in parallel. Non-async scripts still run in
            // insertion order, so the support scripts run before the plugins
            // that depend on them.
            const scriptLoads = jsUrls.map(url => {
                const script = document.createElement('script');
                script.async = false;
                script.src = url;
                return loadResource(script, url, 'script');
            });
            const cssLoads = cssUrls.map(url => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = url;
                return loadResource(link, url, 'CSS');
            });
            await Promise.all([...scriptLoads, ...cssLoads]);

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
