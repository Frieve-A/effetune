import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../../js/audio-manager.js';
const instrument=(name, channel, width)=>({constructor:{name}, channel, getWasmAssets:()=>new Map([[0,{preparationContext:{sampleRate:96000,processingChannels:width,maxFrames:128}}]])});
test('only an actual SFZ processing width change requests a context rebind',()=>{
 const owner=Object.create(AudioManager.prototype);
 assert.equal(owner._sfzProcessingWidthChanges([instrument('SoundFontPlayerPlugin','A',2)],4),true);
 assert.equal(owner._sfzProcessingWidthChanges([instrument('SFZNotePlayerPlugin','L',2)],4),true);
 assert.equal(owner._sfzProcessingWidthChanges([instrument('SFZNotePlayerPlugin','34',2)],4),false);
 assert.equal(owner._sfzProcessingWidthChanges([instrument('SoundFontPlayerPlugin','R',1)],4),false);
 assert.equal(owner._sfzProcessingWidthChanges([instrument('OtherPlugin','A',2)],4),false);
});
test('width rebind captures state before config and replays the same graph before MIDI restore without input reacquisition',async()=>{
 const order=[],context={},node={port:{postMessage:message=>order.push(message.type)}};
 const plugin=instrument('SoundFontPlayerPlugin','A',2);
 const owner=Object.assign(Object.create(AudioManager.prototype),{audioContext:context,_audioGraphGeneration:4,
  _getActiveDspWorklets:()=>new Set([node]),_wasmAssetMembershipByNode:new Map([[node,new Map([[7,plugin]])]]),
  prepareSfzRuntimeGraphReset:async()=>order.push('capture'),
  _reinitializeDspWorklet:async target=>{assert.equal(target,node);assert.equal(owner.audioContext,context);order.push('reinit');return true;},
  getEnabledDspTypes:()=>['SoundFontPlayerPlugin'],
  waitForEffectiveActiveWasmAssets:async()=>{order.push('READY');return{ready:true};},
  waitForSfzRuntimeStarts:async()=>{order.push('runtime-restored');return true;},
  resumeSfzRuntimes:()=>order.push('resume'),finishSfzRuntimeGraphMigration:()=>order.push('finish'),
  contextManager:{audioContext:context},ioManager:{browserInput:{bindGraph(){throw Error('input must stay owned');}}}});
 globalThis.window={uiManager:{audioPlayer:{contextManager:{midiTimeline:{},async rebindCurrentPlayback(options){assert.equal(options.newAudioContext,context);assert.equal(options.stopCurrentFirst,false);order.push('MIDI-rebind');}}}}};
 try {assert.equal(await owner._rebindSfzDspGraph(()=>order.push('config')),true);}
 finally{delete globalThis.window;}
 assert.deepEqual(order,['capture','dspEnableTypes','config','reinit','READY','runtime-restored','MIDI-rebind','resume','finish']);
 assert.equal(owner.audioContext,context);
});
