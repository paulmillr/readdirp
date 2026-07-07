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
import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { join as pjoin, resolve as presolve, sep as psep } from 'node:path';
import { Readable } from 'node:stream';

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
  // Throughput is flat from 16 to 65536 (traversal is I/O-bound), but
  // batches of 1024+ entries survive young-gen GC and bloat RSS ~20-60%.
  highWaterMark: 256,
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
  /** Undefined when the directory could not be read (a 'warn' was emitted). */
  files: PathOrDirent[] | undefined;
  depth: number;
  path: Path;
}

/** Readable readdir stream, emitting new files as they're being listed. */
interface PendingDir {
  path: Path;
  depth: number;
  // Set when this dir's readdir was started ahead of time (prefetch).
  pending?: Promise<DirEntry>;
}

export class ReaddirpStream extends Readable {
  /**
   * Directories discovered but not yet emitted from. Listings are read
   * lazily (on pop, plus one prefetch) instead of eagerly on discovery:
   * keeping whole listings for every queued dir balloons RAM on wide trees.
   */
  parents: PendingDir[];
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
  _relStart: number;

  constructor(options: Partial<ReaddirpOptions> = {}) {
    super({
      objectMode: true,
      autoDestroy: true,
      highWaterMark: options.highWaterMark ?? defaultOptions.highWaterMark,
    });
    const opts = { ...defaultOptions, ...options };
    // Use ?? so an explicit `undefined` in user options doesn't shadow defaults.
    const root = opts.root ?? defaultOptions.root!;
    const type = opts.type ?? defaultOptions.type!;

    this._fileFilter = normalizeFilter(opts.fileFilter);
    this._directoryFilter = normalizeFilter(opts.directoryFilter);

    const statMethod = opts.lstat ? lstat : stat;
    // Use bigint stats if it's windows and stat() supports options (node 10+).
    if (wantBigintFsStats) {
      this._stat = (path: Path) => statMethod(path, { bigint: true });
    } else {
      this._stat = statMethod;
    }

    this._maxDepth =
      opts.depth != null && Number.isSafeInteger(opts.depth) ? opts.depth : defaultOptions.depth!;
    this._wantsDir = DIR_TYPES.has(type);
    this._wantsFile = FILE_TYPES.has(type);
    this._wantsEverything = type === EntryTypes.EVERYTHING_TYPE;
    this._root = presolve(root);
    // Every fullPath is `_root + sep + relative path` (see _formatEntry), so
    // the relative path is a slice starting past the root and its trailing
    // separator (which resolved paths lack, except fs roots like '/', 'C:\').
    this._relStart = this._root.endsWith(psep) ? this._root.length : this._root.length + 1;
    this._isDirent = !opts.alwaysStat;
    this._statsProp = this._isDirent ? 'dirent' : 'stats';
    this._rdOptions = { encoding: 'utf8', withFileTypes: this._isDirent };

    // Launch stream with one parent, the root dir, whose readdir starts
    // right away. Explore the resolved root so all parent paths stay
    // absolute even if process.cwd() changes mid-iteration.
    const rootDir: PendingDir = { path: this._root, depth: 1 };
    rootDir.pending = this._exploreDir(this._root, 1);
    this.parents = [rootDir];
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
          // In dirent mode _formatEntry is synchronous: skip Promise.all and
          // its per-entry microtask overhead.
          const awaited = this._isDirent
            ? (slice as (EntryInfo | undefined)[])
            : await Promise.all(slice);
          for (const entry of awaited) {
            if (!entry) continue;
            if (this.destroyed) return;

            // Only symlinks require async work; plain files / dirs resolve synchronously.
            let entryType = this._getEntryType(entry);
            if (typeof entryType !== 'string') entryType = await entryType;
            if (entryType === 'directory' && this._directoryFilter(entry)) {
              if (depth <= this._maxDepth) {
                // Lazy: don't readdir until this dir is popped. Keeping whole
                // listings for every queued dir would balloon RAM on wide trees.
                this.parents.push({ path: entry.fullPath, depth: depth + 1 });
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
          const dir = parent.pending ?? this._exploreDir(parent.path, parent.depth);
          // Prefetch the next dir so its readdir overlaps with processing
          // this one's entries. Only the stack top is prefetched, keeping at
          // most a handful of listings (~tree depth) in RAM at once.
          const next = this.parents[this.parents.length - 1];
          if (next && !next.pending) {
            next.pending = this._exploreDir(next.path, next.depth);
          }
          this.parent = await dir;
          if (this.destroyed) return;
        }
      }
    } catch (error) {
      this.destroy(error as Error);
    } finally {
      this.reading = false;
    }
  }

  // NOTE: native `readdir(path, { recursive: true })` was evaluated as a
  // replacement for this per-directory traversal and rejected:
  // - Not faster: node implements it in JS, walking directories sequentially
  //   just like this loop, but with extra path bookkeeping. Benchmarks
  //   (node 24): ~10% slower on wide trees, ~40% slower on small ones,
  //   parity on deep ones.
  // - Much more RAM: it buffers the entire subtree listing in one array,
  //   instead of one directory at a time, defeating streaming.
  // - Semantics diverge: it can't limit depth, can't skip directories a
  //   directoryFilter rejects, doesn't follow symlinked dirs, and fails
  //   wholesale (all entries lost) if anything in the subtree is unreadable,
  //   instead of emitting a 'warn' and continuing.
  async _exploreDir(path: Path, depth: number): Promise<DirEntry> {
    let files;
    try {
      files = await readdir(path, this._rdOptions as any);
    } catch (error) {
      this._onError(error as Error);
    }
    return { files, depth, path };
  }

  // Synchronous in dirent mode; returns a promise only when stats are needed.
  _formatEntry(
    dirent: PathOrDirent,
    path: Path
  ): EntryInfo | undefined | Promise<EntryInfo | undefined> {
    const basename = this._isDirent ? (dirent as Dirent).name : (dirent as string);
    // `path` is always an absolute, normalized parent dir (see _exploreDir
    // seeding in the constructor), so a plain join is enough — resolve()
    // would re-read cwd on every entry.
    const fullPath = pjoin(path, basename);
    // Slice instead of path.relative(): equivalent here (fullPath is always
    // under _root) and avoids several intermediate allocations per entry.
    const entry: EntryInfo = { path: fullPath.slice(this._relStart), fullPath, basename };
    if (this._isDirent) {
      entry.dirent = dirent as Dirent;
      return entry;
    }
    return this._stat(fullPath).then(
      (stats: Stats) => {
        entry.stats = stats;
        return entry;
      },
      (err: Error) => {
        this._onError(err);
        return undefined;
      }
    );
  }

  _onError(err: Error): void {
    if (isNormalFlowError(err) && !this.destroyed) {
      this.emit('warn', err);
    } else {
      this.destroy(err);
    }
  }

  // Synchronous for regular files and directories; returns a promise only for
  // symlinks, which need realpath() to be classified.
  _getEntryType(entry: EntryInfo): '' | 'file' | 'directory' | Promise<'' | 'file' | 'directory'> {
    // entry may be undefined, because a warning or an error were emitted
    // and the statsProp is undefined
    if (!entry || !(this._statsProp in entry)) {
      return '';
    }
    const stats = entry[this._statsProp]!;
    if (stats.isFile()) return 'file';
    if (stats.isDirectory()) return 'directory';
    if (stats.isSymbolicLink()) return this._getSymlinkEntryType(entry);
    return '';
  }

  async _getSymlinkEntryType(entry: EntryInfo): Promise<'' | 'file' | 'directory'> {
    const full = entry.fullPath;
    try {
      const entryRealPath = await realpath(full);
      const entryRealPathStats = await lstat(entryRealPath);
      if (entryRealPathStats.isFile()) {
        return 'file';
      }
      if (entryRealPathStats.isDirectory()) {
        const len = entryRealPath.length;
        if (full.startsWith(entryRealPath) && full[len] === psep) {
          const recursiveError = new Error(
            `Circular symlink detected: "${full}" points to "${entryRealPath}"`
          );
          // @ts-ignore
          recursiveError.code = RECURSIVE_ERROR_CODE;
          this._onError(recursiveError);
          return '';
        }
        return 'directory';
      }
    } catch (error) {
      this._onError(error as Error);
    }
    return '';
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
  if (!root) {
    throw new Error('readdirp: root argument is required. Usage: readdirp(root, options)');
  } else if (typeof root !== 'string') {
    throw new TypeError('readdirp: root argument must be a string. Usage: readdirp(root, options)');
  } else if (type && !ALL_TYPES.includes(type)) {
    throw new Error(`readdirp: Invalid type passed. Use one of ${ALL_TYPES.join(', ')}`);
  }

  // Copy options instead of mutating the caller's object.
  const opts: Partial<ReaddirpOptions> = { ...options, root };
  if (type) opts.type = type;
  return new ReaddirpStream(opts);
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
