class SectionPlugin extends PluginBase {
    constructor() {
        super('Section', 'Group and control multiple effects together');
        this.cm = '';  // Default comment
        
        // Register processor function
        this.registerProcessor(`
            // Section plugin doesn't process audio, just pass through
            return data;
        `);
    }

    // Get parameters
    getParameters() {
        return {
            ...super.getParameters(),
            cm: this.cm
        };
    }

    // Set parameters
    setParameters(params) {
        super.setParameters(params);
        if (params.cm !== undefined) {
            this.cm = params.cm;
        }
    }

    // Create UI
    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        // Comment input field
        const commentRow = document.createElement('div');
        commentRow.className = 'parameter-row';
        
        const commentInput = document.createElement('input');
        commentInput.type = 'text';
        commentInput.value = this.cm;
        commentInput.id = `${this.id}-comment-input`;
        commentInput.name = `${this.id}-comment-input`;
        commentInput.placeholder = `Enter the section name`;
        commentInput.autocomplete = "off";
        commentInput.addEventListener('input', e => {
            this.cm = e.target.value;
            this.updateParameters();
        });

        commentRow.appendChild(commentInput);
        container.appendChild(commentRow);

        // Automation playback and preset recall change the model without touching the
        // DOM, so the comment field this plugin builds by hand is refreshed here.
        // A focused text field counts as held by the user, so the write is skipped
        // while it is focused; otherwise a refresh would overwrite what is being typed.
        this.registerUIRefresh(() => {
            if (this.isHeldByUser(commentInput)) return;
            if (commentInput.value !== this.cm) {
                commentInput.value = this.cm;
            }
        });

        return container;
    }
}

// Register the plugin
window.SectionPlugin = SectionPlugin; 