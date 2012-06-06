**Table of Contents**  *generated with [DocToc](http://doctoc.herokuapp.com/)*

- [Installation](#installation)
- [readdir](#readdir)
	- [Signature](#signature)
		- [options](#options)
		- [callbacks](#callbacks)
			- [allProcessed ](#allprocessed)
			- [fileProcessed](#fileprocessed)
		- [entry info](#entry-info)
	- [Filters](#filters)
	- [Examples](#examples)

# fsrec [![Build Status](https://secure.travis-ci.org/thlorenz/fsrec.png)](http://travis-ci.org/thlorenz/fsrec)

Recursive versions of [fs module](http://nodejs.org/docs/v0.6.6/api/fs.html) functions, so far `readdir`.

`mkdir` will not be implemented as there is already a great module for this:
[mkdirp](https://github.com/substack/node-mkdirp), so use that alongside fsrec.

`readFile` is yet to come and to request other other recursive versions of fs functions please do so [here](https://github.com/thlorenz/fsrec/issues/new).

# Installation

    npm install fsrec

# readdir

- reads given root recursively and returns list of files and directories with stats attached

## Signature

```javascript
fs.readdir (options, callback1 [, callback2]);
```

### options
    
- **root**: path in which to start reading and recursing into subdirectories

- **fileFilter**: filter to include/exclude files found (see [Filters](#filters) for more)

- **directoryFilter**: filter to include/exclude directories found and to recurse into (see [Filters](#filters) for more)

- **depth**: depth at which to stop recursing even if more subdirectories are found

### callbacks

If callback2 is given, callback1 functions as the **fileProcessed** callback, and callback2 as the **allProcessed** callback.

If only callback1 is given, it functions as the **allProcessed** callback.

#### allProcessed 

- function with err and res parameters, e.g., `function (err, res) { ... }`
- **err**: array of errors that occurred during the operation, **res may still be present, even if errors occurred**
- **res**: collection of file/directory [entry infos](#entry-info)

#### fileProcessed

- function with [entry info](#entry-info) parameter e.g., `function (entryInfo) { ... }`

### entry info

Has the following properties:

- **parentDir**: directory in which entry was found
- **fullParentDir**: full path of parent directory
- **name**: name of the file/directory
- **path**: path to the file/directory relative to root directory
- **fullPath**: full path to the file/directory
- **stat**: built in [stat object](http://nodejs.org/docs/v0.4.9/api/fs.html#fs.Stats)
- **Example**:
            
        parentDir     :  '/root_dir1',
        fullParentDir :  '/Users/thlorenz/dev/javascript/projects/fsrec/test/bed/root_dir1',
        name          :  'root_dir1_subdir1',
        path          :  '/root_dir1/root_dir1_subdir1',
        fullPath      :  '/Users/thlorenz/dev/javascript/projects/fsrec/test/bed/root_dir1/root_dir1_subdir1',
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

## Examples

```javascript
    var fsrec = require('fsrec');

    // Glob file filter
    fsrec.readdir(opts( { root: './test/bed', fileFilter: '*.js' } ), function (err, res) {
        // do something with JavaScript files and all directories
    });

    // Combined glob file filters
    fsrec.readdir(opts( { root: './test/bed', fileFilter: [ '*.js', '*.json' ] } ), function (err, res) {
        // do something with JavaScript and Json files and all directories
    });

    // Combined negated directory filters
    fsrec.readdir(opts( { root: './test/bed', fileFilter: [ '!.git', '!*modules' ] } ), function (err, res) {
        // do something with all files and directories found outside '.git' or any modules directory 
    });

    // Function directory filter
    fsrec.readdir(
        opts( { root: './test/bed', directoryFilter: function (di) { return di.name.length === 9; } }), 
        function (err, res) {
        // do something with all files and directories found inside or matching directories whose name has length 9
    })

    // Limiting depth
    fsrec.readdir({ root: './test/bed', depth: 1 }, function (err, res) {
        // do something with all files and directories found up to 1 subdirectory deep
    });

    // Using file processed callback
    fsrec.readdir(
          { root: '.' }
        , function(fileInfo) { 
            // do something with file here
          } 
        , function (err, res) {
            // all done, move on or do final step for all files and directories here
        })
```

For more examples see the [readdir tests](https://github.com/thlorenz/fsrec/blob/master/test/readdir.js)

