const readdirp = require('.');

(async () => {
  let i = 0;
  const stream = readdirp('../..', {entryType: 'all'});
  for await (const entry of stream) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const {path, stat: {size}} = entry;
    console.log(i++);
    // console.log(`${JSON.stringify({path, size})}`);
  }
})();