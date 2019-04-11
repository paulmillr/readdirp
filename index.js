'use strict';

const fs = require('fs');
const {Readable} = require('stream');
const sysPath = require('path');
const {promisify} = require('util');
const picomatch = require('picomatch');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const lstat = promisify(fs.lstat);


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

    if (negative.length) {
      if (positive.length) {
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

const FILE_TYPE = 'files';
const DIR_TYPE = 'directories';
const FILE_DIR_TYPE = 'both';
const ALL_TYPE = 'all';
const FILE_TYPES = Object.freeze(new Set([FILE_TYPE, FILE_DIR_TYPE, ALL_TYPE]));
const DIR_TYPES = Object.freeze(new Set([DIR_TYPE, FILE_DIR_TYPE, ALL_TYPE]));
const READ_OPTIONS = {encoding: 'utf8'};


class ReaddirpStream extends Readable {
  static get defaultOptions() {
    return {
      root: '.',
      fileFilter: (path) => true,
      directoryFilter: (path) => true,
      entryType: 'files',
      lstat: false,
      depth: 2147483648
    }
  }

  constructor(options = {}) {
    super({objectMode: true, highWaterMark: 1});
    const opts = {...ReaddirpStream.defaultOptions, ...options};
    const {root} = opts;
    if (root == null || typeof root === 'undefined') {
      this._handleFatalError(new Error('readdirp: root argument is required. Usage: readdirp(root, options)'));
    } else if (typeof root !== 'string') {
      this._handleFatalError(new Error(`readdirp: root argument must be a string. Usage: readdirp(root, options)`));
    }

    this._fileFilter = normalizeFilter(opts.fileFilter);
    this._directoryFilter = normalizeFilter(opts.directoryFilter);
    this._stat = opts.lstat ? lstat : stat;
    this._maxDepth = opts.depth;
    this._entryType = opts.entryType;
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
    const files = await readdir(parentPath, READ_OPTIONS);
    this.filesToRead--;

    this.filesToRead += files.length;
    for (const relativePath of files) {
      const fullPath = sysPath.resolve(sysPath.join(parentPath, relativePath));
      const stat = await this._stat(fullPath);
      const path = sysPath.relative(this._root, fullPath);
      const basename = sysPath.basename(path);
      const entry = {path, stat, fullPath, basename, root: this._root};

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
    return entry.stat.isDirectory() && this._directoryFilter(entry);
  }

  _isFileAndMatchesFilter(entry) {
    const {stat} = entry;
    const isFileType = (
      (this._entryType === ALL_TYPE && !stat.isDirectory()) ||
      (stat.isFile() || stat.isSymbolicLink())
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
    if (this.readable) {
      this.emit('warn', error);
    }
  }

  _handleFatalError(error) {
    this.destroy();
    this.emit('error', error);
  }

  destroy() {
    this.emit('close');
  }
}

/**
 * @typedef {Object} ReaddirpArguments
 * @property {Function=} fileFilter
 * @property {Function=} directoryFilter
 * @property {String=} entryType
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
  if (!error) options.root = root;
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

module.exports = readdirp;
