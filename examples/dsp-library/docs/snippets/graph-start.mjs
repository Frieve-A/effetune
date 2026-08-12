import { Graph, createGraph, createVolume } from '@effetune/dsp';

const input = [
  new Float32Array(128).fill(0.25),
  new Float32Array(128).fill(0.25)
];
const graphDocument = Graph.wetDry(
  createVolume({ id: 'wet', volume: -6 }),
  { dry: 0.5, wet: 0.5 }
);
const graph = await createGraph(graphDocument);
let stream;

try {
  const offline = await graph.process(input, { sampleRate: 48000 });
  stream = await graph.stream({
    sampleRate: 48000,
    channels: 2,
    blockSize: 128
  });
  const continuous = await stream.process(input);
  console.log(
    offline[0][0],
    continuous[0][0],
    stream.latencySamples,
    stream.compileSnapshot.effectiveSchedule
  );
} finally {
  stream?.close();
  graph.close();
}
