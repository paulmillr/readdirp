var fs = require('fs')
  , path = require('path')
  , minimatch = require('minimatch')
  , utl = require('./utl')
  ;


function readdir(opts, cb) {
    opts.root            =  opts.root            || '.';
    opts.fileFilter      =  opts.fileFilter      || undefined;
    opts.directoryFilter =  opts.directoryFilter || undefined;
    opts.depth           =  opts.depth           || undefined;

    var pending = 0 
      , errors = []
      , readdirResult = {
            directories: [],
            files: []
        }
     ;

    function normalizeFilter (filter) {

        if (!filter) return undefined;

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
                // use AND condition for multiple negated filters
                function (entryInfo) {
                    return filter.every(function (f) {
                        return minimatch(entryInfo.name, f);
                    });
                }
                :
                // use OR condition for multiple inclusive filters
                function (entryInfo) {
                    return filter.some(function (f) {
                        return minimatch(entryInfo.name, f);
                    });
                };
        }

    }
    try {
        opts.fileFilter = normalizeFilter(opts.fileFilter);
        opts.directoryFilter = normalizeFilter(opts.directoryFilter);
    } catch (err) {
        // if we detect illegal filters, bail out immediately
        cb([err], null);
        return; 
    }

     
    readdirRec(opts.root, 0, function () { 
        if (errors.length > 0) {
            cb(errors, readdirResult); 
        } else {
            cb(null, readdirResult);
        }
    });

    function filterEntryInfo (ei, filter) {
        if (utl.isUndefined(filter)) return true;
        
        return filter(ei);
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
                        opts.error(err);
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
                opts.error(err);
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
                if(pendingSubdirs === 0 || (opts.depth && depth === opts.depth)) {
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

}

exports = module.exports.readdir = readdir;
