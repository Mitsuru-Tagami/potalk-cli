import { createWriteStream } from 'node:fs';
import { openMic } from '../lib/mic.mjs';

const [source, remote, serial, output] = process.argv.slice(2);
if (!source || !remote || !serial || !output) {
  console.error('usage: node test/pipewire-mic-driver.mjs source remote serial output');
  process.exit(2);
}

const file = createWriteStream(output, { flags: 'w' });
let done = false;
let timer;
let mic;

function finish(code) {
  if (done) return;
  done = true;
  if (timer) clearInterval(timer);
  mic?.stop();
  file.end(() => process.exit(code));
}

try {
  mic = openMic({
    pulseSource: source,
    pipewire: { remote, serial },
    onError: message => {
      console.error(message);
      finish(1);
    }
  });
  mic.start();
  timer = setInterval(() => {
    const samples = mic.take(480);
    if (samples) file.write(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  }, 10);
} catch (error) {
  console.error(error?.message || error);
  finish(1);
}

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => finish(0));
