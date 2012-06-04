var fs = require('fs')
  , path = require('path')
  , minimatch = require('minimatch')
  , utl = require('./utl')
  ;

// main function which ends up calling readdirRec
function readdir(opts, cb) {
    opts.root            =  opts.root            || '.';
    opts.fileFilter      =  opts.fileFilter      || undefined;
    opts.directoryFilter =  opts.directoryFilter || undefined;
    opts.depth           =  opts.depth           || 999999999;

    var pending = 0 
      , errors = []
      , readdirResult = {
            directories: [],
            files: []
        }
      ;

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
                return minimatch(entryInfo.name, filter);
            };

        } else if (filter && Array.isArray(filter)) {
            
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

    function filterEntryInfo (ei, filter) {
        // no filter? - let all go through, otherwise apply it
        return utl.isUndefined(filter) || filter(ei);
    }

    function process(currentDir, entries, callProcessed) {
        var total = entries.length,
            processed = 0,
            entryInfos = [],
            dir = currentDir.substr(opts.root.length);

        if (entries.length === 0) {
            callProcessed([]);
        } else {
            entries.forEach(function (entry) { 

                var fullPath = path.join(currentDir, entry),
                    relPath  = path.join(dir, entry);

                fs.stat(fullPath, function (err, stat) {
                    if (err) {
                        errors.push(err);
                    } else {
                        entryInfos.push({
                            parentDir     :  dir,
                            fullParentDir :  currentDir,
                            name          :  entry,
                            path          :  relPath,
                            fullPath      :  fullPath,
                            stat          :  stat
                        });
                    }
                    processed++;
                    if (processed === total) callProcessed(entryInfos);
                });
            });
        }
    }

    function readdirRec(currentDir, depth, callCurrentDirProcessed) {

        fs.readdir(currentDir, function (err, entries) {
            if (err) {
                errors.push(err);
                callCurrentDirProcessed();
                return;
            }

            process(currentDir, entries, function(entryInfos) {

                var subdirs = entryInfos
                    .filter(function (ei) { return ei.stat.isDirectory() && filterEntryInfo(ei, opts.directoryFilter); });

                subdirs.forEach(function (di) { readdirResult.directories.push(di); });

                entryInfos
                    .filter(function(ei) { return ei.stat.isFile() && filterEntryInfo(ei, opts.fileFilter); })
                    .forEach(function (fi) { readdirResult.files.push(fi); });

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
                            if(pendingSubdirs === 0) callCurrentDirProcessed();
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
        cb([err], null);
        return; 
    }

    // If filters were valid get on with the show
    readdirRec(opts.root, 0, function () { 
        // All errors are collected into the errors array
        if (errors.length > 0) {
            cb(errors, readdirResult); 
        } else {
            cb(null, readdirResult);
        }
    });
}

exports = module.exports.readdir = readdir;
