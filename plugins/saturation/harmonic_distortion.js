class HarmonicDistortionPlugin extends PluginBase {
    constructor() {
        super('Harmonic Distortion', 'Harmonic distortion effect with independent harmonic control');
        
        // Initialize parameters with defaults
        this.h2 = 2.0;   // h2: 2nd Harm (%) - -30~30%, default 2%
        this.h3 = 3.0;   // h3: 3rd Harm (%) - -30~30%, default 3%
        this.h4 = 0.5;   // h4: 4th Harm (%) - -30~30%, default 0.5%
        this.h5 = 0.3;   // h5: 5th Harm (%) - -30~30%, default 0.3%
        this.sn = 0.5;   // sn: Sensitivity (x) - 0.1~2.0, default 0.5

        // Register processor function
        this.registerProcessor(`
            // Skip processing if the plugin is disabled
            if (!parameters.enabled) return data;

            // --- Extract and Prepare Parameters ---
            // Destructure parameters for quick access
            const {
                h2: secondHarm,   // 2nd harmonic coefficient (%) [-100 to 100 typical]
                h3: thirdHarm,    // 3rd harmonic coefficient (%)
                h4: fourthHarm,   // 4th harmonic coefficient (%)
                h5: fifthHarm,    // 5th harmonic coefficient (%)
                sn: sensitivity,  // Sensitivity factor (input scaler, typically > 0)
                channelCount,
                blockSize
            } = parameters;

            // Convert harmonic percentages to polynomial coefficients [-1.0 to 1.0]
            // The negative sign is intentional, flipping the distortion curve shape.
            const a2 = -secondHarm * 0.01;
            const a3 = -thirdHarm * 0.01;
            const a4 = -fourthHarm * 0.01;
            const a5 = -fifthHarm * 0.01;

            // Pre-calculate inverse sensitivity for efficient level compensation via multiplication.
            // Add a small epsilon to prevent division by zero if sensitivity can be zero.
            // Ensure sensitivity parameter range design prevents issues with very small values.
            const invSensitivity = 1.0 / (sensitivity + 1e-9); // Use epsilon for safety

            // --- Main Processing Loop ---
            // Process samples block by block, channel by channel
            for (let ch = 0; ch < channelCount; ++ch) {
                const offset = ch * blockSize; // Calculate base index for the current channel

                // Process each sample in the block for the current channel
                for (let i = 0; i < blockSize; ++i) {
                    const index = offset + i;    // Direct index into the data buffer
                    const x = data[index];       // Get the original input sample

                    // Apply sensitivity scaling to the input signal before distortion
                    const x_scaled = x * sensitivity;

                    // --- Calculate Polynomial Terms ---
                    // Calculate powers of the scaled input efficiently
                    const x2 = x_scaled * x_scaled; // x^2
                    const x3 = x2 * x_scaled;       // x^3
                    const x4 = x2 * x2;             // x^4 (using x2*x2 might be marginally faster)
                    const x5 = x4 * x_scaled;       // x^5

                    // --- Apply Nonlinear Static Polynomial Distortion ---
                    // Calculate the distorted signal using the polynomial:
                    // y = x_scaled + a2*x^2 + a3*x^3 + a4*x^4 + a5*x^5
                    const y_nl = x_scaled +
                                a2 * x2 +
                                a3 * x3 +
                                a4 * x4 +
                                a5 * x5;

                    // --- Level Compensation & Output ---
                    // Compensate output level by multiplying with the pre-calculated inverse sensitivity.
                    // This replaces division (y_nl / sensitivity) with multiplication for potential speed gain.
                    data[index] = y_nl * invSensitivity;
                } // End Sample Loop
            } // End Channel Loop

            // Return the modified data buffer
            return data;
        `);
    }

    // Get current parameters
    getParameters() {
        return {
            type: this.constructor.name,
            h2: this.h2,     // 2nd Harm (%)
            h3: this.h3,     // 3rd Harm (%)
            h4: this.h4,     // 4th Harm (%)
            h5: this.h5,     // 5th Harm (%)
            sn: this.sn,     // Sensitivity (x)
            enabled: this.enabled
        };
    }

    // Set parameters with validation
    setParameters(params) {
        let graphNeedsUpdate = false;
        
        if (params.h2 !== undefined) {
            this.h2 = this.parseFiniteNumber(params.h2, -30, 30, this.h2);
            graphNeedsUpdate = true;
        }
        if (params.h3 !== undefined) {
            this.h3 = this.parseFiniteNumber(params.h3, -30, 30, this.h3);
            graphNeedsUpdate = true;
        }
        if (params.h4 !== undefined) {
            this.h4 = this.parseFiniteNumber(params.h4, -30, 30, this.h4);
            graphNeedsUpdate = true;
        }
        if (params.h5 !== undefined) {
            this.h5 = this.parseFiniteNumber(params.h5, -30, 30, this.h5);
            graphNeedsUpdate = true;
        }
        if (params.sn !== undefined) {
            this.sn = this.parseFiniteNumber(params.sn, 0.1, 2.0, this.sn);
            graphNeedsUpdate = true;
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        this.updateParameters();
        
        if (graphNeedsUpdate) {
            this.updateTransferGraph();
        }
    }

    // Individual parameter setters
    setH2(value) { this.setParameters({ h2: value }); }
    setH3(value) { this.setParameters({ h3: value }); }
    setH4(value) { this.setParameters({ h4: value }); }
    setH5(value) { this.setParameters({ h5: value }); }
    setSn(value) { this.setParameters({ sn: value }); }

    // Transfer function graph for visualizing the waveshaper
    updateTransferGraph() {
        const canvas = this.canvas;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Draw grid
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        
        // Vertical grid lines
        for (let x = 0; x <= width; x += width / 4) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        
        // Horizontal grid lines
        for (let y = 0; y <= height; y += height / 4) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        
        // Draw labels on canvas - just like saturation.js
        ctx.fillStyle = '#fff';
        ctx.font = '28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('in', width / 2, height - 5);
        ctx.save();
        ctx.translate(20, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('out', 0, 0);
        ctx.restore();
        
        // Draw dB markings
        ctx.fillStyle = '#666';
        ctx.font = '20px Arial';
        ctx.fillText('-6dB', width * 0.25, height - 5);
        ctx.fillText('-6dB', width * 0.75, height - 5);
        ctx.save();
        ctx.translate(20, height * 0.25);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('-6dB', 0, 0);
        ctx.restore();
        ctx.save();
        ctx.translate(20, height * 0.75);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('-6dB', 0, 0);
        ctx.restore();
        
        // Draw the transfer function
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        // Convert percentage values to actual coefficients
        const a2 = -this.h2 * 0.01;
        const a3 = -this.h3 * 0.01;
        const a4 = -this.h4 * 0.01;
        const a5 = -this.h5 * 0.01;
        
        for (let i = 0; i < width; i++) {
            const x = (i / width) * 2 - 1; // Map to [-1, 1] range
            
            // Apply the same transfer function as in the processor
            const x_scaled = x * this.sn;
            const x2 = x_scaled * x_scaled;
            const x3 = x2 * x_scaled;
            const x4 = x3 * x_scaled;
            const x5 = x4 * x_scaled;
            
            const y = x_scaled + 
                     a2 * x2 + 
                     a3 * x3 + 
                     a4 * x4 + 
                     a5 * x5;
            
            // Apply compensation and map to canvas coordinates
            const y_compensated = y / this.sn;
            const canvasY = ((1 - y_compensated) / 2) * height;
            
            if (i === 0) {
                ctx.moveTo(i, canvasY);
            } else {
                ctx.lineTo(i, canvasY);
            }
        }
        
        ctx.stroke();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'harmonic-distortion-plugin-ui plugin-parameter-ui';

        // Use base helper to create parameter rows
        container.appendChild(this.createParameterControl(
            '2nd Harm', -30, 30, 0.1, this.h2,
            this.setH2.bind(this), '%'
        ));
        container.appendChild(this.createParameterControl(
            '3rd Harm', -30, 30, 0.1, this.h3,
            this.setH3.bind(this), '%'
        ));
        container.appendChild(this.createParameterControl(
            '4th Harm', -30, 30, 0.1, this.h4,
            this.setH4.bind(this), '%'
        ));
        container.appendChild(this.createParameterControl(
            '5th Harm', -30, 30, 0.1, this.h5,
            this.setH5.bind(this), '%'
        ));
        container.appendChild(this.createParameterControl(
            'Sensitivity', 0.1, 2.0, 0.01, this.sn,
            this.setSn.bind(this), 'x'
        ));

        // Graph container for canvas and labels - keep original
        const graphContainer = document.createElement('div');
        graphContainer.style.position = 'relative';
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        canvas.style.width = '200px';
        canvas.style.height = '200px';
        canvas.style.backgroundColor = '#222';
        this.canvas = canvas;
        graphContainer.appendChild(canvas);
        container.appendChild(graphContainer);

        // Update the graph initially
        this.updateTransferGraph();
        return container;
    }
}

// Register the plugin globally
window.HarmonicDistortionPlugin = HarmonicDistortionPlugin;
