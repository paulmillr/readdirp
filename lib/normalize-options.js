'use strict';
const fs = require('fs').promise;
const normalizeFilter = require('./normalize-filter');

const normalizeOptions = (opts, ...callbacks) => {
  if (opts === undefined) {
    throw new Error(
      'Need to pass at least one argument: opts! \n' +
      'https://github.com/paulmillr/readdirp#options'
    );
  }

  return {
    root: opts.root || '.',
    fileFilter: normalizeFilter(opts.fileFilter),
    directoryFilter: normalizeFilter(opts.directoryFilter),
    depth: opts.depth === undefined ? Infinity : opts.depth,
    entryType: opts.entryType || 'files',
    getStat: opts.lstat === true ? fs.lstat : fs.stat,
  };
};

module.exports = normalizeOptions;
