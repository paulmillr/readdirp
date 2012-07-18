# readdirp [![Build Status](https://secure.travis-ci.org/thlorenz/readdirp.png)](http://travis-ci.org/thlorenz/readdirp)

Recursive version of [fs.readdir](http://nodejs.org/docs/latest/api/fs.html#fs_fs_readdir_path_callback).

```javascript
var readdirp = require('readdirp'); 

readdirp({ root: './test/bed', fileFilter: '*.js' }, function (err, res) {
    // do something with JavaScript files and all directories
});
```

Meant to be one of the recursive versions of [fs](http://nodejs.org/docs/latest/api/fs.html) functions, e.g., like [mkdirp](https://github.com/substack/node-mkdirp).

**Table of Contents**  *generated with [DocToc](http://doctoc.herokuapp.com/)*

- [Installation](#installation)
- [API](#api)
	- [options](#options)
	- [callbacks](#callbacks)
		- [allProcessed ](#allprocessed)
		- [fileProcessed](#fileprocessed)
	- [entry info](#entry-info)
	- [Filters](#filters)
- [More Examples](#more-examples)

# Installation

    npm install readdirp

# API

***readdirp (options, callback1 [, callback2])***

Reads given root recursively and returns list of files and directories with stats attached.

## options
    
- **root**: path in which to start reading and recursing into subdirectories

- **fileFilter**: filter to include/exclude files found (see [Filters](#filters) for more)

- **directoryFilter**: filter to include/exclude directories found and to recurse into (see [Filters](#filters) for more)

- **depth**: depth at which to stop recursing even if more subdirectories are found

## callbacks

If callback2 is given, callback1 functions as the **fileProcessed** callback, and callback2 as the **allProcessed** callback.

If only callback1 is given, it functions as the **allProcessed** callback.

### allProcessed 

- function with err and res parameters, e.g., `function (err, res) { ... }`
- **err**: array of errors that occurred during the operation, **res may still be present, even if errors occurred**
- **res**: collection of file/directory [entry infos](#entry-info)

### fileProcessed

- function with [entry info](#entry-info) parameter e.g., `function (entryInfo) { ... }`

## entry info

Has the following properties:

- **parentDir**     :  directory in which entry was found (relative to given root)
- **fullParentDir** :  full path to parent directory
- **name**          :  name of the file/directory
- **path**          :  path to the file/directory (relative to given root)
- **fullPath**      :  full path to the file/directory found
- **stat**          :  built in [stat object](http://nodejs.org/docs/v0.4.9/api/fs.html#fs.Stats)
- **Example**: (assuming root was `/User/dev/readdirp`)
        
        parentDir     :  'test/bed/root_dir1',
        fullParentDir :  '/User/dev/readdirp/test/bed/root_dir1',
        name          :  'root_dir1_subdir1',
        path          :  'test/bed/root_dir1/root_dir1_subdir1',
        fullPath      :  '/User/dev/readdirp/test/bed/root_dir1/root_dir1_subdir1',
        stat          :  [ ... ]
                    
## Filters
    
There are three different ways to specify filters for files and directories respectively. 

- **function**: a function that takes an entry info as a parameter and returns true to include or false to exclude the entry

- **glob string**: a string (e.g., `*.js`) which is matched using [minimatch](https://github.com/isaacs/minimatch), so go there for more
    information. 

    Globstars (`**`) are not supported since specifiying a recursive pattern for an already recursive function doesn't make sense.

    Negated globs (as explained in the minimatch documentation) are allowed, e.g., `!*.txt` matches everything but text files.

- **array of glob strings**: either need to be all inclusive or all exclusive (negated) patterns otherwise an error is thrown.
    
    `[ '*.json', '*.js' ]` includes all JavaScript and Json files.
    
    
    `[ '!.git', '!node_modules' ]` includes all directories except the '.git' and 'node_modules'.

Directories that do not pass a filter will not be recursed into.

# More Examples

```javascript
var readdirp = require('readdirp');

// Glob file filter
readdirp({ root: './test/bed', fileFilter: '*.js' }, function (err, res) {
  // do something with JavaScript files and all directories
});

// Combined glob file filters
readdirp({ root: './test/bed', fileFilter: [ '*.js', '*.json' ] }, function (err, res) {
  // do something with JavaScript and Json files and all directories
});

// Combined negated directory filters
readdirp({ root: './test/bed', directoryFilter: [ '!.git', '!*modules' ] }, function (err, res) {
  // do something with all files and directories found outside '.git' or any modules directory 
});

// Function directory filter
readdirp(
  { root: './test/bed', directoryFilter: function (di) { return di.name.length === 9; } }, 
  function (err, res) {
  // do something with all files and directories found inside or matching directories whose name has length 9
})

// Limiting depth
readdirp({ root: './test/bed', depth: 1 }, function (err, res) {
  // do something with all files and directories found up to 1 subdirectory deep
});

// Using file processed callback
readdirp(
    { root: '.' }
  , function(fileInfo) { 
      // do something with file here
    } 
  , function (err, res) {
      // all done, move on or do final step for all files and directories here
    }
);
```

For more examples see the [readdirp tests](https://github.com/thlorenz/readdirp/blob/master/test/readdirp.js)

