const readdirp = require('..');

const start = async (stream) => {
  let i = 0;
  for await (const chunk of stream) {
    // Check memory usage with this line. It should be 10MB or so.
    // Comment it out if you simply want to list files.
    await new Promise(resolve => setTimeout(resolve, 500));
    // i++;
    console.log(`${++i}: ${chunk.path}`);
  }
  console.log('DONE', i);
};

start(readdirp('../..', {entryType: 'all'}));
