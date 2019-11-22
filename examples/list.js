/* eslint-disable no-unused-vars */

'use strict';

const readdirp = require('..');

const read = async (directory) => {
  const stream = readdirp(directory, {type: 'all'});
  let i = 0;
  const start = Date.now();

  stream.on('data', chunk => {
    i++;
  });

  stream.on('end', chunk => {
    console.log('finished', i, 'files in', Date.now() - start, 'ms');
  });
};

read('../..');
