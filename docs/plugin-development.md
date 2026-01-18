---
title: "Plugin Development Guide - EffeTune"
description: "Complete guide to developing custom audio plugins for Frieve EffeTune."
lang: en
---

# Plugin Development Guide

This guide explains how to create new plugins for Frieve EffeTune.

## Basic Structure

All plugins must extend the `PluginBase` class and implement its core methods. Each method has specific responsibilities and timing considerations:

### Function Responsibilities

1. **constructor**
   - When: Executed once when the plugin instance is created
   - Role:
     * Set basic information (name, description via super())
     * Initialize parameters with default values (e.g., this.gain = 1.0)
     * Initialize state variables (buffers, arrays, etc.)
     * Register processor function (registerProcessor)
   - Notes:
     * Do not create UI or set up event listeners here
     * Avoid heavy initialization operations

2. **registerProcessor**
   - When: Called from constructor to register processing function with Audio Worklet
   - Role:
     * Define audio processing function
     * Check context state initialization
     * Handle enabled state check and skip processing
   - Notes:
     * Always check enabled state first
     * Initialize context only when necessary
     * Reset state when channel count changes

3. **process**
   - When: Called periodically during audio buffer processing
   - Role:
     * Validate messages and buffers
     * Check enabled state (early return if disabled)
     * Execute audio processing (only if enabled=true)
     * Update state for UI updates
   - Notes:
     * Continue UI updates regardless of enabled state
     * Avoid heavy processing operations

4. **cleanup**
   - When: Called when plugin is disabled or removed
   - Role:
     * Cancel animation frames
     * Remove event listeners
     * Release temporary resources
   - Notes:
     * Do not stop UI updates
     * Maintain state variables
     * Perform minimal cleanup only

Here's the basic structure of a plugin:

```javascript
class MyPlugin extends PluginBase {
    constructor() {
        super('Plugin Name', 'Plugin Description');
        
        // Initialize plugin parameters
        this.myParameter = 0;

        // Register the audio processing function
        this.registerProcessor(`
            // Your audio processing code here
            // This runs in the Audio Worklet
            return data;
        `);
    }

    // Get current parameters (required)
    getParameters() {
        return {
            type: this.constructor.name,
            myParameter: this.myParameter,
            enabled: this.enabled
        };
    }

    // Create UI elements (required)
    createUI() {
        const container = document.createElement('div');
        // Add your UI elements here
        return container;
    }
}

// Register the plugin globally
window.MyPlugin = MyPlugin;
```

## Key Components

### 1. Constructor
- Call `super()` with the plugin name and description
- Initialize plugin parameters with default values
- Initialize state variables (e.g., buffers, arrays) with appropriate sizes
- Register the audio processing function using `this.registerProcessor()`
- Example:
  ```javascript
  constructor() {
      super('My Plugin', 'Description');
      
      // Initialize parameters with defaults
      this.gain = 1.0;
      
      // Initialize state variables
      this.buffer = new Float32Array(1024);
      this.lastProcessTime = performance.now() / 1000;
      
      // Register processor
      this.registerProcessor(`...`);
  }
  ```

### 2. Audio Processing Function

### 2. Audio Processing Function
- Runs in the Audio Worklet context
- Receives these parameters:
  - `data`: Float32Array containing interleaved audio samples from all channels
    * For stereo: [L0,L1,...,L127,R0,R1,...,R127]
    * Length is (blockSize × channelCount)
  - `parameters`: Object containing your plugin's parameters
    * `channelCount`: Number of audio channels (e.g., 2 for stereo)
    * `blockSize`: Number of samples per channel (typically 128)
    * `enabled`: Boolean indicating if the plugin is enabled
    * Your custom parameters as defined in getParameters()
  - `time`: Current audio context time
- Must return the processed audio data in the same interleaved format
- Always check enabled state first and return unmodified data if disabled
- Initialize context state if needed (e.g., filter states, buffers)
- Example:
  ```javascript
  registerProcessor(`
      // Skip processing if disabled
      if (!parameters.enabled) return data;

      // Initialize context state if needed
      if (!context.initialized) {
          context.buffer = new Array(parameters.channelCount)
              .fill()
              .map(() => new Float32Array(1024));
          context.initialized = true;
      }

      // Reset state if channel count changes
      if (context.buffer.length !== parameters.channelCount) {
          context.buffer = new Array(parameters.channelCount)
              .fill()
              .map(() => new Float32Array(1024));
      }

      // Process audio data...
      return data;
  `);
  ```

### 3. Parameter Management
- Parameter Naming Convention
  * Use shortened parameter names **for parameters exposed externally** (via `getParameters`, `setParameters`, and passed to the audio processor) to optimize storage (e.g., in save files or URLs) and transmission.
  * **Internal state variables** used only within the plugin class do not need to follow this shortening convention and can use more descriptive names.
  * Shorten external parameter names using the following patterns:
    - For single words: Use the first letters (e.g., volume → vl, bass → bs)
    - For compound words: Use the first letter of each word (e.g., tpdfDither → td, zohFreq → zf)
  * Document the original parameter name in comments for clarity
  * The following parameter names are reserved and cannot be used: nm (plugin name abbreviation), en (enabled state abbreviation), uc(ui collapsed), ib (inputBus abbreviation), ob (outputBus abbreviation), ch (channel abbreviation), type, id, inputBus, outputBus, and channel

- Implement `getParameters()` to return current plugin state
  * Must include `type` and `enabled` fields
  * Return all parameters that affect audio processing
  * Example: `{ type: this.constructor.name, enabled: this.enabled, gain: this.gain }`

- Implement `setParameters(params)` to handle parameter updates
  * Validate all input parameters before applying
  * Use type checking and range validation
  * Ignore invalid values, keeping current state
  * Call `this.updateParameters()` after successful changes

- Use `setEnabled(enabled)` for enable/disable control
  * This method is provided by PluginBase
  * Automatically handles state updates
  * Do not modify `this.enabled` directly
  * Example: `plugin.setEnabled(false)` instead of `plugin.enabled = false`

- Parameter Validation Best Practices
  * Always validate parameter types (e.g., `typeof value === 'number'`)
  * Check value ranges (e.g., `value >= 0 && value <= 1`)
  * Provide fallback values for invalid inputs
  * Document valid parameter ranges in comments
- Example:
  ```javascript
  getParameters() {
      return {
          type: this.constructor.name,
          enabled: this.enabled,
          gain: this.gain,
          // Include all parameters that affect audio processing
      };
  }

  setParameters(params) {
      if (params.gain !== undefined) {
          this.setGain(params.gain); // Use dedicated setter for validation
      }
      this.updateParameters();
  }

  // Individual parameter setter with validation
  setGain(value) {
      this.gain = Math.max(0, Math.min(2, 
          typeof value === 'number' ? value : parseFloat(value)
      ));
      this.updateParameters();
  }
  ```

Example parameter management:
```javascript
class MyPlugin extends PluginBase {
    constructor() {
        super('My Plugin', 'Description');
        this.gain = 1.0;  // Default value
    }

    // Get current parameters
    getParameters() {
        return {
            type: this.constructor.name,  // Required
            enabled: this.enabled,        // Required
            gain: this.gain              // Plugin-specific
        };
    }

    // Set parameters with validation
    setParameters(params) {
        if (params.gain !== undefined) {
            // Type check
            const value = typeof params.gain === 'number' 
                ? params.gain 
                : parseFloat(params.gain);
            
            // Range validation
            if (!isNaN(value)) {
                this.gain = Math.max(0, Math.min(2, value));
            }
        }
        // Note: Don't handle enabled here, use setEnabled instead
        this.updateParameters();
    }

    // Individual parameter setter with validation
    setGain(value) {
        this.setParameters({ gain: value });
    }
}
```

### 4. User Interface
- Implement `createUI()` to return a DOM element containing your plugin's controls
- Use event listeners to update parameters when UI elements change
- Store UI element references if needed for updates
- Initialize animation frames for visualization plugins
- Clean up event listeners and animation frames in cleanup()

- **Helper Function for Parameter Controls:** `PluginBase` provides a convenient helper function `createParameterControl` to easily create common UI elements for controlling parameters. This function generates a row containing a label, a range slider, and a number input field, all linked together.

  ```javascript
  createParameterControl(label, min, max, step, value, callback)
  ```
  - `label`: The text label for the parameter.
  - `min`: The minimum value for the slider and input.
  - `max`: The maximum value for the slider and input.
  - `step`: The step increment for the slider and input.
  - `value`: The initial value for the parameter.
  - `callback`: A function that will be called when the parameter value changes. It receives the new value as an argument.

- Example using `createParameterControl`:
  ```javascript
  createUI() {
      const container = document.createElement('div');
      container.className = 'my-plugin-ui';

      // Use the helper function to create a gain control
      const gainControl = this.createParameterControl(
          'Gain', 0, 2, 0.01, this.gain, (newValue) => {
              this.setGain(newValue);
          }
      );
      container.appendChild(gainControl);

      // Add other UI elements as needed...
      // For visualization plugins, add canvas and start animation
      const canvas = document.createElement('canvas');
      this.canvas = canvas; // Store reference if needed for updates
      this.startAnimation(); // Start animation if needed

      container.appendChild(canvas);
      return container;
  }
  ```

- Example (Manual UI creation):
  ```javascript
  createUI() {
      const container = document.createElement('div');
      container.className = 'my-plugin-ui';

      // Create parameter controls manually, following accessibility guidelines
      const paramLabel = 'Gain';
      const paramIdBase = `${this.id}-${this.name}-gain`; // Base ID for related elements

      // Label
      const label = document.createElement('label');
      label.textContent = `${paramLabel}:`;
      label.htmlFor = `${paramIdBase}-slider`; // Associate with the slider
      
      // Slider Input
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = `${paramIdBase}-slider`;
      slider.name = `${paramIdBase}-slider`; // Use consistent name
      slider.min = 0;
      slider.max = 2;
      slider.step = 0.01;
      slider.value = this.gn; // Use internal (possibly shortened) state variable
      slider.autocomplete = "off"; // Disable browser autocomplete
      slider.addEventListener('input', e => {
          this.setGain(parseFloat(e.target.value)); // Call the setter
      });
      
      // (Optional) Text Input for precise value - also following guidelines
      const valueInput = document.createElement('input');
      valueInput.type = 'number';
      valueInput.id = `${paramIdBase}-input`;
      valueInput.name = `${paramIdBase}-input`;
      valueInput.min = 0;
      valueInput.max = 2;
      valueInput.step = 0.01;
      valueInput.value = this.gn;
      valueInput.autocomplete = "off";
      valueInput.addEventListener('input', e => {
          this.setGain(parseFloat(e.target.value));
          slider.value = e.target.value; // Sync slider if text input changes
      });
      slider.addEventListener('input', e => { // Sync text input if slider changes
          valueInput.value = e.target.value;
          this.setGain(parseFloat(e.target.value));
      });
      
      // Append elements to the container
      container.appendChild(label);
      container.appendChild(slider);
      container.appendChild(valueInput); // Append the text input too

      // For visualization plugins
      const canvas = document.createElement('canvas');
      this.canvas = canvas; // Store reference if needed for updates

      // Start animation if needed
      this.startAnimation();

      container.appendChild(canvas);
      return container;
  }

  // Animation control for visualization plugins
  startAnimation() {
      const animate = () => {
          this.updateDisplay(); // Assuming updateDisplay exists for visualization
          this.animationFrameId = requestAnimationFrame(animate);
      };
      this.animationFrameId = requestAnimationFrame(animate);
  }

  cleanup() {
      // Cancel animation frame if exists
      if (this.animationFrameId) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
      }
      // Remove other event listeners if added manually
  }
  ```

## Example Plugins

### 1. Basic Gain Plugin

A simple example showing parameter control:

```javascript
class GainPlugin extends PluginBase {
    constructor() {
        super('Gain', 'Simple gain adjustment');
        this.gn = 1.0; // gn: Gain (formerly gain) - Range: 0 to 2

        this.registerProcessor(`
            if (!parameters.enabled) return data;
            const gain = parameters.gn; // Use shortened parameter name
            
            // Process all channels
            for (let ch = 0; ch < parameters.channelCount; ch++) {
                const offset = ch * parameters.blockSize;
                for (let i = 0; i < parameters.blockSize; i++) {
                    data[offset + i] *= gain;
                }
            }
            return data;
        `);
    }

    // Get current parameters
    getParameters() {
        return {
            type: this.constructor.name,
            gn: this.gn, // Use shortened parameter name
            enabled: this.enabled
        };
    }

    // Set parameters (only handles 'gn' parameter)
    setParameters(params) {
        if (params.gn !== undefined) {
            const value = typeof params.gn === 'number' 
                ? params.gn 
                : parseFloat(params.gn);
            if (!isNaN(value)) {
                this.gn = Math.max(0, Math.min(2, value)); // Clamp value
            }
        }
        // Note: 'enabled' is handled by PluginBase.setEnabled()
        this.updateParameters(); // Notify host about changes
    }

    // Individual parameter setter for convenience
    setGain(value) {
        this.setParameters({ gn: value }); // Use shortened parameter name
    }

    createUI() {
        const container = document.createElement('div');
        
        // Use the helper function to create the gain control
        // Label remains 'Gain', state variable is 'this.gn'
        const gainControl = this.createParameterControl(
            'Gain', 0, 2, 0.01, this.gn, (newValue) => {
                this.setGain(newValue); // Calls setParameters({ gn: ... })
            }
        );
        container.appendChild(gainControl);
        
        return container;
    }
}
```

### 2. Level Meter Plugin

An advanced example showing visualization and message passing:

```javascript
class LevelMeterPlugin extends PluginBase {
    constructor() {
        super('Level Meter', 'Displays audio level');
        
        // Initialize state (e.g., for stereo)
        this.levels = new Array(2).fill(-96); // Current dB levels
        this.animationFrameId = null;
        
        // Register processor function to calculate peak levels
        this.registerProcessor(`
            const numChannels = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const peaks = new Float32Array(numChannels);
            
            // Calculate peak absolute value for each channel
            for (let ch = 0; ch < numChannels; ch++) {
                const offset = ch * blockSize;
                const end = offset + blockSize;
                let peak = 0.0;
                for (let i = offset; i < end; i++) {
                    const sample = data[i];
                    const absSample = sample < 0 ? -sample : sample; // Fast abs()
                    if (absSample > peak) {
                        peak = absSample;
                    }
                }
                peaks[ch] = peak;
            }
        
            // Create measurements object
            const channelMeasurements = new Array(numChannels);
            for (let ch = 0; ch < numChannels; ch++) {
                channelMeasurements[ch] = { peak: peaks[ch] }; // Send peak linear amplitude
            }
        
            // Attach measurements to the data buffer for the main thread
            data.measurements = {
                channels: channelMeasurements,
                time: time // Current audio context time
            };
            return data; // Return original audio data unmodified
        `);
    }

    // Handle messages from audio processor
    onMessage(message) {
        // Check if the message is for this plugin and contains measurements
        if (message.type === 'processBuffer' && message.buffer?.measurements && message.pluginId === this.id) {
            this.processMeasurements(message.buffer.measurements);
        }
    }

    // Convert linear amplitude to dBFS
    amplitudeToDB(amplitude) {
        // Prevent log(0) issues
        return 20 * Math.log10(amplitude < 1e-5 ? 1e-5 : amplitude);
    }

    // Process measurements received from the audio thread
    processMeasurements(measurements) {
        // Update internal levels based on received peak values
        for (let ch = 0; ch < measurements.channels.length; ch++) {
            if (ch < this.levels.length) { // Ensure we don't exceed array bounds
                const peakAmplitude = measurements.channels[ch].peak;
                this.levels[ch] = this.amplitudeToDB(peakAmplitude);
            }
        }
        // Note: UI update happens in the animation frame loop
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'level-meter-plugin-ui';

        // Create canvas for meter display
        const canvas = document.createElement('canvas');
        canvas.width = 200; // Simple width
        canvas.height = 40; // Simple height for stereo
        container.appendChild(canvas);
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        // Start the animation loop when UI is created
        this.startAnimation();

        return container;
    }

    // Start drawing loop
    startAnimation() {
        if (this.animationFrameId) return; // Prevent multiple loops
        const animate = () => {
            this.updateMeterDisplay();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        this.animationFrameId = requestAnimationFrame(animate);
    }

    // Stop drawing loop
    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    // Update meter display (called in animation loop)
    updateMeterDisplay() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const numChannels = this.levels.length;
        const channelHeight = height / numChannels;
        const dbRange = 96; // Display range (-96dB to 0dB)
        const dbStart = -96;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#333'; // Background
        ctx.fillRect(0, 0, width, height);

        // Draw simple meter bar for each channel
        for (let ch = 0; ch < numChannels; ch++) {
            const y = ch * channelHeight;
            const levelWidth = width * Math.max(0, (this.levels[ch] - dbStart)) / dbRange;
            
            // Simple green bar, red if above -6dB
            ctx.fillStyle = this.levels[ch] > -6 ? '#ff0000' : '#00ff00'; 
            ctx.fillRect(0, y + channelHeight * 0.1, levelWidth, channelHeight * 0.8);
        }
    }

    // Cleanup resources
    cleanup() {
        this.stopAnimation();
        // No IntersectionObserver in this simple example
    }
}
```

## Advanced Features

### Message Passing with Audio Worklet

Plugins can communicate between the main thread and Audio Worklet using message passing:

1. From Audio Worklet to main thread:
```javascript
port.postMessage({
    type: 'myMessageType',
    pluginId: parameters.id,
    data: myData
});
```

2. Receive messages in the main thread:
```javascript
constructor() {
    super('My Plugin', 'Description');
    
    // Listen for messages from Audio Worklet
    if (window.workletNode) {
        window.workletNode.port.addEventListener('message', (e) => {
            if (e.data.pluginId === this.id) {
                // Handle message
            }
        });
    }
}
```

## Instance-Specific State Management

Plugins can maintain instance-specific state in the audio processor using the `context` object. This is particularly useful for effects that need to track state between processing blocks, such as filters, modulation effects, or any effect requiring sample history.

### Using the Context Object

The `context` object is unique to each plugin instance and persists across processing calls. Here's how to use it:

1. **Initialize State Variables**
```javascript
// Check if state exists first
context.myState = context.myState || initialValue;

// Or use an initialization flag
if (!context.initialized) {
    context.myState = initialValue;
    context.initialized = true;
}
```

2. **Handle Channel Count Changes**
```javascript
// Reset state if channel configuration changes
if (context.buffers?.length !== parameters.channelCount) {
    context.buffers = new Array(parameters.channelCount)
        .fill()
        .map(() => new Float32Array(bufferSize));
}
```

### Examples

1. **Filter State (from Narrow Range plugin)**
```javascript
// Initialize filter states for all channels
if (!context.initialized) {
    context.filterStates = {
        // HPF states (first stage)
        hpf1: new Array(channelCount).fill(0),
        hpf2: new Array(channelCount).fill(0),
        // ... more filter states
    };
    context.initialized = true;
}

// Reset if channel count changes
if (context.filterStates.hpf1.length !== channelCount) {
    Object.keys(context.filterStates).forEach(key => {
        context.filterStates[key] = new Array(channelCount).fill(0);
    });
}
```

2. **Modulation State (from Wow Flutter plugin)**
```javascript
// Initialize modulation state
context.phase = context.phase || 0;
context.lpfState = context.lpfState || 0;
context.sampleBufferPos = context.sampleBufferPos || 0;

// Initialize delay buffer if needed
if (!context.initialized) {
    context.sampleBuffer = new Array(parameters.channelCount)
        .fill()
        .map(() => new Float32Array(MAX_BUFFER_SIZE).fill(0));
    context.initialized = true;
}
```

3. **Envelope State (from Compressor plugin)**
```javascript
// Initialize envelope states for dynamics processing
if (!context.initialized) {
    context.envelopeStates = new Array(channelCount).fill(0);
    context.initialized = true;
}

// Reset envelope states if channel count changes
if (context.envelopeStates.length !== channelCount) {
    context.envelopeStates = new Array(channelCount).fill(0);
}

// Example usage in dynamics processing
for (let ch = 0; ch < channelCount; ch++) {
    let envelope = context.envelopeStates[ch];
    
    // Process samples with envelope follower
    for (let i = 0; i < blockSize; i++) {
        const inputAbs = Math.abs(data[offset + i]);
        if (inputAbs > envelope) {
            envelope = attackSamples * (envelope - inputAbs) + inputAbs;
        } else {
            envelope = releaseSamples * (envelope - inputAbs) + inputAbs;
        }
        // Apply envelope-based processing...
    }
    
    // Store envelope state for next buffer
    context.envelopeStates[ch] = envelope;
}
```

### Best Practices for State Management

1. **Initialization**
   - Always check if state exists before using it
   - Use an initialization flag for complex setup
   - Initialize arrays and buffers to appropriate sizes

2. **Channel Count Changes**
   - Monitor and handle changes in channel configuration
   - Reset or resize state arrays when needed
   - Maintain state per channel when appropriate

3. **Memory Management**
   - Pre-allocate buffers to avoid garbage collection
   - Use typed arrays (Float32Array) for better performance
   - Clear or reset large buffers when plugin is disabled

4. **State Access**
   - Access state variables through the context object
   - Update state consistently across processing blocks
   - Consider thread safety in state modifications

## Testing and Debugging

### Using the Test Tool

The project includes a test tool for validating plugin implementations. To use it:

1. Start the development server:
```bash
python server.py
```

2. Open the test page in your browser:
```
http://localhost:8000/dev/effetune_test.html
```

The test tool performs the following checks for each plugin:
- Constructor implementation (plugin ID)
- Parameter management (required fields)
- UI creation
- Enabled state handling
- Parameter update notifications

Results are color-coded:
- 🟢 Green: Test passed successfully
- 🟡 Yellow: Warning (potential issue)
- 🔴 Red: Test failed

Use this tool during development to ensure your plugin follows the required implementation guidelines.

### Manual Testing

1. **Parameter Testing**
   - Test parameter validation thoroughly
   - Verify type checking and range validation
   - Test with invalid inputs to ensure proper handling
   - Use the provided `setEnabled` method for enable/disable
   - Example test cases:
     ```javascript
     // Test invalid type
     plugin.setParameters({ gain: 'invalid' });
     assert(plugin.gain === originalGain);  // Should keep original value

     // Test out of range
     plugin.setParameters({ gain: 999 });
     assert(plugin.gain <= 2);  // Should clamp to valid range

     // Test enable/disable
     plugin.setEnabled(false);
     assert(plugin.getParameters().enabled === false);
     ```

2. **Audio Processing Testing**
   - Note: Audio Worklet code runs in a separate context
   - Cannot directly test processor function
   - Focus on parameter validation and state management
   - Test enabled state handling:
     ```javascript
     process(audioBuffer, message) {
         if (!audioBuffer || !message?.measurements?.channels) {
             return audioBuffer;
         }

         // Skip processing if disabled
         if (!this.enabled) {
             return audioBuffer;
         }

         // Continue with audio processing...
     }
     ```

3. **UI Testing**
   - Verify UI updates reflect parameter changes
   - Test UI responsiveness in both enabled/disabled states
   - For visualization plugins:
     * Continue UI updates even when disabled
     * Only skip audio processing when disabled
     * Do not stop animations in cleanup()

2. **Parameter Validation**
   - Always validate and sanitize parameter values
   - Use appropriate min/max bounds for numerical values
   - Check channelCount and blockSize parameters

3. **Performance**
   - Keep audio processing code efficient
   - Minimize object creation in the processing function
   - Pre-calculate constants outside loops
   - Use simple mathematical operations where possible

3. **UI Design**
    - Keep controls intuitive and responsive
    - Provide appropriate value ranges and steps
    - Include units in labels where applicable
    - When using radio buttons, include plugin ID in the name attribute (e.g., `name="radio-group-${this.id}"`) to ensure each plugin instance has its own independent radio button group. This is critical when multiple instances of plugins with radio buttons are used simultaneously, as radio buttons with the same name attribute will interfere with each other. Example:
      ```javascript
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `channel-${this.id}`; // Include plugin ID to make it unique
      radio.value = 'Left';
      ```
    - Use effetune.css styles as much as possible to maintain consistent look and feel across plugins
    - When defining plugin-specific CSS, include the plugin name in class names to avoid style conflicts and duplication. Example:
      ```css
      .my-plugin-container { /* Plugin-specific styles */ }
      .my-plugin-slider { /* Custom slider styles */ }
      ```
    - Follow the standard CSS styles for common UI elements to maintain consistency across plugins
    - Keep plugin-specific CSS minimal and focused on unique styling needs
    - Use the base CSS classes for standard elements (e.g., `.parameter-row`, `.radio-group`) to ensure consistent layout and appearance
    - Only add custom CSS for plugin-specific UI elements that require unique styling

4. **Accessibility and Input Element Attributes**
    - All input elements must have IDs that follow the format `${this.id}-${this.name}-[type]` where:
      * `this.id` is the plugin's unique ID
      * `this.name` is the plugin's name
      * `[type]` is a descriptor for the input (e.g., "slider", "input", "checkbox")
    - For radio button groups, use a consistent name attribute that follows the same format as IDs: `${this.id}-${this.name}-[group-name]`
    - All input elements must have the `autocomplete="off"` attribute to prevent browser autocomplete from interfering with plugin controls
    - Associate labels with inputs using the `htmlFor` attribute that matches the input's ID
    - Example for a slider and text input pair:
      ```javascript
      // Slider
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = `${this.id}-${this.name}-slider`;
      slider.name = `${this.id}-${this.name}-slider`;
      slider.autocomplete = "off";
      
      // Text input
      const valueInput = document.createElement('input');
      valueInput.type = 'number';
      valueInput.id = `${this.id}-${this.name}-input`;
      valueInput.name = `${this.id}-${this.name}-input`;
      valueInput.autocomplete = "off";
      
      // Label (associated with slider)
      const label = document.createElement('label');
      label.textContent = 'Parameter:';
      label.htmlFor = `${this.id}-${this.name}-slider`;
      ```
    - Example for radio buttons:
      ```javascript
      const options = ['option1', 'option2', 'option3'];
      
      options.forEach(option => {
          // Radio button
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `${this.id}-${this.name}-options`;
          radio.id = `${this.id}-${this.name}-${option}`;
          radio.value = option;
          radio.autocomplete = "off";
          
          // Label for this radio button
          const label = document.createElement('label');
          label.htmlFor = `${this.id}-${this.name}-${option}`;
          label.textContent = option.charAt(0).toUpperCase() + option.slice(1);
          
          // Add to container
          container.appendChild(radio);
          container.appendChild(label);
      });
      ```

4. **Error Handling**
   - Validate all inputs in both UI and processing code
   - Provide fallback values for invalid parameters
   - Handle edge cases gracefully (e.g., mono vs stereo)

## Plugin Categories

Plugins are organized into categories defined in `plugins/plugins.txt`:

- `Analyzer`: Analysis tools (level meters, spectrum analyzers, etc.)
- `Basics`: Basic audio effects (volume, balance, DC offset, etc.)
- `Dynamics`: Dynamic range processors (compressors, gates, etc.)
- `EQ`: Equalization effects (filters, frequency shaping)
- `Filter`: Time-based filter effects (modulation, wow flutter)
- `Lo-Fi`: Lo-Fi audio effects (bit crushing, jitter)
- `Others`: Miscellaneous effects (oscillators, etc.)
- `Reverb`: Reverberation effects (room simulation, etc.)
- `Saturation`: Saturation and distortion effects
- `Spatial`: Spatial audio effects (stereo field processing)

To add a new category:
1. Add it to the `[categories]` section in `plugins.txt`
2. Provide a clear description of what types of plugins belong in this category
3. Create an appropriate subdirectory in the `plugins` directory
