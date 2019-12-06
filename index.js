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

const BANG = '!';
const NORMAL_FLOW_ERRORS = new Set(['ENOENT', 'EPERM', 'EACCES', 'ELOOP']);
const FILE_TYPE = 'files';
const DIR_TYPE = 'directories';
const FILE_DIR_TYPE = 'files_directories';
const EVERYTHING_TYPE = 'all';
const ALL_TYPES = [FILE_TYPE, DIR_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE];

const isNormalFlowError = error => NORMAL_FLOW_ERRORS.has(error.code);

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

class ReaddirpStream extends Readable {
  static get defaultOptions() {
    return {
      root: '.',
      /* eslint-disable no-unused-vars */
      fileFilter: (path) => true,
      directoryFilter: (path) => true,
      /* eslint-enable no-unused-vars */
      type: FILE_TYPE,
      lstat: false,
      depth: 2147483648,
      alwaysStat: false
    };
  }

  constructor(options = {}) {
    super({
      objectMode: true,
      autoDestroy: true,
      highWaterMark: options.highWaterMark || 4096
    });
    const opts = { ...ReaddirpStream.defaultOptions, ...options };
    const { root, type } = opts;

    this._fileFilter = normalizeFilter(opts.fileFilter);
    this._directoryFilter = normalizeFilter(opts.directoryFilter);

    const statMethod = opts.lstat ? lstat : stat;
    // Use bigint stats if it's windows and stat() supports options (node 10+).
    if (process.platform === 'win32' && stat.length === 3) {
      this._stat = path => statMethod(path, { bigint: true });
    } else {
      this._stat = statMethod;
    }

    this._maxDepth = opts.depth;
    this._wantsDir = [DIR_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE].includes(type);
    this._wantsFile = [FILE_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE].includes(type);
    this._wantsEverything = type === EVERYTHING_TYPE;
    this._root = sysPath.resolve(root);
    this._isDirent = !opts.alwaysStat && 'Dirent' in fs;
    this._statsProp = this._isDirent ? 'dirent' : 'stats';
    this._readdir_options = { encoding: 'utf8', withFileTypes: this._isDirent };

    // Launch stream with one parent, the root dir.
    this.parents = [this._exploreDir(root, 1, this._readdir_options)];
    this.reading = false;
    this.parent = null;
  }

  async _read(n) {
    if (this.reading) return;

    this.reading = true;
    try {
      while (!this.destroyed && n > 0) {
        const { path, depth, files = [] } = this.parent || {};

        if (files.length === 0) {
          const parent = this.parents.pop();
          if (!parent) {
            this.push(null);
            break;
          }
  
          try {
            this.parent = await parent;
          } catch (err) {
            this._onError(err);
          }
        } else {
          for (const entry of await Promise.all(files
            .splice(0, n)
            .map(dirent => this._formatEntry(dirent, path))
          )) {
            if (this._isDirAndMatchesFilter(entry)) {
              if (depth <= this._maxDepth) {
                this.parents.push(this._exploreDir(entry.fullPath, depth + 1, this._readdir_options));
              }
              
              if (this._wantsDir) {
                this.push(entry);
                n--;
              }
            } else if (this._isFileAndMatchesFilter(entry)) {
              if (this._wantsFile) {
                this.push(entry);
                n--;
              }
            }
          }
        }
      }
    } catch (err) {
      this.destroy(err);
    } finally {
      this.reading = false;
    }
  }

  async _exploreDir(path, depth) {
    return {
      files: await readdir(path, this._readdir_options),
      depth,
      path
    };
  }

  async _formatEntry(dirent, path) {
    const basename = this._isDirent ? dirent.name : dirent;
    const fullPath = sysPath.resolve(sysPath.join(path, basename));

    try {
      return { 
        path: sysPath.relative(this._root, fullPath),
        fullPath,
        basename,
        [this._statsProp]: this._isDirent
          ? dirent
          : await this._stat(fullPath)
      };
    } catch (err) {
      this._onError(err);
    }
  }

  _onError(err) {
    if (isNormalFlowError(err) && !this.destroyed) {
      this.emit('warn', err);
    } else {
      throw err;
    }
  }

  _isDirAndMatchesFilter(entry) {
    return entry && entry[this._statsProp].isDirectory() && this._directoryFilter(entry);
  }

  _isFileAndMatchesFilter(entry) {
    const stats = entry && entry[this._statsProp];
    const isFileType = stats && (
      (this._wantsEverything && !stats.isDirectory()) ||
      (stats.isFile() || stats.isSymbolicLink())
    );
    return isFileType && this._fileFilter(entry);
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
