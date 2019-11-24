'use strict';

const fs = require('fs');
const { Readable } = require('stream');
const sysPath = require('path');
const { promisify } = require('util');
const picomatch = require('picomatch');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const lstat = promisify(fs.lstat);

/**
 * @typedef {Object} EntryInfo
 * @property {String} path
 * @property {String} fullPath
 * @property {fs.Stats=} stats
 * @property {fs.Dirent=} dirent
 * @property {String} basename
 */

const supportsDirent = 'Dirent' in fs;
const isWindows = process.platform === 'win32';
const BANG = '!';
const NORMAL_FLOW_ERRORS = new Set(['ENOENT', 'EPERM', 'EACCES', 'ELOOP']);
const STAT_OPTIONS_SUPPORT_LENGTH = 3;
const FILE_TYPE = 'files';
const DIR_TYPE = 'directories';
const FILE_DIR_TYPE = 'files_directories';
const EVERYTHING_TYPE = 'all';
const FILE_TYPES = new Set([FILE_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE]);
const DIR_TYPES = new Set([DIR_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE]);
const ALL_TYPES = [FILE_TYPE, DIR_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE];

const isNormalFlowError = errorCode => NORMAL_FLOW_ERRORS.has(errorCode);

const normalizeFilter = filter => {
  if (filter === undefined) return;
  if (typeof filter === 'function') return filter;

  if (typeof filter === 'string') {
    const glob = picomatch(filter.trim());
    return entry => glob(entry.basename);
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
        return entry =>
          positive.some(f => f(entry.basename)) && !negative.some(f => f(entry.basename));
      }
      return entry => !negative.some(f => f(entry.basename));
    }
    return entry => positive.some(f => f(entry.basename));
  }
};

class ExploringDir {
  constructor(path, depth) {
    this.path = path;
    this.depth = depth;
  }
}

class ReaddirpStream extends Readable {
  static get defaultOptions() {
    return {
      root: '.',
      /* eslint-disable no-unused-vars */
      fileFilter: (path) => true,
      directoryFilter: (path) => true,
      /* eslint-enable no-unused-vars */
      type: 'files',
      lstat: false,
      depth: 2147483648,
      alwaysStat: false
    };
  }

  constructor(options = {}) {
    super({ objectMode: true, autoDestroy: true, highWaterMark: 1 });
    const opts = { ...ReaddirpStream.defaultOptions, ...options };
    const { root } = opts;

    this._fileFilter = normalizeFilter(opts.fileFilter);
    this._directoryFilter = normalizeFilter(opts.directoryFilter);
    this._statMethod = opts.lstat ? lstat : stat;
    this._statOpts = { bigint: isWindows };
    this._maxDepth = opts.depth;
    this._entryType = opts.type;
    this._root = sysPath.resolve(root);
    this._isDirent = !opts.alwaysStat && supportsDirent;
    this._statsProp = this._isDirent ? 'dirent' : 'stats';
    this._readdir_options = { encoding: 'utf8', withFileTypes: this._isDirent };

    // Launch stream with one parent, the root dir.
    /** @type ExploringDir[]  */
    this.parents = [new ExploringDir(root, 0)];
    this.reading = false;
  }

  async _read() {
    if (this.destroyed || this.reading) return;

    this.reading = true;
    try {
      let keepReading = true;
      while (keepReading) {
        const parent = this.parents.pop();
        if (!parent) {
          this.push(null);
          break;
        }

        /** @type {fs.Dirent[]|string[]} */
        let files = [];
        try {
          files = await readdir(parent.path, this._readdir_options);
        } catch (error) {
          if (isNormalFlowError(error.code)) {
            this._handleError(error);
          } else {
            this._handleFatalError(error);
          }
        }
        if (this.destroyed) return;

        /** @type {Promise<EntryInfo>[]} */
        const promises = files.map(dirent => this._formatEntry(dirent, parent));
        for (const promise of promises) {
          const entry = await promise;
          // If the stream was destroyed, after readdir is completed
          if (this.destroyed) return;
          if (!entry) {
            continue;
          }
          if (this._isDirAndMatchesFilter(entry)) {
            this._pushNewParentIfLessThanMaxDepth(entry.fullPath, parent.depth + 1);
            keepReading = this._pushIfUserWantsDir(entry) && keepReading;
          } else if (this._isFileAndMatchesFilter(entry)) {
            keepReading = this._pushIfUserWantsFile(entry) && keepReading;
          }
        }
      }
    } catch (err) {
      this.destroy(err);
    } finally {
      this.reading = false;
    }
  }

  _isStatOptionsSupported() {
    return this._statMethod.length === STAT_OPTIONS_SUPPORT_LENGTH;
  }

  _stat(fullPath) {
    if (isWindows && this._isStatOptionsSupported()) {
      return this._statMethod(fullPath, this._statOpts);
    }
    return this._statMethod(fullPath);
  }

  async _formatEntry(dirent, parent) {
    const basename = this._isDirent ? dirent.name : dirent;
    const fullPath = sysPath.resolve(sysPath.join(parent.path, basename));

    let stats;
    if (this._isDirent) {
      stats = dirent;
    } else {
      try {
        stats = await this._stat(fullPath);
      } catch (error) {
        if (isNormalFlowError(error.code)) {
          this._handleError(error);
        } else {
          this._handleFatalError(error);
        }
        return;
      }
    }
    const path = sysPath.relative(this._root, fullPath);

    /** @type {EntryInfo} */
    const entry = { path, fullPath, basename, [this._statsProp]: stats };

    return entry;
  }

  _pushNewParentIfLessThanMaxDepth(parentPath, depth) {
    if (depth <= this._maxDepth) {
      this.parents.push(new ExploringDir(parentPath, depth));
    }
  }

  _isDirAndMatchesFilter(entry) {
    return entry[this._statsProp].isDirectory() && this._directoryFilter(entry);
  }

  _isFileAndMatchesFilter(entry) {
    const stats = entry[this._statsProp];
    const isFileType =
      (this._entryType === EVERYTHING_TYPE && !stats.isDirectory()) ||
      (stats.isFile() || stats.isSymbolicLink());
    return isFileType && this._fileFilter(entry);
  }

  _pushIfUserWantsDir(entry) {
    if (DIR_TYPES.has(this._entryType)) {
      return this.push(entry);
    } else {
      return true;
    }
  }

  _pushIfUserWantsFile(entry) {
    if (FILE_TYPES.has(this._entryType)) {
      return this.push(entry);
    } else {
      return true;
    }
  }

  _handleError(error) {
    if (!this.destroyed) {
      this.emit('warn', error);
    }
  }

  _handleFatalError(error) {
    this.destroy(error);
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
 * @property {Boolean=} bigint
 */

/**
 * Main function which ends up calling readdirRec and reads all files and directories in given root recursively.
 * @param {String} root Root directory
 * @param {ReaddirpArguments=} options Options to specify root (start directory), filters and recursion depth
 */
const readdirp = (root, options = {}) => {
  let type = options.entryType || options.type;
  if (type === 'both') type = FILE_DIR_TYPE; // backwards-compatibility
  if (type) options.type = type;
  if (!root) {
    throw new Error('readdirp: root argument is required. Usage: readdirp(root, options)');
  } else if (typeof root !== 'string') {
    throw new TypeError('readdirp: root argument must be a string. Usage: readdirp(root, options)');
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
      .on('data', entry => files.push(entry))
      .on('end', () => resolve(files))
      .on('error', error => reject(error));
  });
};

readdirp.promise = readdirpPromise;
readdirp.ReaddirpStream = ReaddirpStream;
readdirp.default = readdirp;

module.exports = readdirp;
