# readdirp

> Recursive version of [fs.readdir](https://nodejs.org/api/fs.html#fs_fs_readdir_path_options_callback). Exposes a **stream api** and a **callback api**.

[![NPM](https://nodei.co/npm/readdirp.png?downloads=true&stars=true)](https://nodei.co/npm/readdirp/)

```sh
npm install readdirp
```

```javascript
const readdirp = require('readdirp');

// Callback example. More RAM and CPU than streams.
readdirp('.', (file => console.log(file)), (error, files) => {
  console.log(files);
});

// Streams example. Recommended.
// Print out all JS files along with their size within the current folder & subfolders.
readdirp('.', {fileFilter: '*.js'})
  .on('data', (entry) => {
    const {path} = entry;
    const {size} = entry.stat;
    // Turn each entry info into a string with a line break
    console.log(`${JSON.stringify({path, size})}`);
  })
  // Optionally call stream.destroy() in `warn()` in order to abort and cause 'close' to be emitted
  .on('warn', error => console.error('non-fatal error', error))
  .on('error', error => console.error('fatal error', error))
  .on('end', () => console.log('done'));

// More idiomatic print example: use `require('stream').Transform` and .pipe(process.stdout);

// Other options.
readdirp('test', {fileFilter: '*.js'})
readdirp('test', {fileFilter: ['*.js', '*.json']})
readdirp('test', {directoryFilter: ['!.git', '!*modules']})
readdirp('test', {directoryFilter: (di) => di.name.length === 9})
readdirp('test', {depth: 1})
```

# API

`const stream = readdirp(root[, options])` — **Stream API**

- Reads given root recursively and returns a `stream` of [entry info](#entry-info)s.
- `on('data', (entry) => {})` [entry info](#entry-info) for every file / dir.
- `on('warn', (error) => {})` non-fatal `Error` that prevents a file / dir from being processed. Example: inaccessible to the user.
- `on('error', (error) => {})` fatal `Error` which also ends the stream. Example: illegal options where passed.
- `on('end')` — we are done. Called when all entries were found and no more will be emitted.
- `on('close')` — stream is destroyed via `stream.destroy()`.
  Could be useful if you want to manually abort even on a non fatal error.
  At that point the stream is no longer `readable` and no more entries, warning or errors are emitted
- To learn more about streams, consult the very detailed [nodejs streams documentation](https://nodejs.org/api/stream.html)
  or the [stream-handbook](https://github.com/substack/stream-handbook)

`readdirp(root, options, fileProcessed[, allProcessed])` — **Callback API**

- `fileProcessed: (entry) => {...}`: function with [entry info](#entry-info) parameter
- `allProcessed: (error, entries) => {}`:
    - **error**: array of errors that occurred during the operation, **entries may still be present, even if errors occurred**
    - **entries**: collection of file / dir [entry infos](#entry-info)

### options

- `root: './test'`: path in which to start reading and recursing into subdirectories
- `fileFilter: ["*.js"]`: filter to include or exclude files. A `Function`, Glob string or Array of glob strings.
    - **Function**: a function that takes an entry info as a parameter and returns true to include or false to exclude the entry
    - **Glob string**: a string (e.g., `*.js`) which is matched using [minimatch](https://github.com/isaacs/minimatch), so go there for more
        information. Globstars (`**`) are not supported since specifying a recursive pattern for an already recursive function doesn't make sense. Negated globs (as explained in the minimatch documentation) are allowed, e.g., `!*.txt` matches everything but text files.
    - **Array of glob strings**: either need to be all inclusive or all exclusive (negated) patterns otherwise an error is thrown.
        `[ '*.json', '*.js' ]` includes all JavaScript and Json files.
        `[ '!.git', '!node_modules' ]` includes all directories except the '.git' and 'node_modules'.
    - Directories that do not pass a filter will not be recursed into.
- `directoryFilter: ["!.git"]`: filter to include/exclude directories found and to recurse into. Directories that do not pass a filter will not be recursed into.
- `depth: 5`: depth at which to stop recursing even if more subdirectories are found
- `entryType: 'all'`: determines if data events on the stream should be emitted for `'files'`, `'directories'`, `'both'`, or `'all'`. Setting to `'all'` will also include entries for other types of file descriptors like character devices, unix sockets and named pipes. Defaults to `'files'`.
- `lstat: false`: include symlink entries in the stream along with files. When `true`, `fs.lstat` would be used instead of `fs.stat`

### entry info

Has the following properties:

- `path: 'test/bed/root_dir1/root_dir1_subdir1'`: path to the file/directory (relative to given root)
- `parentDir: 'test/bed/root_dir1'`: directory in which entry was found (relative to given root)
- `fullParentDir: '/User/dev/readdirp/test/bed/root_dir1'`: full path to parent directory
- `name: 'root_dir1_subdir1'`: name of the file/directory
- `fullPath: '/User/dev/readdirp/test/bed/root_dir1/root_dir1_subdir1'`: full path to the file/directory found
- `stat: fs.Stats`: built in [stat object](https://nodejs.org/api/fs.html#fs_class_fs_stats)

### More examples

- `grep` example:

```js
let {join} = require('path');
let {createReadStream} = require('fs');
let es = require('event-stream');

const findLinesMatching = (searchTerm) => {
  return es.through(function (entry) {
    let lineno = 0;
    let matchingLines = [];
    let fileStream = this;

    fsCreateReadStream(entry.fullPath, {encoding: 'utf-8'})
      // handle file contents line by line
      .pipe(es.split('\n'))
      // filter, keep only the lines that matched the term
      .pipe(es.mapSync((line) => {
        lineno++;
        return ~line.indexOf(searchTerm) ? lineno + ': ' + line : undefined;
      }))
      // aggregate matching lines and delegate control back to the file stream
      .pipe(es.through(
        (data) => { matchingLines.push(data); },
        () => {
        // drop files that had no matches
        if (matchingLines.length) {
          let result = { file: entry, lines: matchingLines };
          fileStream.emit('data', result); // pass result on to file stream
        }
        this.emit('end');
      }));
  });
};

// create a stream of all javascript files found in this and all sub directories
// find all lines matching the term
// for each file (if none found, that file is ignored)
readdirp(__dirname, {fileFilter: '*.js'})
  .pipe(findLinesMatching('arguments'))
  .pipe(es.mapSync(function (res) {
    // format the results and output
    return '\n\n' + res.file.path + '\n\t' + res.lines.join('\n\t');
  }))
  .pipe(process.stdout);
```

# License

MIT License, see LICENSE file.
