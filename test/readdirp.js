/*jshint asi:true */


var path     =  require('path')
  , fs       =  require('fs')
  , readdirp =  require('../readdirp.js')
  , root     =  path.join(__dirname, '../test/bed')
  , totalDirs          =  6
  , totalFiles         =  12
  , ext1Files          =  4
  , ext2Files          =  3
  , ext3Files          =  2
  , rootDir2Files      =  2
  , nameHasLength9Dirs =  2
  , depth1Files        =  8
  ;

/* 
Structure of test bed:
    .
    ├── root_dir1
    │   ├── root_dir1_file1.ext1
    │   ├── root_dir1_file2.ext2
    │   ├── root_dir1_file3.ext3
    │   ├── root_dir1_subdir1
    │   │   └── root1_dir1_subdir1_file1.ext1
    │   └── root_dir1_subdir2
    │       └── .gitignore
    ├── root_dir2
    │   ├── root_dir2_file1.ext1
    │   ├── root_dir2_file2.ext2
    │   ├── root_dir2_subdir1
    │   │   └── .gitignore
    │   └── root_dir2_subdir2
    │       └── .gitignore
    ├── root_file1.ext1
    ├── root_file2.ext2
    └── root_file3.ext3

    6 directories, 13 files
*/

// console.log('\033[2J'); // clear console

function opts (extend) {
    var o = { root: root };

    if (extend) {
        for (var prop in extend) {
            o[prop] = extend[prop];
        }
    }
    return o;
}

describe('reading root', function () {

    describe('without filters', function () {

        it('gets all directories', function (done) {
            readdirp(opts(), function (err, res) {
                res.directories.should.have.length(totalDirs);
                done();
            })
        })
        it('gets all files', function (done) {
            readdirp(opts(), function (err, res) {
                res.files.should.have.length(totalFiles);
                done();
            })
        })
    })

    describe('using glob filter', function () {

        describe('normal', function () {
            it('"*.ext1"', function (done) {
                readdirp(opts( { fileFilter: '*.ext1' } ), function (err, res) {
                    res.files.should.have.length(ext1Files);
                    done();
                })
            })

            it('["*.ext1", "*.ext3"]', function (done) {
                readdirp(opts( { fileFilter: [ '*.ext1', '*.ext3' ] } ), function (err, res) {
                    res.files.should.have.length(ext1Files + ext3Files);
                    done();
                })
            })

            it('"root_dir1"', function (done) {
                readdirp(opts( { directoryFilter: 'root_dir1' }), function (err, res) {
                    res.directories.should.have.length(1);
                    done();
                })
            })

            it('["root_dir1", "*dir1_subdir1"]', function (done) {
                readdirp(opts( { directoryFilter: [ 'root_dir1', '*dir1_subdir1' ]}), function (err, res) {
                    res.directories.should.have.length(2);
                    done();
                })
            })

        })

        describe('negated', function () {
            it('"!*.ext1"', function (done) {
                readdirp(opts( { fileFilter: '!*.ext1' } ), function (err, res) {
                    res.files.should.have.length(totalFiles - ext1Files);
                    done();
                })
            })

            it('["!*.ext1", "!*.ext3"]', function (done) {
                readdirp(opts( { fileFilter: [ '!*.ext1', '!*.ext3' ] } ), function (err, res) {
                    res.files.should.have.length(totalFiles - ext1Files - ext3Files);
                    done();
                })
            })
        })

        describe('normal mixed with negated', function () {
            it('["*.ext1", "!*.ext3"] returns error', function (done) {
                readdirp(opts( { fileFilter: [ '*.ext1', '!*.ext3' ] } ), function (err, res) {
                    err[0].toString().should.include('Cannot mix negated with non negated glob filters'); 
                    done();
                })
            })
        })

        describe('handles leading and trailing spaces', function () {

            it('[" *.ext1", "*.ext3 "]', function (done) {
                readdirp(opts( { fileFilter: [ '*.ext1', '*.ext3' ] } ), function (err, res) {
                    res.files.should.have.length(ext1Files + ext3Files);
                    done();
                })
            })

            it('[" !*.ext1", " !*.ext3 "]', function (done) {
                readdirp(opts( { fileFilter: [ ' !*.ext1', ' !*.ext3' ] } ), function (err, res) {
                    res.files.should.have.length(totalFiles - ext1Files - ext3Files);
                    done();
                })
            })
        })

        describe('** glob pattern', function () {
            it('ignores ** "**/*.ext1"', function (done) {
                readdirp(opts( { fileFilter: '**/*.ext1' } ), function (err, res) {
                    res.files.should.have.length(ext1Files);
                    done();
                })
            })
        })
    })

    describe('using function filter', function () {
        it('fileFilter -> name contains root_dir2', function (done) {
            readdirp(
                opts( { fileFilter: function (fi) { return fi.name.indexOf('root_dir2') >= 0; } }), 
                function (err, res) {
                    res.files.should.have.length(rootDir2Files);
                    done();
            })
        })

        it('directoryFilter -> name has length 9', function (done) {
            readdirp(
                opts( { directoryFilter: function (di) { return di.name.length === 9; } }), 
                function (err, res) {
                    res.directories.should.have.length(nameHasLength9Dirs);
                    done();
            })
        })
    })

    describe('specifying maximum depth', function () {
        it('depth 1 does not return files at depth 2', function (done) {
            readdirp(opts( { depth: 1 } ), function (err, res) {
                res.files.should.have.length(depth1Files);
                done();
            })
        })
    })

    describe('progress callbacks', function () {
        var pluckName = function(fi) { return fi.name; }
          , processedFiles = []
          ;

        it('calls back for each processed file', function (done) {
            readdirp(
                opts() 
              , function(fi) { 
                    processedFiles.push(fi);
                } 
              , function (err, res) {
                    processedFiles.should.have.length(res.files.length);
                    processedFiles.map(pluckName).sort().should.eql(res.files.map(pluckName).sort());
                    done();
                })
        })
    })
})

describe('resolving of name, full and relative paths', function () {
    var expected = {  
        name          :  'root_dir1_file1.ext1'
      , parentDirName :  'root_dir1'
      , path          :  'root_dir1/root_dir1_file1.ext1'
      , fullPath      :  'test/bed/root_dir1/root_dir1_file1.ext1'
    }
    , opts = [ 
         { root: './test/bed'          ,  prefix: ''         }
      ,  { root: './test/bed'          ,  prefix: ''         }
      ,  { root: 'test/bed'            ,  prefix: ''         }
      ,  { root: 'test/bed/'           ,  prefix: ''         }
      ,  { root: './test/../test/bed/' ,  prefix: ''         }
      ,  { root: '.'                   ,  prefix: 'test/bed' }
    ]
    ;
    
    opts.forEach(function(op) {

        op.fileFilter = 'root_dir1_file1.ext1';

        describe('full paths for ' + op.root, function () {
            it('has correct name', function (done) {
                readdirp (op, function(err, res) {
                    res.files[0].name.should.equal(expected.name);
                    done();
                });
            })
            
            it('has correct path', function (done) {
                readdirp (op, function(err, res) {
                    res.files[0].path.should.equal(path.join(op.prefix, expected.path));
                    done();
                });
            })

            it('has correct full parent dir and full path', function (done) {
                fs.realpath(op.root, function(err, fullRoot) {
                    readdirp ( op, function(err, res) {
                        res.files[0].fullParentDir.should.equal(path.join(fullRoot, op.prefix, expected.parentDirName));
                        res.files[0].fullPath.should.equal(path.join(fullRoot, op.prefix, expected.parentDirName, expected.name));
                        done();
                    });
                });
            })

        })
    })
})
