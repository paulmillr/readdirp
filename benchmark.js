import readdirp from './esm/index.js';

function logMem(i) {
  const vals = Object.entries(process.memoryUsage()).map(([k, v]) => {
    return `${k}=${(`${(v / 1e6).toFixed(1)}M`).padEnd(7)}`;
  });
  console.log(String(i).padStart(6), ...vals);
}

const read = async (directory) => {
  const stream = readdirp(directory, {type: 'all'});
  let i = 0;
  const start = Date.now();
  let lap = 0;
  let now = Date.now();

  for await (const chunk of stream) {
    if (i % 10000 === 0) {
      now = Date.now();
      if (now - lap > 500) {
        lap = now;
        logMem(i);
      }
    }
    i++;
  }
  logMem(i);

  console.log(`Processed ${i} files in ${Date.now() - start} msecs`);
};

read('../..');
