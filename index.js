'use strict';

const fs = require('fs');
const {Readable} = require('stream');
const sysPath = require('path');
const picomatch = require('picomatch');
const {promisify} = require('util');
const [readdir, stat, lstat] = [promisify(fs.readdir), promisify(fs.stat), promisify(fs.lstat)];
const supportsDirent = 'Dirent' in fs;

/**
 * @typedef {Object} EntryInfo
 * @property {String} path
 * @property {String} fullPath
 * @property {fs.Stats=} stats
 * @property {fs.Dirent=} dirent
 * @property {String} basename
 */

const isWindows = process.platform === 'win32';
const BANG = '!';
const NORMAL_FLOW_ERRORS = Object.freeze(new Set(['ENOENT', 'EPERM', 'EACCES']));
const FILE_TYPE = 'files';
const DIR_TYPE = 'directories';
const FILE_DIR_TYPE = 'files_directories';
const EVERYTHING_TYPE = 'all';
const FILE_TYPES = Object.freeze(new Set([FILE_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE]));
const DIR_TYPES = Object.freeze(new Set([DIR_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE]));
const ALL_TYPES = [FILE_TYPE, DIR_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE];

const isNormalFlowError = (errorCode) => NORMAL_FLOW_ERRORS.has(errorCode);

const normalizeFilter = (filter) => {
  if (filter === undefined) return;
  if (typeof filter === 'function') return filter;

  if (typeof filter === 'string') {
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

class ReaddirpStream extends Readable {
  static get defaultOptions() {
    return {
      root: '.',
      fileFilter: (path) => true,
      directoryFilter: (path) => true,
      type: 'files',
      lstat: false,
      depth: 2147483648,
      alwaysStat: false
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
    this._isDirent = !opts.alwaysStat && supportsDirent;
    this._statsProp = this._isDirent ? 'dirent' : 'stats';
    this._readdir_options = {encoding: 'utf8', withFileTypes: this._isDirent};

    // Launch stream with one parent, the root dir.
    /** @type Array<[string, number]>  */
    this.parents = [[root, 0]];
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

    const [parentPath, depth] = parent;

    /** @type Array<fs.Dirent|string> */
    let files = [];

    // To prevent race conditions, we increase counter while awaiting readdir.
    this.filesToRead++;
    try {
      files = await readdir(parentPath, this._readdir_options);
    } catch (error) {
      if (isNormalFlowError(error.code)) {
        this._handleError(error);
      } else {
        throw error;
      }
    }
    this.filesToRead--;

    // If the stream was destroyed, after readdir is completed
    if (!this.readable) return;

    this.filesToRead += files.length;

    for (const dirent of files) {
      if (!this.readable) return;

      const relativePath = this._isDirent ? dirent.name : dirent;
      const fullPath = sysPath.resolve(sysPath.join(parentPath, relativePath));

      let stats;
      if (this._isDirent) {
        stats = dirent;
      } else {
        try {
          stats = await this._stat(fullPath);
        } catch (error) {
          if (isNormalFlowError(error.code)) {
            this._handleError(error);
            this.filesToRead--;
            continue;
          } else {
            throw error;
          }
        }
      }
      if (!this.readable) return;
      const path = sysPath.relative(this._root, fullPath);
      const basename = sysPath.basename(path);

      /** @type {EntryInfo} */
      const entry = {path, fullPath, basename};
      entry[this._statsProp] = stats;

      if (this._isDirAndMatchesFilter(entry)) {
        this._pushNewParentIfLessThanMaxDepth(fullPath, depth + 1);
        this._emitPushIfUserWantsDir(entry);
        if (!this.isPaused()) this._read();
      } else if (this._isFileAndMatchesFilter(entry)) {
        this._emitPushIfUserWantsFile(entry);
      }
      this.filesToRead--;
    }

    this._endStreamIfQueueIsEmpty();
  }

  _isStreamShouldBeEnded() {
    return this.parents.length === 0 && this.filesToRead === 0 && this.readable;
  }

  _endStreamIfQueueIsEmpty() {
    if (this._isStreamShouldBeEnded()) {
      this.push(null);
    }
  }

  _pushNewParentIfLessThanMaxDepth(parentPath, depth) {
    if (depth <= this._maxDepth) {
      this.parents.push([parentPath, depth]);
      return true
    } else {
      return false;
    }
  }

  _isDirAndMatchesFilter(entry) {
    return entry[this._statsProp].isDirectory() && this._directoryFilter(entry);
  }

  _isFileAndMatchesFilter(entry) {
    const stats = entry[this._statsProp];
    const isFileType = (
      (this._entryType === EVERYTHING_TYPE && !stats.isDirectory()) ||
      (stats.isFile() || stats.isSymbolicLink())
    );
    return isFileType && this._fileFilter(entry);
  }

  _emitPushIfUserWantsDir(entry) {
    if (DIR_TYPES.has(this._entryType)) {
      // TODO: Understand why this happens.
      const fn = () => {this._push(entry)};
      if (this._isDirent) setImmediate(fn);
      else fn();
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
    if (this._isStreamShouldBeEnded()) {
      return;
    }
    this.emit('warn', error);
  }

  _handleFatalError(error) {
    if (this._isStreamShouldBeEnded()) {
      return;
    }
    this.emit('error', error);
    this.destroy();
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
  let type = options['entryType'] || options.type;
  if (type === 'both') type = FILE_DIR_TYPE; // backwards-compatibility
  if (type) options.type = type;
  if (root == null || typeof root === 'undefined') {
    throw new Error('readdirp: root argument is required. Usage: readdirp(root, options)');
  } else if (typeof root !== 'string') {
    throw new Error(`readdirp: root argument must be a string. Usage: readdirp(root, options)`);
  } else if (type && !ALL_TYPES.includes(type)) {
    throw new Error(`readdirp: Invalid type passed. Use one of ${ALL_TYPES.join(', ')}`);
  }

  options.root = root;
  return new ReaddirpStream(options);
};

const readdirpPromise = (root, options = {}) => {
  return new Promise((resolve, reject) => {
    const files = [];
    readdirp(root, options)
      .on('data', (entry) => files.push(entry))
      .on('end', () => resolve(files))
      .on('error', (error) => reject(error));
  });
};

readdirp.promise = readdirpPromise;
readdirp.ReaddirpStream = ReaddirpStream;
readdirp.default = readdirp;

module.exports = readdirp;
