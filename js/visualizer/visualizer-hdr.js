const HDR_ATTRIBUTES = { colorSpace: 'display-p3', colorType: 'float16' };

// Keep extended colors encoded in the canvas color space through every copy.
// WebGPU's srgb/display-p3 canvas spaces use the same transfer curve as Canvas 2D.
export class VisualizerHDROutput {
    constructor(canvas, overlay) {
        this.canvas = canvas;
        this.overlay = overlay;
        this.window = overlay.ownerDocument.defaultView;
        this.enabled = false;
        this.failed = false;
        this.generation = 0;
        this.show(false);
    }

    show(active) {
        this.overlay.hidden = !active;
        this.canvas.style.opacity = active ? '0' : '';
    }

    setEnabled(enabled) {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        if (!enabled) this.dispose();
        else this.failed = false;
    }

    prepare() {
        if (!this.enabled || this.failed || !this.window.matchMedia('(dynamic-range: high)').matches) return false;
        if (this.ready) return true;
        if (!this.pending) {
            const generation = this.generation;
            this.pending = this.initialize().catch(error => {
                if (generation !== this.generation) return;
                console.warn('Visualizer HDR initialization failed:', error);
                this.failed = true;
                this.release();
            }).finally(() => { this.pending = null; });
        }
        return false;
    }

    async initialize() {
        const generation = this.generation;
        const probe = this.overlay.ownerDocument.createElement('canvas');
        const context = probe.getContext('2d', HDR_ATTRIBUTES);
        const attributes = context?.getContextAttributes();
        if (attributes?.colorType !== 'float16' || attributes.colorSpace !== 'display-p3' ||
            !('globalHDRHeadroom' in context) || !this.window.navigator.gpu) {
            this.failed = true;
            return;
        }
        const adapter = await this.window.navigator.gpu.requestAdapter();
        if (!adapter) { this.failed = true; return; }
        const device = await adapter.requestDevice();
        if (generation !== this.generation) { device.destroy(); return; }
        this.device = device;
        this.context = this.overlay.getContext('webgpu');
        this.context.configure({ device, format: 'rgba16float', colorSpace: 'display-p3',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
            alphaMode: 'premultiplied', toneMapping: { mode: 'extended' } });
        if (this.context.getConfiguration().toneMapping?.mode !== 'extended') throw new Error('Extended output unavailable');
        this.colorCanvas = this.overlay.ownerDocument.createElement('canvas');
        this.colorContext = this.colorCanvas.getContext('webgpu');
        this.colorContext.configure({ device, format: 'rgba16float', colorSpace: 'srgb',
            alphaMode: 'premultiplied', toneMapping: { mode: 'extended' } });
        this.uniforms = device.createBuffer({ size: 64 + 256 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.parameters = new Float32Array(16 + 256 * 4);
        const module = device.createShaderModule({ code: COLOR_SHADER });
        this.pipeline = await device.createRenderPipelineAsync({ layout: 'auto',
            vertex: { module, entryPoint: 'vertexMain' },
            fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float' }] } });
        if (generation !== this.generation) return;
        this.ready = true;
        device.lost.then(info => {
            if (this.device !== device) return;
            console.warn('Visualizer HDR device lost:', info.message);
            this.failed = true;
            this.release();
        });
        device.addEventListener('uncapturederror', event => {
            if (this.device !== device) return;
            console.warn('Visualizer HDR GPU error:', event.error);
            this.failed = true;
            this.release();
        });
    }

    present(source) {
        const { width, height } = source;
        if (this.overlay.width !== width) this.overlay.width = width;
        if (this.overlay.height !== height) this.overlay.height = height;
        this.device.queue.copyExternalImageToTexture({ source },
            { texture: this.context.getCurrentTexture(), colorSpace: 'display-p3', premultipliedAlpha: true }, [width, height]);
        this.show(true);
    }

    color(target, source, effect, amount, palette) {
        target.globalHDRHeadroom = Infinity;
        const { width, height } = source, device = this.device;
        if (!this.texture || this.colorCanvas.width !== width || this.colorCanvas.height !== height) {
            this.texture?.destroy();
            this.colorCanvas.width = width; this.colorCanvas.height = height;
            this.texture = device.createTexture({ size: [width, height], format: 'rgba16float',
                usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
            this.bindGroup = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
                { binding: 0, resource: this.texture.createView() }, { binding: 1, resource: { buffer: this.uniforms } }
            ] });
        }
        const p = this.parameters;
        p.set([effect.type === 'color-map' ? 1 : 0, amount, effect.brightness ?? 0, effect.contrast ?? 1,
            effect.saturation ?? 1, (effect.hue ?? 0) * Math.PI / 180, effect.gamma ?? 1, effect.inputBlack ?? 0,
            effect.inputWhite ?? 1, effect.outputBlack ?? 0, effect.outputWhite ?? 1, effect.temperature ?? 0,
            effect.tint ?? 0, effect.invert ? 1 : 0, effect.steps || 0, effect.threshold ?? .5]);
        if (palette) for (let i = 0; i < palette.length; i++) p.set([...palette[i], 1], 16 + i * 4);
        device.queue.writeBuffer(this.uniforms, 0, p);
        device.queue.copyExternalImageToTexture({ source }, { texture: this.texture, colorSpace: 'srgb', premultipliedAlpha: false }, [width, height]);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.colorContext.getCurrentTexture().createView(),
            loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
        pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.bindGroup); pass.draw(3); pass.end();
        device.queue.submit([encoder.finish()]);
        target.drawImage(this.colorCanvas, 0, 0);
    }

    glow(target, small, source) {
        const device = this.device, { width, height } = source;
        if (!this.glowCanvas) {
            this.glowCanvas = this.overlay.ownerDocument.createElement('canvas');
            this.glowContext = this.glowCanvas.getContext('webgpu');
            this.glowContext.configure({ device, format: 'rgba16float', colorSpace: 'display-p3',
                alphaMode: 'premultiplied', toneMapping: { mode: 'extended' } });
            const module = device.createShaderModule({ code: GLOW_SHADER });
            this.glowPipeline = device.createRenderPipeline({ layout: 'auto',
                vertex: { module, entryPoint: 'vertexMain' },
                fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float' }] } });
            this.glowSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
            this.glowTextures = [];
        }
        if (this.glowCanvas.width !== width) this.glowCanvas.width = width;
        if (this.glowCanvas.height !== height) this.glowCanvas.height = height;
        const entries = [target.canvas, small, source].map((canvas, binding) => {
            let texture = this.glowTextures[binding];
            if (!texture || texture.width !== canvas.width || texture.height !== canvas.height) {
                texture?.destroy();
                texture = device.createTexture({ size: [canvas.width, canvas.height], format: 'rgba16float',
                    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
                this.glowTextures[binding] = texture;
            }
            device.queue.copyExternalImageToTexture({ source: canvas },
                { texture, colorSpace: 'display-p3', premultipliedAlpha: true }, [canvas.width, canvas.height]);
            return { binding, resource: texture.createView() };
        });
        entries.push({ binding: 3, resource: this.glowSampler });
        const bindGroup = device.createBindGroup({ layout: this.glowPipeline.getBindGroupLayout(0), entries });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.glowContext.getCurrentTexture().createView(),
            loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
        pass.setPipeline(this.glowPipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
        device.queue.submit([encoder.finish()]);
        target.globalHDRHeadroom = Infinity;
        target.globalCompositeOperation = 'copy';
        target.drawImage(this.glowCanvas, 0, 0);
    }

    release() {
        this.ready = false;
        this.show(false);
        this.texture?.destroy(); this.texture = null;
        this.uniforms?.destroy(); this.uniforms = null;
        for (const texture of this.glowTextures || []) texture.destroy();
        this.glowTextures = null;
        this.glowContext?.unconfigure(); this.glowCanvas = null;
        this.context?.unconfigure(); this.colorContext?.unconfigure();
        const device = this.device;
        this.device = null;
        device?.destroy();
    }

    dispose() {
        this.generation++;
        this.release();
    }
}

// Canvas2D's lighter operation clamps RGB even on float16 surfaces. Add the
// premultiplied glow layers here instead, limiting coverage but not brightness.
const GLOW_SHADER = `
@group(0) @binding(0) var blurred: texture_2d<f32>;
@group(0) @binding(1) var small: texture_2d<f32>;
@group(0) @binding(2) var source: texture_2d<f32>;
@group(0) @binding(3) var imageSampler: sampler;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let positions = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
    return vec4f(positions[index],0,1);
}
@fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let pixel = vec2i(position.xy);
    let uv = position.xy / vec2f(textureDimensions(source));
    let color = textureLoad(blurred, pixel, 0) + textureSample(small, imageSampler, uv) + textureLoad(source, pixel, 0);
    return vec4f(color.rgb, min(color.a, 1.0));
}`;

const COLOR_SHADER = `
@group(0) @binding(0) var image: texture_2d<f32>;
struct Parameters {
    kind: f32, amount: f32, brightness: f32, contrast: f32,
    saturation: f32, hue: f32, gamma: f32, inputBlack: f32,
    inputWhite: f32, outputBlack: f32, outputWhite: f32, temperature: f32,
    tint: f32, invert: f32, steps: f32, threshold: f32,
    palette: array<vec4f, 256>
};
@group(0) @binding(1) var<uniform> p: Parameters;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let positions = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
    return vec4f(positions[index],0,1);
}
@fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let source = textureLoad(image, vec2i(position.xy), 0);
    var color = source.rgb;
    if (p.kind == 1) {
        let luminance = clamp(dot(color, vec3f(.2126,.7152,.0722)), 0.0, 1.0);
        if (p.steps > 0) {
            var index = min(u32(luminance * p.steps), u32(p.steps) - 1);
            if (p.steps == 2) { index = select(0u, 1u, luminance >= p.threshold); }
            color = p.palette[index].rgb;
        } else {
            let offset = luminance * 255;
            let index = min(u32(offset), 254u);
            color = mix(p.palette[index].rgb, p.palette[index + 1].rgb, offset - f32(index));
        }
    } else {
        color = (color - p.inputBlack) / (p.inputWhite - p.inputBlack);
        color = sign(color) * pow(abs(color), vec3f(1 / p.gamma));
        color = (color + p.brightness - .5) * p.contrast + .5;
        let luminance = dot(color, vec3f(.213,.715,.072));
        color = mix(vec3f(luminance), color, p.saturation);
        let c = cos(p.hue); let s = sin(p.hue);
        color = vec3f(
            dot(color, vec3f(.213 + c*.787 - s*.213, .715 - c*.715 - s*.715, .072 - c*.072 + s*.928)),
            dot(color, vec3f(.213 - c*.213 + s*.143, .715 + c*.285 + s*.140, .072 - c*.072 - s*.283)),
            dot(color, vec3f(.213 - c*.213 - s*.787, .715 - c*.715 + s*.715, .072 + c*.928 + s*.072)));
        color += vec3f(p.temperature + p.tint, -p.tint, p.tint - p.temperature) * .25;
        color = color * (p.outputWhite - p.outputBlack) + p.outputBlack;
        if (p.invert == 1) { color = vec3f(1) - color; }
    }
    return vec4f(mix(source.rgb, color, p.amount) * source.a, source.a);
}`;
