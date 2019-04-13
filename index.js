'use strict';

const fs = require('fs');
const {Readable} = require('stream');
const sysPath = require('path');
const {promisify} = require('util');
const picomatch = require('picomatch');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const lstat = promisify(fs.lstat);

/**
 * @typedef {Object} EntryInfo
 * @property {String} path
 * @property {String} fullPath
 * @property {fs.Stats} stats
 * @property {String} basename
 */


const BANG = '!';
const normalizeFilter = (filter) => {
  if (filter === undefined) return;
  if (typeof filter === "function") return filter;

  if (typeof filter === "string") {
    const glob = picomatch(filter.trim());
    return (entry) => glob(entry.basename);
  }

  if (Array.isArray(filter)) {
    const positive = [];
    const negative = [];
    for (const item of filter) {
      const trimmed = item.trim();
      if (trimmed.charAt(0) === BANG) {
        negative.push(picomatch(trimmed.slice(1)));
      } else {
        positive.push(picomatch(trimmed));
      }
    }

    if (negative.length > 0) {
      if (positive.length > 0) {
        return (entry) => positive.some(f => f(entry.basename)) &&
          !negative.every(f => f(entry.basename));
      } else {
        return (entry) => !negative.every(f => f(entry.basename));
      }
    } else {
      return (entry) => positive.some(f => f(entry.basename));
    }
  }
};

const ENOENT = 'ENOENT';
const FILE_TYPE = 'files';
const DIR_TYPE = 'directories';
const FILE_DIR_TYPE = 'files_directories';
const ALL_TYPE = 'all';
const TYPES = [FILE_TYPE, DIR_TYPE, FILE_DIR_TYPE, ALL_TYPE];
const FILE_TYPES = Object.freeze(new Set([FILE_TYPE, FILE_DIR_TYPE, ALL_TYPE]));
const DIR_TYPES = Object.freeze(new Set([DIR_TYPE, FILE_DIR_TYPE, ALL_TYPE]));
const READ_OPTIONS = Object.freeze({encoding: 'utf8'});

class ReaddirpStream extends Readable {
  static get defaultOptions() {
    return {
      root: '.',
      fileFilter: (path) => true,
      directoryFilter: (path) => true,
      type: 'files',
      lstat: false,
      depth: 2147483648
    }
  }

  constructor(options = {}) {
    super({objectMode: true, highWaterMark: 1});
    const opts = {...ReaddirpStream.defaultOptions, ...options};
    const {root} = opts;

    this._fileFilter = normalizeFilter(opts.fileFilter);
    this._directoryFilter = normalizeFilter(opts.directoryFilter);
    this._stat = opts.lstat ? lstat : stat;
    this._maxDepth = opts.depth;
    this._entryType = opts.type
    this._root = root;

    // Launch stream with one parent, the root dir.
    this.parents = [{parentPath: root, depth: 0}];
    this.filesToRead = 0;
  }

  async _read() {
    // If the stream was destroyed, we must not proceed.
    if (!this.readable) return;

    const parent = this.parents.pop();

    // All directories have been read...
    if (!parent) {
      // ...stop stream when there are no files to process.
      this._endStreamIfQueueIsEmpty();

      // ...we have files to process; but not directories.
      // hence, parent is undefined; and we cannot execute fs.readdir().
      // The files are being processed anywhere.
      return;
    }

    const {parentPath, depth} = parent;

    // To prevent race conditions, we increase counter while awaiting readdir.
    this.filesToRead++;
    let files;
    if (!parentPath) console.log("INVALID ARG", parentPath);

    try {
      files = await readdir(parentPath, READ_OPTIONS);
    } catch (error) {
      if (error.code === ENOENT) files = [];
      else throw error;
    }
    this.filesToRead--;

    // If the stream was destroyed, after readdir is completed
    if (!this.readable) return;

    this.filesToRead += files.length;

    for (const relativePath of files) {
      if (!this.readable) return;
      const fullPath = sysPath.resolve(sysPath.join(parentPath, relativePath));
      let stats;
      try {
        if (!fullPath) console.log('_stat', fullPath);
        stats = await this._stat(fullPath);
      } catch (error) {
        console.log(466201, error.code);

        if (error.code === ENOENT) {
          this.filesToRead--;
          continue;
        } else {
          throw error;
        }
      }
      if (!this.readable) return;
      const path = sysPath.relative(this._root, fullPath);
      const basename = sysPath.basename(path);

      /**
       * @type {EntryInfo}
       */
      const entry = {path, stats, fullPath, basename};

      if (this._isDirAndMatchesFilter(entry)) {
        this._pushNewParentIfLessThanMaxDepth(fullPath, depth + 1);
        this._emitPushIfUserWantsDir(entry);
        if (!this.isPaused()) this._read();
      } else if (this._isFileAndMatchesFilter(entry)) {
        this._emitPushIfUserWantsFile(entry);
      }
      this.filesToRead--;
    }

    this._endStreamIfQueueIsEmpty(parentPath);
  }

  _endStreamIfQueueIsEmpty(pp) {
    if (this.parents.length === 0 && this.filesToRead === 0 && this.readable) {
      this.push(null);
    }
  }

  _pushNewParentIfLessThanMaxDepth(parentPath, depth) {
    if (depth <= this._maxDepth) {
      this.parents.push({parentPath, depth});
      return true
    } else {
      return false;
    }
  }

  _isDirAndMatchesFilter(entry) {
    return entry.stats.isDirectory() && this._directoryFilter(entry);
  }

  _isFileAndMatchesFilter(entry) {
    const {stats} = entry;
    const isFileType = (
      (this._entryType === ALL_TYPE && !stats.isDirectory()) ||
      (stats.isFile() || stats.isSymbolicLink())
    );
    return isFileType && this._fileFilter(entry);
  }

  _emitPushIfUserWantsDir(entry) {
    if (DIR_TYPES.has(this._entryType)) {
      this._push(entry);
    }
  }

  _emitPushIfUserWantsFile(entry) {
    if (FILE_TYPES.has(this._entryType)) {
      this._push(entry);
    }
  }

  _push(entry) {
    if (this.readable) {
      this.push(entry);
    }
  }

  _handleError(error) {
    setImmediate(() => {
      this.emit('warn', error);
    });
  }

  _handleFatalError(error) {
    this.emit('error', error);
    this.destroy();

    setImmediate(() => {
      // this.emit('error', error);
      // this.destroy();
    });
  }

  destroy() {
    this.emit('close');
  }
}

/**
 * @typedef {Object} ReaddirpArguments
 * @property {Function=} fileFilter
 * @property {Function=} directoryFilter
 * @property {String=} type
 * @property {Number=} depth
 * @property {String=} root
 * @property {Boolean=} lstat
 */

/**
 * Main function which ends up calling readdirRec and reads all files and directories in given root recursively.
 * @param {String} root Root directory
 * @param {ReaddirpArguments=} options Options to specify root (start directory), filters and recursion depth
 */
const readdirp = (root, options = {}) => {
  let error;

  let type = options['entryType'] || options.type;
  if (type === 'both') type = FILE_DIR_TYPE;
  if (type) options.type = type;
  if (root == null || typeof root === 'undefined') {
    throw new Error('readdirp: root argument is required. Usage: readdirp(root, options)');
  } else if (typeof root !== 'string') {
    throw new Error(`readdirp: root argument must be a string. Usage: readdirp(root, options)`);
  } else if (type && !TYPES.includes(type)) {
    throw new Error(`readdirp: Invalid type passed. Use one of ${TYPES.join(', ')}`);
  }

  options.root = root;
  const stream = new ReaddirpStream(options);
  if (error) stream._handleFatalError(error);
  return stream;
};

const readdirpPromise = (root, options = {}) => {
  return new Promise((resolve, reject) => {
    const files = [];
    readdirp(root, options)
      .on('data', (entry) => { files.push(entry); })
      .on('end', () => { resolve(files); })
      .on('error', (error) => { reject(error); });
  });
};

readdirp.promise = readdirpPromise;
readdirp.ReaddirpStream = ReaddirpStream;
readdirp.default = readdirp;

module.exports = readdirp;
