import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { startIsolatedStaticServer, stopIsolatedStaticServer, POWER_SMOKE_FIXTURE_PATH } from '../../tools/run-power-browser-smoke.mjs';

test('live PCM worklet renders stereo through downstream processing at a different context rate', async () => {
  const server = await startIsolatedStaticServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(server.baseURL + POWER_SMOKE_FIXTURE_PATH);
    const result = await page.evaluate(async () => {
      const context = new OfflineAudioContext(2,96000,48000);
      await context.audioWorklet.addModule('/js/ui/audio-player/live-pcm-worklet.js');
      const node = new AudioWorkletNode(context,'effetune-live-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
      const messages=[]; let processorError='';
      node.port.onmessage=event=>messages.push(event.data);
      node.onprocessorerror=()=>{processorError='processorerror';};
      const effect = context.createGain();effect.gain.value=0.4;
      node.connect(effect);effect.connect(context.destination);
      node.port.postMessage({type:'start',generation:1});
      for(let start=0;start<44100;start+=4096) {
        const frameCount=Math.min(4096,44100-start);
        const left=new Float32Array(frameCount),right=new Float32Array(frameCount);
        for(let i=0;i<frameCount;i+=1){left[i]=0.5*Math.sin(2*Math.PI*1000*(start+i)/44100);right[i]=-left[i];}
        node.port.postMessage({type:'pcm',generation:1,startFrame:start,frameCount,planes:[left.buffer,right.buffer]},[left.buffer,right.buffer]);
      }
      const suspended=context.suspend(0.1);
      const rendering=context.startRendering();
      await suspended;
      await new Promise((resolve,reject)=>{
        const guard=setTimeout(()=>{clearInterval(poll);reject(new Error('Worklet PCM credits timed out'));},3000);
        const poll=setInterval(()=>{if(messages.some(message=>message.type==='buffered')){clearTimeout(guard);clearInterval(poll);resolve();}},5);
      });
      await context.resume();
      const rendered=await rendering;
      const left=rendered.getChannelData(0),right=rendered.getChannelData(1);
      let energy=0,stereoError=0,nonFinite=0;
      for(let i=10000;i<40000;i+=1){energy+=left[i]*left[i];stereoError=Math.max(stereoError,Math.abs(left[i]+right[i]));if(!Number.isFinite(left[i]))nonFinite+=1;}
      node.port.close();
      return{rms:Math.sqrt(energy/30000),stereoError,nonFinite,messages,processorError};
    });
    assert.ok(Math.abs(result.rms-0.2*Math.SQRT1_2)<0.003, JSON.stringify(result));
    assert.equal(result.stereoError,0);
    assert.equal(result.nonFinite,0);
  } finally {
    await browser?.close();
    await stopIsolatedStaticServer(server.child);
  }
});
