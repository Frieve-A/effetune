import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

test('a bank finishing library IO materializes only the current MIDI candidate generation before publication', async () => {
 const file=new URL('../../plugins/sfz-instrument.js',import.meta.url);
 const sandbox={PluginBase:class{},console,window:{appConfig:{sfzMaxSizeMiB:16}},ArrayBuffer,Uint8Array,Float32Array,Map,Set};
 vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nglobalThis.Instrument=SFZInstrumentPlugin;',sandbox,
  {filename:fileURLToPath(file),importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
 const plugin=new sandbox.Instrument('instrument','description');
 const candidateA={floor:30},candidateB={floor:15},player={midiGeneration:1,midiTimeline:{floor:90},midiPreparation:{timeline:candidateA}};
 sandbox.window.uiManager={audioPlayer:{contextManager:player}};
 let release,started,queries=0,costs=0;const blocked=new Promise(resolve=>{release=resolve;});
 const firstCost=new Promise(resolve=>{started=resolve;});const published=[];
 sandbox.window.audioManager={
  getSfzPreparationContext:async(_plugin,_node,timeline)=>{queries++;return{sampleRate:96000,processingChannels:4,maxFrames:128,minimumPhysicalBpm:timeline.floor};},
  estimateSfzEffectPreparation:async(_payload, context)=>{costs++;if(costs===1){started();await blocked;}return context.minimumPhysicalBpm === 15 ? 200 : 100;}};
 Object.assign(plugin,{sf:'a'.repeat(24),_getLibraryService:async()=>({prepare:async()=>({name:'bank',descriptor:{payload:new ArrayBuffer(16),footprintBytes:64}})}),
  _getSfzPreparationOptions:async()=>({}),_resetLoadNotice(){},clearWasmAsset(){},_setInstrumentPresentation(){},_renderStatus(){},
  validatePreparedSfzBank(){},_warningMessage:()=>'',setWasmAsset(_slot,descriptor){published.push(descriptor);},_showError(error){throw error;}});
 let guard;
 const pending=plugin._loadBank();
 try {
  await Promise.race([firstCost,pending.then(()=>assert.ok(costs>0,'The bank must enter context materialization')),
   new Promise((_,reject)=>{guard=setTimeout(()=>reject(new Error('Context materialization did not start')),1000);})]);
  player.midiGeneration=2;player.midiPreparation={timeline:candidateB};
 } finally { clearTimeout(guard);release();await pending; }
 assert.equal(queries,2);assert.equal(costs,2);assert.equal(published.length,1);
 assert.equal(published[0].preparationContext.minimumPhysicalBpm,15);
 assert.equal(published[0].processingChannels,4);
});
