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
    for(let block=0;block<40;block+=1) {
      core.render([left,right]);
      for(let i=0;i<128;i+=1) {
        assert.equal(right[i],-left[i]);
        if(frames>64) { energy+=left[i]*left[i]; if(previous<=0&&left[i]>0) crossings+=1; }
        previous=left[i]; frames+=1;
      }
    }
    assert.ok(Math.abs(Math.sqrt(energy/(frames-65))-Math.SQRT1_2)<0.01, `level at ${rate}`);
    assert.ok(Math.abs(crossings-1000*(frames-65)/rate)<2, `frequency at ${rate}`);
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
