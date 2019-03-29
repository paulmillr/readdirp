# readdirp

> Recursive version of [fs.readdir](https://nodejs.org/api/fs.html#fs_fs_readdir_path_options_callback). Exposes a **stream api** and a **callback api**.

[![NPM](https://nodei.co/npm/readdirp.png?downloads=true&stars=true)](https://nodei.co/npm/readdirp/)

```sh
npm install readdirp
```

```javascript
const readdirp = require('readdirp');

// Callback example. More RAM and CPU than streams.
readdirp({root: '.'}, (file => console.log(file)), (error, files) => {
  console.log(files);
});

// Streams example. Recommended.
// Print out all JavaScript files within
// the current folder and subfolders along with their size.
const {EOL} = require('os');
const {Transform} = require('stream');
const stream = readdirp({
  root: __dirname,
  fileFilter: '*.js',
});

stream
  .on('warn', (error) => {
    console.error('non-fatal error', error);
    // Optionally call stream.destroy() here in order to abort and cause 'close' to be emitted
  })
  .on('error', error => console.error('fatal error', error))
  .on('end', () => console.log('done'))
  .pipe(new Transform({
    objectMode: true,
    transform(entryInfo, encoding, callback) {
      // Turn each entry info into a more simplified representation
      this.push({path: entryInfo.path, size: entryInfo.stat.size});
      callback();
    },
  }))
  .pipe(new Transform({
    objectMode: true,
    transform(entryInfo, encoding, callback) {
      // Turn each entry info into a string with a line break
      this.push(`${JSON.stringify(entryInfo)}${EOL}`);
      callback();
    },
  }))
  .pipe(process.stdout);
```

Meant to be one of the recursive versions of [fs](https://nodejs.org/api/fs.html) functions, e.g., like [mkdirp](https://github.com/substack/node-mkdirp).

# API

- `const stream = readdirp(options)` — **Stream API**
    - Reads given root recursively and returns a `stream` of [entry info](#entry-info)s.
    - `on('data')` passes an [entry info](#entry-info) whenever one is found
    - `on('warn')` passes a non-fatal `Error` that prevents a file/directory from being processed (i.e., if it is inaccessible to the user)
    - `on('error')` passes a fatal `Error` which also ends the stream (i.e., when illegal options where passed)
    - `on('end')` called when all entries were found and no more will be emitted (i.e., we are done)
    - `on('close')` called when the stream is destroyed via `stream.destroy()` (which could be useful if you want to manually abort even on a non fatal error) - at that point the stream is no longer `readable` and no more entries, warning or errors are emitted
    - to learn more about streams, consult the very detailed [nodejs streams documentation](http://nodejs.org/api/stream.html) or the [stream-handbook](https://github.com/substack/stream-handbook)
- `readdirp (options, fileProcessed[, allProcessed])` — **Callback API**
    - `fileProcessed`: function with [entry info](#entry-info) parameter e.g., `(entry) => {...}`
    - `allProcessed`: `(error, entries) => {}`
        - **error**: array of errors that occurred during the operation, **entries may still be present, even if errors occurred**
        - **entries**: collection of file / directory [entry infos](#entry-info)

### options

- `root: './test'`: path in which to start reading and recursing into subdirectories
- `fileFilter: ["*.js"]`: filter to include/exclude files found
    - There are three different ways to specify filters for files and directories respectively.
    - **function**: a function that takes an entry info as a parameter and returns true to include or false to exclude the entry
    - **glob string**: a string (e.g., `*.js`) which is matched using [minimatch](https://github.com/isaacs/minimatch), so go there for more
        information. Globstars (`**`) are not supported since specifying a recursive pattern for an already recursive function doesn't make sense. Negated globs (as explained in the minimatch documentation) are allowed, e.g., `!*.txt` matches everything but text files.
    - **array of glob strings**: either need to be all inclusive or all exclusive (negated) patterns otherwise an error is thrown.
        `[ '*.json', '*.js' ]` includes all JavaScript and Json files.
        `[ '!.git', '!node_modules' ]` includes all directories except the '.git' and 'node_modules'.
    - Directories that do not pass a filter will not be recursed into.
- `directoryFilter: ["!.git"]`: filter to include/exclude directories found and to recurse into. Directories that do not pass a filter will not be recursed into.
- `depth: 5`: depth at which to stop recursing even if more subdirectories are found
- `entryType: 'all'`: determines if data events on the stream should be emitted for `'files'`, `'directories'`, `'both'`, or `'all'`. Setting to `'all'` will also include entries for other types of file descriptors like character devices, unix sockets and named pipes. Defaults to `'files'`.
- `lstat: false`: use `fs.lstat` instead of `fs.stat` in order to include symlink entries in the stream along with files.

### entry info

Has the following properties:

- `parentDir: 'test/bed/root_dir1'`: directory in which entry was found (relative to given root)
- `fullParentDir: '/User/dev/readdirp/test/bed/root_dir1'`: full path to parent directory
- `name: 'root_dir1_subdir1'`: name of the file/directory
- `path: 'test/bed/root_dir1/root_dir1_subdir1'`: path to the file/directory (relative to given root)
- `fullPath: '/User/dev/readdirp/test/bed/root_dir1/root_dir1_subdir1'`: full path to the file/directory found
- `stat: [...]`: built in [stat object](https://nodejs.org/api/fs.html#fs_class_fs_stats)

## Examples

`on('error', ..)`, `on('warn', ..)` and `on('end', ..)` handling omitted for brevity

```javascript
// Every line would emit stream. Listen to its events with
// .on('data', (entry) => {})
readdirp({root: './test/bed', fileFilter: '*.js'})
readdirp({root: './test/bed', fileFilter: ['*.js', '*.json']})
readdirp({root: './test/bed', directoryFilter: ['!.git', '!*modules']})
readdirp({root: './test/bed', directoryFilter: (di) => di.name.length === 9})
readdirp({root: './test/bed', depth: 1})

// callback api
readdirp({ root: '.' }, (entry) => {}, (error, entries) => {
    // all done, move on or do final step for all file entries here
});
```
