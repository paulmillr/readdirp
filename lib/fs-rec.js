Array.prototype.unique = function () {
  var o = {},
        i, 
        l = this.length,
        r = [];

    for (i = 0; i < l; i += 1) o[this[i]] = this[i];
    for (i in o) r.push(o[i]);
    return r;
};

Array.prototype.contains = function (elem) {
    return this.indexOf(elem) > -1;
};

var fs = require('fs'),
    path = require('path');

function readdir(opts, cb) {
    // includes and excludes can be regex wildcard or function, too
    // only includes or excludes can be set respectively
    opts.root            =  opts.root            || '.';
    opts.includeDirs     =  opts.includeDirs     || null; 
    opts.excludeDirs     =  opts.excludeDirs     || null; 
    opts.includeFiles    =  opts.includeFiles    || null; 
    opts.excludeFiles    =  opts.excludeFiles    || null; 
    opts.depth           =  opts.depth           || 9999;
    opts.error           =  opts.error           || function (error) { console.log(error); };

    var pending = 0, 
        readdirResult = {
            directories: [],
            files: []
        };

    readdirRec(opts.root, 0, function () { cb(readdirResult); });

    function readdirRec(currentDir, depth, callCurrentDirProcessed) {
        fs.readdir(currentDir, function (err, entries) {
            if (err) {
                opts.error(err);
                return;
            }

            process(currentDir, entries, function(fileInfos) {
                var subdirs = fileInfos
                    .filter(function(fi) { 
                        return fi.stat.isDirectory() && !(opts.excludeDirs && opts.excludeDirs.contains(fi.name));
                    });

                subdirs.forEach(function (fi) { readdirResult.directories.push(fi); });

                fileInfos
                    .filter(function(fi) { return fi.stat.isFile(); })
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

    function process(currentDir, entries, callProcessed) {
        var total = entries.length,
            processed = 0,
            fileInfos = [],
            dir = currentDir.substr(opts.root.length);

        if (entries.length === 0) {
            callProcessed([]);
        } else {
            entries
                .forEach(function (entry) { 

                    var fullPath = path.join(currentDir, entry),
                        relPath  = path.join(dir, entry);

                    fs.stat(fullPath, function (err, stat) {
                        if (err) {
                            opts.error(err);
                        } else {
                            fileInfos.push({
                                parentDir     :  dir,
                                fullParentDir :  currentDir,
                                name          :  entry,
                                path          :  relPath,
                                fullPath      :  fullPath,
                                stat          :  stat
                            });
                        }
                        processed++;
                        if (processed === total) callProcessed(fileInfos);
                    }
                );

            });
        }

    }
}

var opts = {
    root: path.join(__dirname, '../test/bed'),
    excludeDirs: [ 'node_modules' ]
};

console.log('\033[2J'); // clear console
readdir(opts, function (res) {
    console.log('done', res);
});
