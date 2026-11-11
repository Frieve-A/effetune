import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { AirPlayPlayback } from '../../js/ui/audio-player/airplay-playback.js';
import { AudioContextManager } from '../../js/ui/audio-player/audio-context-manager.js';
import { LivePcmCore } from '../../js/ui/audio-player/live-pcm-core.js';

function fixture() {
  const events=[], state={}, connected=new Set();
  const gain=()=>({gain:{value:1,setValueAtTime(value,time){this.value=value;events.push(['set-gain',value,time]);},
    linearRampToValueAtTime(value,time){this.value=value;events.push(['ramp-gain',value,time]);},
    cancelAndHoldAtTime(time){events.push(['hold-gain',time]);}},connect(){},disconnect(){events.push('disconnect-node');}});
  const context={sampleRate:48000,currentTime:10,state:'running',createGain:gain,audioWorklet:{async addModule(){}}};
  const audioManager={sourceNode:gain(),ioManager:{},workletNode:{},
    connectSourceToPipeline(node){connected.add(node);events.push('connect-source');return true;},
    ensureSourceConnectedToPipeline(node){connected.add(node);return true;},
    isSourceConnectedToPipeline:node=>connected.has(node),
    disconnectSourceFromPipeline(node){events.push('disconnect-source');connected.delete(node);}};
  const player={audioContext:context,audioManager,stateManager:{getStateSnapshot:()=>state,updateState(update){Object.assign(state,update);}},
    ui:{container:{},createPlayerUI(){}},async resumeAudioContextForRemotePlayback(){return true;},
    activateOpenHomePlaybackAdapter(){return{async clearForLiveInput(){events.push('clear-url-queue');}};}};
  const manager=new AudioContextManager(player,audioManager);
  manager.getUseInputWithPlayer=()=>false;
  manager.createSilentGain=()=>{events.push('connect-silence');const node=gain();connected.add(node);return node;};
  player.contextManager=manager;
  const outgoing=[];
  const bridge={async stopSession(){events.push('stop-main');}};
  let node;
  const live=new AirPlayPlayback(player,{windowRef:null,bridge,createNode(){
    const core=new LivePcmCore(48000);
    node={connect(){},disconnect(){events.push('disconnect-worklet');},port:{close(){},postMessage(message){
      if(message.type==='start')core.reset();
      if(message.type==='pcm'){
        const accepted=core.push(message);
        queueMicrotask(()=>{
          node.port.onmessage({data:{type:'credit',generation:message.generation,accepted}});
          if(core.buffered)node.port.onmessage({data:{type:'buffered',generation:message.generation}});
        });
      }
    }}};return node;
  }});
  player.airPlayPlayback=live;
  live.port={postMessage:message=>outgoing.push(message),close(){}};
  return{live,player,manager,events,state,outgoing};
}
function pcm(generation,startFrame) {
  const left=new Float32Array(1000).fill(0.5),right=new Float32Array(1000).fill(-0.25);
  return{type:'pcm',generation,startFrame,frameCount:1000,planes:[left.buffer,right.buffer]};
}

test('AirPlay presents received information and independent artwork without reviving stale sessions', async t => {
  const f = fixture();
  t.after(() => { f.player.audioContext.state = 'suspended'; f.live.dispose(); });
  const revoked = [];
  const revoke = URL.revokeObjectURL;
  t.mock.method(URL, 'revokeObjectURL', url => { revoked.push(url); revoke(url); });
  await f.live.handleMessage({ type: 'start', generation: 8, sampleRate: 44100, channelCount: 2 });
  const information = { position: 292, duration: 319, metadata: { title: 'Song', artist: 'Artist', album: 'Album' },
    sender: { name: 'iPad' }, format: { codec: 'ALAC', sampleRate: 44100, channels: 2, bitsPerSample: 16 } };
  await f.live.handleMessage({ type: 'information', generation: 8, information });
  await f.live.handleMessage({ type: 'artwork', generation: 8,
    artwork: { mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]).buffer } });
  assert.equal(f.state.liveInputInformation, undefined, 'preroll information must not replace active URL presentation');
  for (let index = 0; index < 6; index++) await f.live.handleMessage(pcm(8, index * 1000));
  await turn();
  assert.equal(f.state.currentTrackName, 'Song');
  assert.equal(f.state.currentTrackPosition, 292);
  assert.equal(f.state.currentTrackDuration, 319);
  assert.equal(f.manager.getCurrentPlaybackTime(), 292);
  assert.equal(f.state.seekBarEnabled, false);
  assert.deepEqual(f.state.transportCapabilities, { stop: true });
  const artworkUrl = f.state.artworkUrl;
  assert.match(artworkUrl, /^blob:/);
  await f.live.handleMessage({ type: 'information', generation: 8,
    information: { ...information, metadata: { title: 'Next song' }, position: 0 } });
  assert.equal(f.state.artworkUrl, artworkUrl, 'unchanged same-album art remains useful across independently received tags');
  assert.equal(f.state.currentTrackName, 'Next song');
  assert.equal(f.state.liveInputInformation.metadata.artist, undefined, 'metadata snapshots replace removed fields');
  await f.live.handleMessage({ type: 'information', generation: 7, information });
  await f.live.handleMessage({ type: 'artwork', generation: 7, artwork: null });
  assert.equal(f.state.currentTrackPosition, 0);
  assert.equal(f.state.artworkUrl, artworkUrl);
  await f.live.handleMessage({ type: 'end', generation: 8 });
  assert.equal(f.state.liveInputInformation, null);
  assert.equal(f.state.artworkUrl, '');
  assert.equal(f.state.currentTrackDuration, 0);
  assert.deepEqual(revoked, [artworkUrl]);
  await f.live.handleMessage({ type: 'information', generation: 8, information });
  assert.equal(f.state.liveInputInformation, null);
});

test('AirPlay commits after preroll through common pipeline ownership and applies sender volume once',async()=>{
  const f=fixture();
  f.manager.setPlayerVolume(10);f.manager.setPlayerMute(true);
  await f.live.handleMessage({type:'start',generation:3,sampleRate:44100,channelCount:2});
  assert.equal(f.live.active,false);
  for(let index=0;index<6;index+=1)await f.live.handleMessage(pcm(3,index*1000));
  await turn();
  assert.equal(f.live.active,true);
  assert.equal(f.live.source.gain.value,1);
  assert.ok(f.events.some(event=>Array.isArray(event)&&event[0]==='ramp-gain'&&event[1]===1&&event[2]===10.005));
  assert.equal(f.manager.playerVolumeNodes.size,0);
  assert.equal(f.state.liveInputActive,true);
  assert.ok(f.outgoing.some(message=>message.type==='ready'&&message.generation===3));
  assert.equal(f.outgoing.filter(message=>message.type==='credit').length,6);
  f.events.length=0;
  await f.live.handleMessage({type:'end',generation:3});
  assert.ok(f.events.some(event=>Array.isArray(event)&&event[0]==='ramp-gain'&&event[1]===0&&event[2]===10.005));
  assert.equal(f.events.includes('disconnect-source'),false);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(f.events.includes('disconnect-source'),false, 'wall time alone must not end the audio fade');
  f.player.audioContext.currentTime = 10.006;
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(f.events.indexOf('connect-silence')<f.events.indexOf('disconnect-source'));
  assert.equal(f.state.liveInputActive,false);
  assert.equal(f.state.isStopped,true);
  f.live.dispose();
});

test('AirPlay ignores stale slabs and closes live ownership when an explicit URL candidate commits',async()=>{
  const f=fixture();
  await f.live.handleMessage({type:'start',generation:4,sampleRate:44100,channelCount:2});
  await f.live.handleMessage(pcm(3,0));
  assert.equal(f.outgoing.length,0);
  for(let index=0;index<6;index+=1)await f.live.handleMessage(pcm(4,index*1000));
  await turn();
  f.live.releaseForUrl();
  f.player.audioContext.state='suspended';
  assert.equal(f.live.active,false);
  assert.ok(f.events.includes('stop-main'));
  await f.live.handleMessage(pcm(4,6000));
  assert.equal(f.live.node,null);
  f.live.dispose();
});

test('a retiring AirPlay source cannot disconnect its replacement', async () => {
  const f = fixture();
  await f.live.handleMessage({type:'start',generation:1,sampleRate:44100,channelCount:2});
  for (let index=0;index<6;index+=1) await f.live.handleMessage(pcm(1,index*1000));
  await turn();
  const retired = f.live.source;
  await f.live.handleMessage({type:'end',generation:1});
  await f.live.handleMessage({type:'start',generation:2,sampleRate:44100,channelCount:2});
  for (let index=0;index<6;index+=1) await f.live.handleMessage(pcm(2,index*1000));
  await turn();
  const source = f.live.source;
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(f.player.audioManager.isSourceConnectedToPipeline(retired),true);
  f.player.audioContext.currentTime = 10.006;
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.player.audioManager.isSourceConnectedToPipeline(retired),false);
  assert.equal(f.live.active,true);
  assert.equal(f.live.source,source);
  assert.equal(f.player.audioManager.sourceNode,source);
  assert.equal(f.player.audioManager.isSourceConnectedToPipeline(source),true);
  f.player.audioContext.state='suspended';
  f.live.dispose();
});

test('AirPlay releases a stalled fade when the audio context stops running', async () => {
  const f = fixture();
  await f.live.handleMessage({type:'start',generation:5,sampleRate:44100,channelCount:2});
  for (let index=0;index<6;index+=1) await f.live.handleMessage(pcm(5,index*1000));
  await turn();
  const source = f.live.source;
  await f.live.handleMessage({type:'end',generation:5});
  f.player.audioContext.state='suspended';
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.player.audioManager.isSourceConnectedToPipeline(source),false);
  f.live.dispose();
});
