'use strict';
const normalizeOptions = require('./normalize-options');
const EntriesStream = require('./entries-stream');

const readdir = (rawOpts, ...callbacks) => {
  const opts = normalizeOptions(rawOpts);
  const stream = new EntriesStream(opts);

  if (callbacks.length) {
    stream.on('data', () => {

    });

    stream.on('end', () => {

    });

    stream.resume();
  }

  return stream;
};

module.exports = readdir;
