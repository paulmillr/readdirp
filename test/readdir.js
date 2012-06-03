/*jshint asi:true */

var path  = require('path') 
  , fsrec = require('../index.js')
  , root  = path.join(__dirname, '../test/bed')
  , totalDirs = 6
  , totalFiles = 9
  , ext1Files = 4
  , ext3Files = 2
  ;

/* 
Structure of test bed:
    bed ── root_dir1
        │   ├── root_dir1_file1.ext1
        │   ├── root_dir1_file2.ext2
        │   ├── root_dir1_file3.ext3
        │   ├── root_dir1_subdir1
        │   │   └── root1_dir1_subdir1_file1.ext1
        │   └── root_dir1_subdir2
        ├── root_dir2
        │   ├── root_dir2_file1.ext1
        │   ├── root_dir2_file2.ext2
        │   ├── root_dir2_subdir1
        │   └── root_dir2_subdir2
        ├── root_file1.ext1
        ├── root_file2.ext2
        └── root_file3.ext3
*/

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
            fsrec.readdir(opts(), function (res) {
                res.directories.length.should.equal(totalDirs);
                done();
            })
        })
    })

    describe('using file filter', function () {

        describe('normal', function () {
            it('"*.ext1"', function (done) {
                fsrec.readdir(opts( { fileFilter: '*.ext1' } ), function (res) {
                    res.files.length.should.equal(ext1Files);
                    done();
                })
            })

            it('["*.ext1", "*.ext3"]', function (done) {
                fsrec.readdir(opts( { fileFilter: [ '*.ext1', '*.ext3' ] } ), function (res) {
                    res.files.length.should.equal(ext1Files + ext3Files);
                    done();
                })
            })
        })

        describe('negated', function () {
            it('"!*.ext1"', function (done) {
                fsrec.readdir(opts( { fileFilter: '!*.ext1' } ), function (res) {
                    res.files.length.should.equal(totalFiles - ext1Files);
                    done();
                })
            })
            
        })
    })
})

