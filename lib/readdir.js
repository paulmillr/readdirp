var fs = require('fs')
  , path = require('path')
  , minimatch = require('minimatch')
  , utl = require('./utl')
  ;


function readdir(opts, cb) {
    opts.root            =  opts.root            || '.';
    opts.fileFilter      =  opts.fileFilter      || undefined;
    opts.directoryFilter =  opts.directoryFilter || undefined;
    opts.depth           =  opts.depth           || 9999;
    opts.error           =  opts.error           || function (error) { console.log(error); };

    var pending = 0, 
        readdirResult = {
            directories: [],
            files: []
        };


    readdirRec(opts.root, 0, function () { cb(readdirResult); });

    var filterEntryInfo = (function () {

        function negated (filters) {

            function isNegated(f) { 
                return f.indexOf('!') === 0; 
            }

            var some = filters.some(isNegated);
            if (!some) {
                return false;
            } else {
                // Todo: ensure no mix
                return true;
            }
        }

        return function(ei, filter) {
            if (utl.isUndefined(filter)) return true;

            if (utl.isString(filter)) {


                var match =  minimatch(ei.name, filter);
                return match;

            } else if (Array.isArray(filter)) {

                return negated(filter)?
                    // use AND condition for multiple negated filters
                    filter.every(function (f) {
                        return minimatch(ei.name, f);
                    }) :
                    // use OR condition for multiple normal filters
                    filter.some(function (f) {
                        return minimatch(ei.name, f);
                    });
            } 
        };
    })();

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

                if(pendingSubdirs === 0) {
                    // nothing more to do here
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

// Testing 
/*
var opts = {
    root: path.join(__dirname, '../test/bed'),
    excludeDirs: [ 'node_modules' ]
};

console.log('\033[2J'); // clear console
readdir(opts, function (res) {
    console.log('done', res);
});
*/
