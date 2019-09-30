import readdirp from 'readdirp';

const read = async (directory: string) => {
  const stream = readdirp(directory, { type: 'all' });
  let i = 0;
  for await (const chunk of stream) {
    // Check memory usage with this line. It should be 10MB or so.
    // Comment it out if you simply want to list files.
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`${++i}: ${chunk.path}`);
  }
  console.log('Stream done', i);

  const entries = await readdirp.promise(directory);
  console.log('Promise done', entries.map(e => e.path));
};

read(__dirname);
