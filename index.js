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

const readdirp = require("./lib/stream-api");

const DOC_URL = 'https://github.com/paulmillr/readdirp';

const readdirCallback = (stream, fileProcessed, allProcessed) => {
  const errors = [];
  const result = {directories: [], files: []};

  const notifyAllProcessed = allProcessed || fileProcessed;
  const notifyFileProcessed =
    fileProcessed !== notifyAllProcessed && fileProcessed;

  stream.on("data", entryInformation => {
    if (stream.isFile(entryInformation)) {
      result.files.push(entryInformation);
    }
    if (typeof notifyFileProcessed === "function") {
      notifyFileProcessed(entryInformation);
    }
  });

  stream.on("__directory", entryInformation => {
    result.directories.push(entryInformation);
  });

  stream.on("warn", error => {
    errors.push(error);
  });

  stream.on("error", error => {
    errors.push(error);
    if (typeof notifyAllProcessed === "function") {
      notifyAllProcessed(errors, null);
    }
  });

  stream.on("end", () => {
    if (typeof notifyAllProcessed === "function") {
      const realErrors = errors.length > 0 ? errors : null;
      notifyAllProcessed(realErrors, result);
    }
  });

  return stream;
};

/**
 * Main function which ends up calling readdirRec and reads all files and directories in given root recursively.
 * @param {String} root Root directory
 * @param {ReaddirpArguments=} options Options to specify root (start directory), filters and recursion depth
 * @param {Function=} fileProcessed When callback2 is given calls back for each processed file - function (fileInfo) { ... },
 *                                  when callback2 is not given, it behaves like explained in callback2
 * @param {Function=} allProcessed  Calls back once all files have been processed with an array of errors and file infos
 *                                  function (err, fileInfos) { ... }
 */
const readdir = (root, options, fileProcessed, allProcessed) => {
  // 1. root: String[, options: Object] => Stream
  // 2. root: Object => Error
  // 3. root: null => Error
  if (typeof options === 'function') {
    allProcessed = fileProcessed
    fileProcessed = options;
    options = null;
  }
  if (options == null) options = {};
  options.root = root;

  let error;

  if (root == null || typeof root === 'undefined') {
    error = new Error('readdirp: root argument is required. Usage: readdirp(root, options)');
  } else if (typeof root !== 'string') {
    error = new Error(`readdirp: root argument must be a string. Usage: readdirp(root, options). ${DOC_URL}`);
  }

  const {stream} = readdirp.createStreamAPI(options);
  if (fileProcessed == null && allProcessed == null) {
    if (error) stream._handleFatalError(error);
    return stream;
  } else {
    if (error) throw error;
    return readdirCallback(stream, fileProcessed, allProcessed);
  }
}

module.exports = readdir;
