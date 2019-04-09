"use strict";

/**
 * @typedef {Object} ReaddirpArguments
 * @property {Function=} fileFilter
 * @property {Function=} directoryFilter
 * @property {String=} entryType
 * @property {Number=} depth
 * @property {String=} root
 * @property {Boolean=} lstat
 */

const ReaddirpStream = require("./stream");

/**
 * Main function which ends up calling readdirRec and reads all files and directories in given root recursively.
 * @param {String} root Root directory
 * @param {ReaddirpArguments=} options Options to specify root (start directory), filters and recursion depth
 */
const readdir = (root, options = {}) => {
  let error;
  if (!error) options.root = root;
  const stream = new ReaddirpStream(options);
  if (error) stream._handleFatalError(error);
  return stream;
};

readdir.promise = (root, options = {}) => {
  return new Promise((resolve, reject) => {
    const files = [];
    readdir(root, options)
      .on('data', (entry) => { files.push(entry); })
      .on('end', () => { resolve(files); })
      .on('error', (error) => { reject(error); });
  });
};

readdir.ReaddirpStream = ReaddirpStream;

module.exports = readdir;
