import assert from 'node:assert/strict';
import test from 'node:test';
import { LivePcmCore, LIVE_PREROLL_FRAMES, LIVE_RING_FRAMES } from '../../js/ui/audio-player/live-pcm-core.js';

function slab(startFrame, frameCount, value = frame => Math.sin(2*Math.PI*1000*frame/44100)) {
  const left = new Float32Array(frameCount), right = new Float32Array(frameCount);
  for(let i=0;i<frameCount;i+=1) { left[i]=value(startFrame+i); right[i]=-left[i]; }
  return {startFrame,frameCount,planes:[left.buffer,right.buffer]};
}
function fill(core,count,value) {
  for(let start=0;start<count;start+=4096) core.push(slab(start,Math.min(4096,count-start),value));
}

test('live PCM continuous resampling preserves stereo level and tone at supported context rates', () => {
  for(const rate of [32000,44100,48000,96000]) {
    const core = new LivePcmCore(rate);
    fill(core,16000);
    const left = new Float32Array(128), right = new Float32Array(128);
    let energy=0,frames=0,crossings=0,previous=0;
    const warmup = Math.ceil(rate * 0.006);
    for(let block=0;block<40;block+=1) {
      core.render([left,right]);
      for(let i=0;i<128;i+=1) {
        assert.equal(right[i],-left[i]);
        if(frames>warmup) { energy+=left[i]*left[i]; if(previous<=0&&left[i]>0) crossings+=1; }
        previous=left[i]; frames+=1;
      }
    }
    assert.ok(Math.abs(Math.sqrt(energy/(frames-warmup-1))-Math.SQRT1_2)<0.01, `level at ${rate}`);
    assert.ok(Math.abs(crossings-1000*(frames-warmup-1)/rate)<2, `frequency at ${rate}`);
  }
});

test('live downsampling suppresses frequencies above the output Nyquist limit', () => {
  const core = new LivePcmCore(32000);
  fill(core,16000,frame=>Math.sin(2*Math.PI*20000*frame/44100));
  const left=new Float32Array(128),right=new Float32Array(128);
  let energy=0,count=0;
  for(let block=0;block<40;block+=1) {
    core.render([left,right]);
    if(block>0) for(const value of left) {energy+=value*value;count+=1;}
  }
  assert.ok(Math.sqrt(energy/count)<0.005);
});

test('live clock drift stays bounded without accumulating scheduled sources or PCM', () => {
  const core = new LivePcmCore(48000);
  const initial=LIVE_PREROLL_FRAMES+500;
  fill(core,initial,()=>0.25);
  let position=initial, arrival=0;
  const left=new Float32Array(128),right=new Float32Array(128);
  for(let block=0;block<11250;block+=1) {
    arrival+=128*44100/48000*1.001;
    const frames=Math.floor(arrival); arrival-=frames;
    core.push(slab(position,frames,()=>0.25)); position+=frames;
    core.render([left,right]);
  }
  assert.equal(core.underruns,0);
  assert.ok(core.bufferedFrames>LIVE_PREROLL_FRAMES/2 && core.bufferedFrames<LIVE_PREROLL_FRAMES*2);
  assert.equal(core.ring[0].length,LIVE_RING_FRAMES);
  assert.equal(core.rebuffers,0);
});

test('live reset, overflow and malformed slabs keep the source finite and rebuffer to fresh samples', () => {
  const core=new LivePcmCore(48000);
  assert.equal(core.push({startFrame:0,frameCount:100,planes:[new ArrayBuffer(1)]}),false);
  for(let index=0;index<30;index+=1) core.push(slab(index*4096,4096,()=>0.5));
  assert.ok(core.rebuffers>0);
  assert.ok(core.bufferedFrames<LIVE_RING_FRAMES);
  core.reset(200000);
  assert.equal(core.writeFrame,200000);
  const left=new Float32Array(128),right=new Float32Array(128);
  core.render([left,right]);
  assert.ok(left.every(value=>value===0));
});

test('live clock correction converges for both drift directions with packet jitter', () => {
  for (const offset of [-0.001, 0, 0.001]) {
    const core = new LivePcmCore(8000);
    fill(core, LIVE_PREROLL_FRAMES, () => 0.25);
    let position = LIVE_PREROLL_FRAMES, arrival = 0;
    const left = new Float32Array(128), right = new Float32Array(128);
    for (let block = 0; block < 15000; block += 1) {
      arrival += 128 * 44100 / 8000 * (1 + offset);
      if (block % 2 === 1) {
        const frames = Math.floor(arrival); arrival -= frames;
        core.push(slab(position, frames, () => 0.25)); position += frames;
      }
      core.render([left, right]);
    }
    assert.equal(core.underruns, 0);
    assert.equal(core.rebuffers, 0);
    assert.ok(Math.abs(core.bufferedFrames + arrival - LIVE_PREROLL_FRAMES) < 1000, `offset ${offset}: ${core.bufferedFrames}`);
  }
});

test('live discontinuity and underrun fade to silence and resume smoothly', () => {
  const core = new LivePcmCore(48000);
  const left = new Float32Array(128), right = new Float32Array(128);
  fill(core, LIVE_PREROLL_FRAMES + 1024, () => 0.5);
  for (let i = 0; i < 4; i += 1) core.render([left, right]);
  let previous = left[left.length - 1];
  core.push(slab(100000, 128, () => -0.5));
  for (let block = 0; block < 4; block += 1) {
    core.render([left, right]);
    for (const value of left) { assert.ok(Math.abs(value - previous) < 0.02); previous = value; }
  }
  assert.equal(previous, 0);
  for (let start = 100128; start < 106000; start += 1024) {
    core.push(slab(start, Math.min(1024, 106000 - start), () => -0.5));
  }
  for (let block = 0; block < 60; block += 1) {
    core.render([left, right]);
    for (const value of left) { assert.ok(Math.abs(value - previous) < 0.02); previous = value; }
  }
  assert.equal(core.underruns, 1);
  assert.equal(previous, 0);
});

test('live depletion recovers smoothly when a contiguous slab arrives before underrun', () => {
  const core = new LivePcmCore(48000);
  const left = new Float32Array(128), right = new Float32Array(128);
  fill(core, LIVE_PREROLL_FRAMES, () => 0.5);
  while (core.bufferedFrames > 180) core.render([left, right]);
  const previous = left[127];
  assert.ok(previous > 0 && previous < 0.45);
  core.push(slab(core.writeFrame, 1000, () => 0.5));
  core.render([left, right]);
  assert.ok(Math.abs(left[0] - previous) < 0.01);
  for (let i = 1; i < left.length; i += 1) assert.ok(Math.abs(left[i] - left[i - 1]) < 0.01);
  assert.equal(core.underruns, 0);
});

test('clock correction uses elapsed audio time across render quantum sizes', () => {
  function run(quantum) {
    const core = new LivePcmCore(8000);
    fill(core, LIVE_PREROLL_FRAMES, () => 0.25);
    let position = LIVE_PREROLL_FRAMES, arrival = 0;
    const left = new Float32Array(quantum), right = new Float32Array(quantum);
    for (let frame = 0; frame < 800000; frame += quantum) {
      if (frame % 256 === 0) {
        arrival += 256 * 44100 / 8000 * 1.001;
        const count = Math.floor(arrival); arrival -= count;
        core.push(slab(position, count, () => 0.25)); position += count;
      }
      core.render([left, right]);
    }
    return core;
  }
  const small = run(128), large = run(256);
  assert.ok(Math.abs(small.drift - large.drift) < 0.00001);
  assert.ok(Math.abs(small.readPosition - large.readPosition) < 20);
});

test('live clock correction remains stable over an hour at 300 ppm and zero offset', () => {
  for (const offset of [-0.0003, 0, 0.0003]) {
    const core = new LivePcmCore(8000);
    fill(core, LIVE_PREROLL_FRAMES, () => 0.25);
    let position = LIVE_PREROLL_FRAMES, arrival = 0, low = Infinity, high = -Infinity;
    const left = new Float32Array(256), right = new Float32Array(256);
    for (let block = 0; block < 112500; block += 1) {
      arrival += 256 * 44100 / 8000 * (1 + offset);
      const count = Math.floor(arrival); arrival -= count;
      core.push(slab(position, count, () => 0.25)); position += count;
      core.render([left, right]);
      if (block >= 18750) {
        low = Math.min(low, core.bufferedFrames);
        high = Math.max(high, core.bufferedFrames);
      }
    }
    assert.equal(core.underruns, 0);
    assert.equal(core.rebuffers, 0);
    assert.ok(low > LIVE_PREROLL_FRAMES - 1000 && high < LIVE_PREROLL_FRAMES + 1000, `${offset}: ${low} to ${high}`);
    assert.ok(high - low < 200, `${offset}: ${low} to ${high}`);
    assert.ok(Math.abs(core.drift - offset) < 0.00001, `${offset}: ${core.drift}`);
  }
});
