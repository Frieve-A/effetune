'use strict';

const path = require('node:path');
const { Worker, MessageChannel } = require('node:worker_threads');
const { createLoudnessTagJob: createSharedJob } = require('../js/library/loudness/tag-job.js');

function createWriter() {
  const worker = new Worker(path.join(__dirname, 'loudness-tag-worker.mjs'));
  return {
    write(filename, track, mayReplace) {
      return new Promise((resolve, reject) => {
        const { port1, port2 } = new MessageChannel();
        port1.once('message', async () => {
          let allowed = false;
          try { allowed = await mayReplace(); }
          catch (error) { console.warn('ReplayGain source access changed:', error?.code); }
          port1.postMessage(allowed);
        });
        function cleanup() {
          port1.close();
          worker.off('message', done);
          worker.off('error', fail);
          worker.off('exit', exited);
        }
        function done(result) { cleanup(); resolve(result); }
        function fail(error) { cleanup(); reject(error); }
        function exited(code) { fail(new Error(`ReplayGain writer exited: ${code}`)); }
        worker.once('message', done).once('error', fail).once('exit', exited);
        worker.postMessage({ path: filename, track, port: port2 }, [port2]);
      });
    },
    close: () => worker.terminate()
  };
}

// The job itself is shared with the Android library, which supplies its own writer.
function createLoudnessTagJob(options) {
  return createSharedJob({ ...options, makeWriter: options.makeWriter ?? createWriter });
}

module.exports = { createLoudnessTagJob };
