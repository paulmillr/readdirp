'use strict';
const fs = require('fs').promises;
const path = require('path');

async function* readdirp(opts) {
  let depth = 0;
  const realRoot = await fs.realpath(opts.root);

  async function* readdir(targetDir) {
    try {
      const fullParentDir = await fs.realpath(targetDir);
      const names = await fs.readdir(fullParentDir);
      const parentDir = path.relative(realRoot, fullParentDir);

      const results = await Promise.all(names.map(async name => {
        const fullPath = path.join(fullParentDir, name);

        try {
          return {
            name,
            path: path.join(parentDir, name), // relative to root
            fullPath,
            parentDir, // relative to root
            fullParentDir,
            stat: await opts.getStat(fullPath),
          };
        } catch (err) {
          return err;
        }
      }));

      yield* results.filter(r => r instanceof Error);
      const entries = results.filter(r => !(r instanceof Error));
      const dirs = entries.filter(e => e.stat.isDirectory() && opts.directoryFilter(e));

      yield* dirs;
      yield* entries.filter(e => {
        const isCorrectType = opts.entryType === 'all'
          ? !e.stat.isDirectory()
          :  e.stat.isFile() || e.stat.isSymbolicLink();

        return isCorrectType && opts.fileFilter(e);
      });

      if (++depth >= opts.depth) return;

      for (const dir of dirs) {
        yield* readdir(dir.fullPath);
      }
    } catch (err) {
      yield err;
    }
  }

  yield* readdir(realRoot);
}

module.exports = readdirp;
