var fs        =  require('fs')
  , path      =  require('path')
  , minimatch =  require('minimatch')
  , utl       =  require('./utl')
  ;

/** 
 * Main function which ends up calling readdirRec and reads all files and directories in given root recursively.
 * @param { Object }   opts         Options to specify root (start directory), filters and recursion depth
 * @param { function } callback1    When callback2 is given calls back for each processed file - function (fileInfo) { ... },
 *                                  when callback2 is not given, it behaves like explained in callback2
 * @param { function } callback2    Calls back once all files have been processed with an array of errors and file infos
 *                                  function (err, fileInfos) { ... }
 */
function readdir(opts, callback1, callback2) {

    if (utl.isUndefined(opts) || utl.isUndefined(callback1)) {
        throw new Error ('Need to define opts and at least one callback!');
    }

    opts.root               =  opts.root               || '.';
    opts.fileFilter         =  opts.fileFilter         || function() { return true; };
    opts.directoryFilter    =  opts.directoryFilter    || function() { return true; };
    opts.depth              =  opts.depth              || 999999999;

    var pending = 0
      , errors = []
      , readdirResult = {
            directories: []
          , files: []
        }
      , fileProcessed
      , allProcessed
      , realRoot
      ;

    if (utl.isUndefined(callback2)) {
        fileProcessed = function() { };
        allProcessed = callback1;
    } else {
        fileProcessed = callback1;
        allProcessed = callback2;
    }

    function normalizeFilter (filter) {

        if (utl.isUndefined(filter)) return undefined;

        function isNegated (filters) {

            function negated(f) { 
                return f.indexOf('!') === 0; 
            }

            var some = filters.some(negated);
            if (!some) {
                return false;
            } else {
                if (filters.every(negated)) {
                    return true;
                } else {
                    // if we detect illegal filters, bail out immediately
                    throw new Error("Cannot mix negated with non negated glob filters: " + filters);
                }
            }
        }

        // Turn all filters into a function
        if (utl.isFunction(filter)) {

            return filter;

        } else if (utl.isString(filter)) {

            return function (entryInfo) {
                return minimatch(entryInfo.name, filter.trim());
            };

        } else if (filter && Array.isArray(filter)) {

            if (filter) filter = filter.map(function (f) {
              return f.trim();
            });

            return isNegated(filter) ?
                // use AND to concat multiple negated filters
                function (entryInfo) {
                    return filter.every(function (f) {
                        return minimatch(entryInfo.name, f);
                    });
                }
                :
                // use OR to concat multiple inclusive filters
                function (entryInfo) {
                    return filter.some(function (f) {
                        return minimatch(entryInfo.name, f);
                    });
                };
        }
    }

    function processDir(currentDir, entries, callProcessed) {
        var total = entries.length
          , processed = 0
          , entryInfos = []
          ;

        fs.realpath(currentDir, function(err, realCurrentDir) {
            var relDir = path.relative(realRoot, realCurrentDir);

            if (entries.length === 0) {
                callProcessed([]);
            } else {
                entries.forEach(function (entry) { 

                    var fullPath = path.join(realCurrentDir, entry),
                        relPath  = path.join(relDir, entry);

                    fs.stat(fullPath, function (err, stat) {
                        if (err) {
                            errors.push(err);
                        } else {
                            entryInfos.push({
                                name          :  entry
                              , path          :  relPath     // relative to root
                              , fullPath      :  fullPath

                              , parentDir     :  relDir      // relative to root
                              , fullParentDir :  realCurrentDir

                              , stat          :  stat
                            });
                        }
                        processed++;
                        if (processed === total) callProcessed(entryInfos);
                    });
                });
            }
        });
    }

    function readdirRec(currentDir, depth, callCurrentDirProcessed) {

        fs.readdir(currentDir, function (err, entries) {
            if (err) {
                errors.push(err);
                callCurrentDirProcessed();
                return;
            }

            processDir(currentDir, entries, function(entryInfos) {

                var subdirs = entryInfos
                    .filter(function (ei) { return ei.stat.isDirectory() && opts.directoryFilter(ei); });

                subdirs.forEach(function (di) { 
                    readdirResult.directories.push(di); 
                });

                entryInfos
                    .filter(function(ei) { return ei.stat.isFile() && opts.fileFilter(ei); })
                    .forEach(function (fi) { 
                        fileProcessed(fi);
                        readdirResult.files.push(fi); 
                    });

                var pendingSubdirs = subdirs.length;

                // Be done if no more subfolders exist or we reached the maximum desired depth
                if(pendingSubdirs === 0 || depth === opts.depth) {
                    callCurrentDirProcessed();
                } else {
                    // recurse into subdirs, keeping track of which ones are done 
                    // and call back once all are processed
                    subdirs.forEach(function (subdir) {
                        readdirRec(subdir.fullPath, depth + 1, function () {
                            pendingSubdirs = pendingSubdirs - 1;
                            if(pendingSubdirs === 0) { 
                                callCurrentDirProcessed();
                            }
                        });
                    });
                }
            });
        });
    }

    // Validate and normalize filters
    try {
        opts.fileFilter = normalizeFilter(opts.fileFilter);
        opts.directoryFilter = normalizeFilter(opts.directoryFilter);
    } catch (err) {
        // if we detect illegal filters, bail out immediately
        allProcessed([err], null);
        return; 
    }

    // If filters were valid get on with the show
    fs.realpath(opts.root, function(err, res) {
        
        realRoot = res;
        readdirRec(opts.root, 0, function () { 
            // All errors are collected into the errors array
            if (errors.length > 0) {
                allProcessed(errors, readdirResult); 
            } else {
                allProcessed(null, readdirResult);
            }
        });
    });
}

exports = module.exports.readdir = readdir;

/* ---- Testing */

/*
console.log ('\n ++++++++++++++++++++++++++++++++++++++\n ++++++++++++++++++++++++++++++++++++++++++++++++ \n\n');

var op =  { root: './test/bed/', fileFilter: 'root_dir1_file1.ext1', directoryFilter: ['!.git', '!node_modules'] };

readdir(op,  function(err, res) {
    console.log('Root: ', op.root);
    console.log(res.files);
    console.log('\n\n ======================================= \n');
    op.root = 'test/bed';
    
    readdir(op,  function(err, res) {
    console.log('Root: ', op.root);
        console.log(res.files);
        console.log('\n\n ======================================= \n');

        op.root = '.';

        readdir(op,  function(err, res) {
            console.log('Root: ', op.root);
            console.log(res.files);
            console.log('\n\n ======================================= \n');

            op.root = "/Users/thlorenz/Dropboxes/Gmail/Dropbox/dev/javascript/projects/fsrec/test/bed";
            readdir(op,  function(err, res) {
                    console.log('Root: ', op.root);
                console.log(res.files);
                console.log('\n\n ======================================= \n');
            });
        });
    });
});
*/
