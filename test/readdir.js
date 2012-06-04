/*jshint asi:true */


var path  = require('path') 
  , fsrec = require('../index.js')
  , root  = path.join(__dirname, '../test/bed')
  , totalDirs = 6
  , totalFiles = 12 
  , ext1Files = 4
  , ext2Files = 3
  , ext3Files = 2
  , rootDir2Files = 2
  , nameHasLength9Dirs = 2
  , depth1Files = 8
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
            fsrec.readdir(opts(), function (err, res) {
                res.directories.should.have.length(totalDirs);
                done();
            })
        })
        it('gets all files', function (done) {
            fsrec.readdir(opts(), function (err, res) {
                res.files.should.have.length(totalFiles);
                done();
            })
        })
    })

    describe('using glob filter', function () {

        describe('normal', function () {
            it('"*.ext1"', function (done) {
                fsrec.readdir(opts( { fileFilter: '*.ext1' } ), function (err, res) {
                    res.files.should.have.length(ext1Files);
                    done();
                })
            })

            it('["*.ext1", "*.ext3"]', function (done) {
                fsrec.readdir(opts( { fileFilter: [ '*.ext1', '*.ext3' ] } ), function (err, res) {
                    res.files.should.have.length(ext1Files + ext3Files);
                    done();
                })
            })

            it('"root_dir1"', function (done) {
                fsrec.readdir(opts( { directoryFilter: 'root_dir1' }), function (err, res) {
                    res.directories.should.have.length(1);
                    done();
                })
            })

            it('["root_dir1", "*dir1_subdir1"]', function (done) {
                fsrec.readdir(opts( { directoryFilter: [ 'root_dir1', '*dir1_subdir1' ]}), function (err, res) {
                    res.directories.should.have.length(2);
                    done();
                })
            })

        })

        describe('negated', function () {
            it('"!*.ext1"', function (done) {
                fsrec.readdir(opts( { fileFilter: '!*.ext1' } ), function (err, res) {
                    res.files.should.have.length(totalFiles - ext1Files);
                    done();
                })
            })

            it('["!*.ext1", "!*.ext3"]', function (done) {
                fsrec.readdir(opts( { fileFilter: [ '!*.ext1', '!*.ext3' ] } ), function (err, res) {
                    res.files.should.have.length(totalFiles - ext1Files - ext3Files);
                    done();
                })
            })
        })

        describe('normal mixed with negated', function () {
            it('["*.ext1", "!*.ext3"] returns error', function (done) {
                fsrec.readdir(opts( { fileFilter: [ '*.ext1', '!*.ext3' ] } ), function (err, res) {
                    err[0].toString().should.include('Cannot mix negated with non negated glob filters'); 
                    done();
                })
            })
        })

        describe('** glob pattern', function () {
            it('ignores ** "**/*.ext1"', function (done) {
                fsrec.readdir(opts( { fileFilter: '**/*.ext1' } ), function (err, res) {
                    res.files.should.have.length(ext1Files);
                    done();
                })
            })
        })
    })

    describe('using function filter', function () {
        it('fileFilter -> name contains root_dir2', function (done) {
            fsrec.readdir(
                opts( { fileFilter: function (fi) { return fi.name.indexOf('root_dir2') >= 0; } }), 
                function (err, res) {
                    res.files.should.have.length(rootDir2Files);
                    done();
            })
        })

        it('directoryFilter -> name has length 9', function (done) {
            fsrec.readdir(
                opts( { directoryFilter: function (di) { return di.name.length === 9; } }), 
                function (err, res) {
                    res.directories.should.have.length(nameHasLength9Dirs);
                    done();
            })
        })
    })

    describe('specifying maximum depth', function () {
        it('depth 1 does not return files at depth 2', function (done) {
            fsrec.readdir(opts( { depth: 1 } ), function (err, res) {
                res.files.should.have.length(depth1Files);
                done();
            })
        })
    })
})

