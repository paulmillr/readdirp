const {readdir, opendir, stat} = require('fs').promises;
const sysPath = require('path');

const FILE_TYPE = 'files';
const DIR_TYPE = 'directories';
const FILE_DIR_TYPE = 'files_directories';
const EVERYTHING_TYPE = 'all';

const FILE_TYPES = new Set([FILE_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE]);
const DIR_TYPES = new Set([DIR_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE]);
const ALL_TYPES = [FILE_TYPE, DIR_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE];

const DEFAULT_OPTIONS = {
  fileFilter: (path) => true,
  directoryFilter: (path) => true,
  type: 'files',
  root: '.',
  depth: 2147483648,
  _currentDepth: 0,
};

const READDIRP_ARGS = {withFileTypes: true};

async function* _opendir(parentPath) {
  if (opendir) {
    const dir = await opendir(parentPath);
    for await (const dirent of dir) {
      yield dirent;
    }
  } else {
    const dir = await readdir(parentPath, READDIRP_ARGS);
    for (const dirent of dir) {
      yield dirent;
    }
  }
}

async function* explore(parentPath, _currentDepth, opts) {
  const requestedType = opts.type;
  const maxDepth = opts.depth;
  const _parentPath = opts.root === DEFAULT_OPTIONS.root ?
    parentPath : sysPath.relative(opts.root, parentPath);

  for await (const dirent of _opendir(_parentPath)) {
    const basename = dirent.name;
    const path = sysPath.join(_parentPath, basename);
    const depth = _currentDepth + 1;
    const isDirectory = dirent.isDirectory();
    const entry = {path, basename, dirent};
    if (opts.alwaysStat) {
      entry.stats = await stat(path);
    }

    if (isDirectory) {
      if (depth < maxDepth) {
        if (opts.directoryFilter(path)) {
          yield* explore(path, depth, opts);
        }
      }
      if (DIR_TYPES.has(requestedType) && depth <= maxDepth) {
        yield entry;
      }
    } else {
      if (opts.fileFilter(path) && FILE_TYPES.has(requestedType) && depth <= maxDepth) {
        yield entry;
      }
    }
  }
}

async function* readdirp(parentPath, options = {}) {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options);
  yield* explore(parentPath, 0, opts);
}

module.exports = readdirp;
// for await (const dirent of readdirp('.'))
