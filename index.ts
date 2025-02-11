/**
 * Recursive version of readdir. Exposes a streaming API and promise API.
 * Streaming API allows to use a small amount of RAM.
 *
 * @module
 * @example
```js
import readdirp from 'readdirp';
for await (const entry of readdirp('.')) {
  const {path} = entry;
  console.log(`${JSON.stringify({path})}`);
}
```
 */
/*! readdirp - MIT License (c) 2012-2019 Thorsten Lorenz, Paul Miller (https://paulmillr.com) */
import type { Stats, Dirent } from 'node:fs';
import { stat, lstat, readdir, realpath } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { resolve as presolve, relative as prelative, join as pjoin, sep as psep } from 'node:path';

// We can't use statSync, lstatSync, because some users may want to
// use graceful-fs, which doesn't support sync methods.

/** Path in file system. */
export type Path = string;
/** Emitted entry. Contains relative & absolute path, basename, and either stats or dirent. */
export interface EntryInfo {
  path: string;
  fullPath: string;
  stats?: Stats;
  dirent?: Dirent;
  basename: string;
}
/** Path or dir entries (files) */
export type PathOrDirent = Dirent | Path;
/** Filterer for files */
export type Tester = (entryInfo: EntryInfo) => boolean;
export type Predicate = string[] | string | Tester;
export const EntryTypes = {
  FILE_TYPE: 'files',
  DIR_TYPE: 'directories',
  FILE_DIR_TYPE: 'files_directories',
  EVERYTHING_TYPE: 'all',
} as const;
export type EntryType = (typeof EntryTypes)[keyof typeof EntryTypes];

/**
 * Options for readdirp.
 * * type: files, directories, or both
 * * lstat: whether to use symlink-friendly stat
 * * depth: max depth
 * * alwaysStat: whether to use stat (more resources) or dirent
 * * highWaterMark: streaming param, specifies max amount of resources per entry
 */
export type ReaddirpOptions = {
  root: string;
  fileFilter?: Predicate;
  directoryFilter?: Predicate;
  type?: EntryType;
  lstat?: boolean;
  depth?: number;
  alwaysStat?: boolean;
  highWaterMark?: number;
};

const defaultOptions: ReaddirpOptions = {
  root: '.',
  fileFilter: (_entryInfo: EntryInfo) => true,
  directoryFilter: (_entryInfo: EntryInfo) => true,
  type: EntryTypes.FILE_TYPE,
  lstat: false,
  depth: 2147483648,
  alwaysStat: false,
  highWaterMark: 4096,
};
Object.freeze(defaultOptions);

const RECURSIVE_ERROR_CODE = 'READDIRP_RECURSIVE_ERROR';
const NORMAL_FLOW_ERRORS = new Set(['ENOENT', 'EPERM', 'EACCES', 'ELOOP', RECURSIVE_ERROR_CODE]);
const ALL_TYPES: string[] = [
  EntryTypes.DIR_TYPE,
  EntryTypes.EVERYTHING_TYPE,
  EntryTypes.FILE_DIR_TYPE,
  EntryTypes.FILE_TYPE,
];
const DIR_TYPES = new Set<string>([
  EntryTypes.DIR_TYPE,
  EntryTypes.EVERYTHING_TYPE,
  EntryTypes.FILE_DIR_TYPE,
]);
const FILE_TYPES = new Set<string>([
  EntryTypes.EVERYTHING_TYPE,
  EntryTypes.FILE_DIR_TYPE,
  EntryTypes.FILE_TYPE,
]);

const isNormalFlowError = (error: any) => NORMAL_FLOW_ERRORS.has(error.code);
const wantBigintFsStats = process.platform === 'win32';
const emptyFn = (_entryInfo: EntryInfo) => true;
const normalizeFilter = (filter?: Predicate) => {
  if (filter === undefined) return emptyFn;
  if (typeof filter === 'function') return filter;
  if (typeof filter === 'string') {
    const fl = filter.trim();
    return (entry: EntryInfo) => entry.basename === fl;
  }
  if (Array.isArray(filter)) {
    const trItems = filter.map((item) => item.trim());
    return (entry: EntryInfo) => trItems.some((f) => entry.basename === f);
  }
  return emptyFn;
};

/** Directory entry. Contains path, depth count, and files. */
export interface DirEntry {
  files: PathOrDirent[];
  depth: number;
  path: Path;
}

/** Readable readdir stream, emitting new files as they're being listed. */
export class ReaddirpStream extends Readable {
  parents: any[];
  reading: boolean;
  parent?: DirEntry;

  _stat: Function;
  _maxDepth: number;
  _wantsDir: boolean;
  _wantsFile: boolean;
  _wantsEverything: boolean;
  _root: Path;
  _isDirent: boolean;
  _statsProp: 'dirent' | 'stats';
  _rdOptions: { encoding: 'utf8'; withFileTypes: boolean };
  _fileFilter: Tester;
  _directoryFilter: Tester;

  constructor(options: Partial<ReaddirpOptions> = {}) {
    super({
      objectMode: true,
      autoDestroy: true,
      highWaterMark: options.highWaterMark,
    });
    const opts = { ...defaultOptions, ...options };
    const { root, type } = opts;

    this._fileFilter = normalizeFilter(opts.fileFilter);
    this._directoryFilter = normalizeFilter(opts.directoryFilter);

    const statMethod = opts.lstat ? lstat : stat;
    // Use bigint stats if it's windows and stat() supports options (node 10+).
    if (wantBigintFsStats) {
      this._stat = (path: Path) => statMethod(path, { bigint: true });
    } else {
      this._stat = statMethod;
    }

    this._maxDepth = opts.depth ?? defaultOptions.depth!;
    this._wantsDir = type ? DIR_TYPES.has(type) : false;
    this._wantsFile = type ? FILE_TYPES.has(type) : false;
    this._wantsEverything = type === EntryTypes.EVERYTHING_TYPE;
    this._root = presolve(root);
    this._isDirent = !opts.alwaysStat;
    this._statsProp = this._isDirent ? 'dirent' : 'stats';
    this._rdOptions = { encoding: 'utf8', withFileTypes: this._isDirent };

    // Launch stream with one parent, the root dir.
    this.parents = [this._exploreDir(root, 1)];
    this.reading = false;
    this.parent = undefined;
  }

  async _read(batch: number): Promise<void> {
    if (this.reading) return;
    this.reading = true;

    try {
      while (!this.destroyed && batch > 0) {
        const par = this.parent;
        const fil = par && par.files;

        if (fil && fil.length > 0) {
          const { path, depth } = par;
          const slice = fil.splice(0, batch).map((dirent) => this._formatEntry(dirent, path));
          const awaited = await Promise.all(slice);
          for (const entry of awaited) {
            if (!entry) continue;
            if (this.destroyed) return;

            const entryType = await this._getEntryType(entry);
            if (entryType === 'directory' && this._directoryFilter(entry)) {
              if (depth <= this._maxDepth) {
                this.parents.push(this._exploreDir(entry.fullPath, depth + 1));
              }

              if (this._wantsDir) {
                this.push(entry);
                batch--;
              }
            } else if (
              (entryType === 'file' || this._includeAsFile(entry)) &&
              this._fileFilter(entry)
            ) {
              if (this._wantsFile) {
                this.push(entry);
                batch--;
              }
            }
          }
        } else {
          const parent = this.parents.pop();
          if (!parent) {
            this.push(null);
            break;
          }
          this.parent = await parent;
          if (this.destroyed) return;
        }
      }
    } catch (error) {
      this.destroy(error as Error);
    } finally {
      this.reading = false;
    }
  }

  async _exploreDir(
    path: Path,
    depth: number
  ): Promise<{
    files: string[] | undefined;
    depth: number;
    path: string;
  }> {
    let files;
    try {
      files = await readdir(path, this._rdOptions as any);
    } catch (error) {
      this._onError(error as Error);
    }
    return { files, depth, path };
  }

  async _formatEntry(dirent: PathOrDirent, path: Path): Promise<EntryInfo | undefined> {
    let entry: EntryInfo;
    const basename = this._isDirent ? (dirent as Dirent).name : (dirent as string);
    try {
      const fullPath = presolve(pjoin(path, basename));
      entry = { path: prelative(this._root, fullPath), fullPath, basename };
      entry[this._statsProp] = this._isDirent ? dirent : await this._stat(fullPath);
    } catch (err) {
      this._onError(err as Error);
      return;
    }
    return entry;
  }

  _onError(err: Error): void {
    if (isNormalFlowError(err) && !this.destroyed) {
      this.emit('warn', err);
    } else {
      this.destroy(err);
    }
  }

  async _getEntryType(entry: EntryInfo): Promise<void | '' | 'file' | 'directory'> {
    // entry may be undefined, because a warning or an error were emitted
    // and the statsProp is undefined
    if (!entry && this._statsProp in entry) {
      return '';
    }
    const stats = entry[this._statsProp]!;
    if (stats.isFile()) return 'file';
    if (stats.isDirectory()) return 'directory';
    if (stats && stats.isSymbolicLink()) {
      const full = entry.fullPath;
      try {
        const entryRealPath = await realpath(full);
        const entryRealPathStats = await lstat(entryRealPath);
        if (entryRealPathStats.isFile()) {
          return 'file';
        }
        if (entryRealPathStats.isDirectory()) {
          const len = entryRealPath.length;
          if (full.startsWith(entryRealPath) && full.substr(len, 1) === psep) {
            const recursiveError = new Error(
              `Circular symlink detected: "${full}" points to "${entryRealPath}"`
            );
            // @ts-ignore
            recursiveError.code = RECURSIVE_ERROR_CODE;
            return this._onError(recursiveError);
          }
          return 'directory';
        }
      } catch (error) {
        this._onError(error as Error);
        return '';
      }
    }
  }

  _includeAsFile(entry: EntryInfo): boolean | undefined {
    const stats = entry && entry[this._statsProp];
    return stats && this._wantsEverything && !stats.isDirectory();
  }
}

/**
 * Streaming version: Reads all files and directories in given root recursively.
 * Consumes ~constant small amount of RAM.
 * @param root Root directory
 * @param options Options to specify root (start directory), filters and recursion depth
 */
export function readdirp(root: Path, options: Partial<ReaddirpOptions> = {}): ReaddirpStream {
  // @ts-ignore
  let type = options.entryType || options.type;
  if (type === 'both') type = EntryTypes.FILE_DIR_TYPE; // backwards-compatibility
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
}

/**
 * Promise version: Reads all files and directories in given root recursively.
 * Compared to streaming version, will consume a lot of RAM e.g. when 1 million files are listed.
 * @returns array of paths and their entry infos
 */
export function readdirpPromise(
  root: Path,
  options: Partial<ReaddirpOptions> = {}
): Promise<EntryInfo[]> {
  return new Promise<EntryInfo[]>((resolve, reject) => {
    const files: EntryInfo[] = [];
    readdirp(root, options)
      .on('data', (entry) => files.push(entry))
      .on('end', () => resolve(files))
      .on('error', (error) => reject(error));
  });
}

export default readdirp;
