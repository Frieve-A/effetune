class AudioFeedTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = options.processorOptions.channels;
    this.frames = options.processorOptions.frames;
    this.audio = new Float32Array(this.frames * this.channels);
    this.used = 0;
    this.generation = 0;
    this.nextSourceFrame = null;
    this.silent = false;
    this.port.onmessage = ({data}) => {
      if (data.port) this.feed = data.port;
      if (Number.isSafeInteger(data.generation)) {
        if (Number.isInteger(data.channels) && data.channels > 0 && data.channels <= 16 && data.channels !== this.channels) {
          this.channels = data.channels;
          this.audio = new Float32Array(this.frames * this.channels);
        }
        this.generation = data.generation;
        this.nextSourceFrame = null;
        this.used = 0;
        this.silent = false;
      }
    };
  }

  process(inputs, outputs) {
    if (!this.feed) return true;
    const input = inputs[0], length = outputs[0][0].length;
    // The null sink can repeat a currentFrame quantum and catch up on the next.
    // Anchor once per generation and count the samples actually delivered.
    const blockFrame = this.nextSourceFrame ?? currentFrame;
    this.nextSourceFrame = blockFrame + length;
    for (let i = 0; i < length; ++i) {
      if (!this.used) { this.first = blockFrame + i; this.hasSignal = false; }
      for (let ch = 0; ch < this.channels; ++ch) {
        const sample = input[ch]?.[i] || 0;
        this.audio[ch * this.frames + this.used] = sample;
        if (sample !== 0) this.hasSignal = true;
      }
      if (++this.used !== this.frames) continue;
      if (this.hasSignal) {
        this.feed.postMessage({type:'feed', generation:this.generation, sourceFrame:this.first,
          frames:this.frames, channelCount:this.channels, attachment:this.audio.buffer});
      } else if (!this.silent) {
        this.feed.postMessage({type:'feedSilence',generation:this.generation,sourceFrame:this.first});
      }
      this.silent = !this.hasSignal;
      this.used = 0;
    }
    return true;
  }
}
registerProcessor('effetune-native-feed', AudioFeedTap);
