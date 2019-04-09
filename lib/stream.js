const {Readable} = require('stream');
const sysPath = require('path');
const {promisify} = require('util');
const fs = require('fs');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const lstat = promisify(fs.lstat);
const normalizeFilter = require('./normalizer');

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
      root: ".",
      fileFilter: (path) => true,
      directoryFilter: (path) => true,
      entryType: "files",
      lstat: false,
      depth: Number.MAX_SAFE_INTEGER
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

    // Launch stream with one parent, the root dir.
    this.parents = [{parentPath: opts.root, depth: 0}];
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
      const path = sysPath.join(parentPath, relativePath);
      const stat = await this._stat(path);
      const fullPath = sysPath.resolve(path);
      const entry = {path, stat, fullPath, basename: sysPath.basename(path)};

      if (this._isDirAndMatchesFilter(entry)) {
        this._pushNewParentIfLessThanMaxDepth(entry.path, depth + 1);
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

  _handleError(err) {
    if (this.isPaused()) {
      return this._warnings.push(err);
    }
    if (!this.readable) {
      this.emit("warn", err);
    }
  }

  _handleFatalError(error) {
    this.emit('error', error);
    this.destroy();
  }

  destroy() {
    this.emit('close');
  }
}

module.exports = ReaddirpStream;