import { createInterface } from 'node:readline';

const mode = process.argv[2];
let receivedState = false;
const input = createInterface({ input: process.stdin });

input.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'configure') {
    process.stdout.write(`${JSON.stringify({ type: 'ready', protocolVersion: 1 })}\n`);
  } else if (message.type === 'state') {
    receivedState = true;
  } else if (message.type === 'shutdown') {
    const finish = () => process.exit(0);
    if (mode === 'diagnostic' && receivedState) {
      process.stdout.write(`${JSON.stringify({ type: 'diagnostic', code: 'invalid-state' })}\n`, finish);
    } else {
      finish();
    }
  }
});
