const {Readable} = require('stream');
const sysPath = require('path');
const fs = require('fs').promises;
const normalizeFilter = require('./normalizer');

const FILE_TYPE = 'files';
const DIR_TYPE = 'directories';
const FILE_DIR_TYPE = 'both';
const ALL_TYPE = 'all';
const FILE_TYPES = Object.freeze(new Set([FILE_TYPE, FILE_DIR_TYPE, ALL_TYPE]));
const DIR_TYPES = Object.freeze(new Set([DIR_TYPE, FILE_DIR_TYPE, ALL_TYPE]));

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

  static createStreamAPI(options) {
    const stream = new ReaddirpStream(options);
    return {
      stream: stream,
      // processEntry: stream._processEntry.bind(stream),
      // done: stream._done.bind(stream),
      handleError: stream._handleError.bind(stream),
      // handleFatalError: stream._handleFatalError.bind(stream)
    };
  }

  constructor(options = {}) {
    super({objectMode: true, highWaterMark: 1});
    const opts = {...ReaddirpStream.defaultOptions, ...options};
    opts.fileFilter = normalizeFilter(opts.fileFilter);
    opts.directoryFilter = normalizeFilter(opts.directoryFilter);
    this._options = this.options = opts;
    this.parents = [{parentPath: opts.root, depth: 0}];
    this.filesToRead = 0;

    this._maxDepth = this._options.depth;
    this._entryType = this._options.entryType;
  }

  async _read() {
    // If the stream was destroyed, we must not proceed.
    if (!this.readable) return;

    const parent = this.parents.pop();

    // All directories have been read...
    if (!parent) {
      // ...end stream if no files to process.
      this._endStreamIfQueueIsEmpty();

      // ...we have files to process; but not directories.
      // hence, parent is undefined; and we cannot execute fs.readdir().
      return;
    }

    const {parentPath, depth} = parent;
    const files = await fs.readdir(parentPath, {encoding: 'utf8'});

    this.filesToRead += files.length;
    for (const relativePath of files) {
      const path = sysPath.join(parentPath, relativePath);
      const stat = await fs[this._options.lstat ? 'lstat': 'stat'](path);
      const fullPath = sysPath.resolve(path);
      const entry = {path, stat, fullPath, basename: sysPath.basename(path)};

      if (this._isDirAndMatchesFilter(entry)) {
        this._pushNewParentIfLessThanMaxDepth(entry.path, depth + 1);
        this._emitPushIfUserWantsDir(entry);
        this._read();
      } else if (this._isFileAndMatchesFilter(entry)) {
        this._emitPushIfUserWantsFile(entry);
      }
      this.filesToRead--;
    }

    this._endStreamIfQueueIsEmpty();
  }

  _endStreamIfQueueIsEmpty() {
    if (this.parents.length === 0 && this.filesToRead === 0) {
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
    return entry.stat.isDirectory() && this._options.directoryFilter(entry);
  }

  _isFileAndMatchesFilter(entry) {
    const {stat} = entry;
    const isFileType = (
      (this._entryType === ALL_TYPE && !stat.isDirectory()) ||
      (stat.isFile() || stat.isSymbolicLink())
    );
    return isFileType && this._options.fileFilter(entry);
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
    setImmediate(() => {
      if (this._paused) {
        return this._warnings.push(err);
      }
      if (!this._destroyed) {
        this.emit("warn", err);
      }
    });
  }

  destroy() {
    this.emit('close');
  }
}

module.exports = ReaddirpStream;