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
    const {root} = opts;
    if (root == null || typeof root === 'undefined') {
      this._handleFatalError(new Error('readdirp: root argument is required. Usage: readdirp(root, options)'));
    } else if (typeof root !== 'string') {
      this._handleFatalError(new Error(`readdirp: root argument must be a string. Usage: readdirp(root, options)`));
    }

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
    // console.log('_read', parentPath);

    this.filesToRead++;
    const files = await fs.readdir(parentPath, {encoding: 'utf8'});
    this.filesToRead--;

    this.filesToRead += files.length;
    // console.log('filesToRead +=', files.length);

    for (const relativePath of files) {
      // console.log('readdir', parentPath, relativePath);

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

    this._endStreamIfQueueIsEmpty(parentPath);
  }

  _endStreamIfQueueIsEmpty(pp) {
    if (this.parents.length === 0 && this.filesToRead === 0 && this.readable) {
      // console.log('__END', pp);

      this.push(null);
    }
  }

  _pushNewParentIfLessThanMaxDepth(parentPath, depth) {
    if (depth <= this._maxDepth) {
      this.parents.push({parentPath, depth});
      // console.log('depth isnt reached', depth, parentPath, this.parents.length);
      return true
    } else {
      // console.log('depth is reached', depth, parentPath);

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
    if (isFileType && this._options.fileFilter(entry)) {
      // console.log('_isFileAndMatchesFilter', entry.basename);
    }

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