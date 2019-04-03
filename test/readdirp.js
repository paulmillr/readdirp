/*jshint asi:true */

const path     = require('path');
const fs       = require('fs');
const util     = require('util');
const net      = require('net');
const readdirp = require('../');
const os = process.platform;
const root     = path.join(__dirname, '../test/bed');
const totalDirs          =  6;
const totalFiles         =  12;
const ext1Files          =  4;
const ext2Files          =  3;
const ext3Files          =  2;
const rootDir2Files      =  2;
const nameHasLength9Dirs =  2;
const depth1Files        =  8;
const depth0Files        =  3;

var mocha = require('mocha');
var assert = require('assert');

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

// Need for using "bed" as relative path
process.chdir(__dirname);

function opts (extend) {
  var o = {};
  Object.assign(o, extend)
  return o;
}

describe('basic', () => {
  it('reading root without filter', function (done) {
    readdirp(root, opts(), function (err, res) {
      assert.equal(res.directories.length, totalDirs, 'all directories');
      assert.equal(res.files.length, totalFiles, 'all files');
      done();
    })
  });

  it('reading root without filter using lstat', function (done) {

    readdirp(root, opts({ lstat: true }), function (err, res) {
      assert.equal(res.directories.length, totalDirs, 'all directories');
      assert.equal(res.files.length, totalFiles, 'all files');
      done()
    })
  })

  it('reading root with symlinks using lstat', function (done) {

    fs.symlinkSync(path.join(root, 'root_dir1'), path.join(root, 'dirlink'));
    fs.symlinkSync(path.join(root, 'root_file1.ext1'), path.join(root, 'link.ext1'));
    readdirp(root, opts({ lstat: true }), function (err, res) {
      assert.equal(res.directories.length, totalDirs, 'all directories');
      assert.equal(res.files.length, totalFiles + 2, 'all files + symlinks');
      fs.unlinkSync(path.join(root, 'dirlink'));
      fs.unlinkSync(path.join(root, 'link.ext1'));
      done()
    })
  })

  if (os !== 'win32') {
    it('reading non-standard fds', function (done) {
      let server = net.createServer().listen(path.join(root, 'test.sock'), function(){
        readdirp(root, opts({ entryType: 'all' }), function (err, res) {
          assert.equal(res.files.length, totalFiles + 1, 'all files + socket');
          readdirp(root, opts({ entryType: 'both' }), function (err, res) {
            assert.equal(res.files.length, totalFiles, 'all regular files only');
            server.close();
            done()
          })
        })
      });
    });
  }
});

describe('reading root using glob filter', function (done) {
  // normal
  it('# "*.ext1"', function (done) {

    readdirp(root, opts( { fileFilter: '*.ext1' } ), function (err, res) {
      assert.equal(res.files.length, ext1Files, 'all ext1 files');
      done()
    })
  })
  it('# ["*.ext1", "*.ext3"]', function (done) {

    readdirp(root, opts( { fileFilter: [ '*.ext1', '*.ext3' ] } ), function (err, res) {
      assert.equal(res.files.length, ext1Files + ext3Files, 'all ext1 and ext3 files');
      done()
    })
  })
  it('# "root_dir1"', function (done) {

    readdirp(root, opts( { directoryFilter: 'root_dir1' }), function (err, res) {
      assert.equal(res.directories.length, 1, 'one directory');
      done()
    })
  })
  it('# ["root_dir1", "*dir1_subdir1"]', function (done) {

    readdirp(root, opts( { directoryFilter: [ 'root_dir1', '*dir1_subdir1' ]}), function (err, res) {
      assert.equal(res.directories.length, 2, 'two directories');
      done()
    })
  })

  it('# negated: "!*.ext1"', function (done) {

    readdirp(root, opts( { fileFilter: '!*.ext1' } ), function (err, res) {
      assert.equal(res.files.length, totalFiles - ext1Files, 'all but ext1 files');
      done()
    })
  })
  it('# negated: ["!*.ext1", "!*.ext3"]', function (done) {

    readdirp(root, opts( { fileFilter: [ '!*.ext1', '!*.ext3' ] } ), function (err, res) {
      assert.equal(res.files.length, totalFiles - ext1Files - ext3Files, 'all but ext1 and ext3 files');
      done()
    })
  })

  it('# mixed: ["*.ext1", "!*.ext3"]', function (done) {

    readdirp(root, opts( { fileFilter: [ '*.ext1', '!*.ext3' ] } ), function (err, res) {
      var re = /Cannot mix negated with non negated glob filters/;
      assert.ok(re.test(err[0].toString()), 'returns meaningfull error');
      done()
    })
  })

  it('# leading and trailing spaces: [" *.ext1", "*.ext3 "]', function (done) {

    readdirp(root, opts( { fileFilter: [ ' *.ext1', '*.ext3 ' ] } ), function (err, res) {
      assert.equal(res.files.length, ext1Files + ext3Files, 'all ext1 and ext3 files');
      done()
    })
  })
  it('# leading and trailing spaces: [" !*.ext1", " !*.ext3 "]', function (done) {

    readdirp(root, opts( { fileFilter: [ ' !*.ext1', ' !*.ext3' ] } ), function (err, res) {
      assert.equal(res.files.length, totalFiles - ext1Files - ext3Files, 'all but ext1 and ext3 files');
      done()
    })
  })

  it('# ** glob pattern', function (done) {

    readdirp(root,opts( { fileFilter: '**/*.ext1' } ), function (err, res) {
      assert.equal(res.files.length, ext1Files, 'ignores ** in **/*.ext1 -> only *.ext1 files');
      done()
    })
  })
})

describe('reading root using function filter', function (done) {
  it('# file filter -> "contains root_dir2"', function (done) {

    readdirp(root,
        opts( { fileFilter: function (fi) { return fi.name.indexOf('root_dir2') >= 0; } })
      , function (err, res) {
          assert.equal(res.files.length, rootDir2Files, 'all rootDir2Files');
          done()
      }
    )
  })

  it('# directory filter -> "name has length 9"', function (done) {

    readdirp(root,
        opts( { directoryFilter: function (di) { return di.name.length === 9; } })
      , function (err, res) {
          assert.equal(res.directories.length, nameHasLength9Dirs, 'all all dirs with name length 9');
          done()
      }
    )
  })
})

describe('root', function () {
  it('# depth 1', function(done) {
      readdirp(root, opts({depth: 1}), (() => {}), function (err, res) {
        assert.ifError(err);
        assert.equal(res.files.length, depth1Files, 'does not return files at depth 2');
        done();
      })
  });
  it('# depth 0', function (done) {
    readdirp(root, opts({depth: 0}), (() => {}), function (err, res) {
      assert.ifError(err);
      assert.equal(res.files.length, depth0Files, 'does not return files at depth 0');
      done();
    })
  });

  it('progress callbacks', function (done) {


    var pluckName = function(fi) { return fi.name; };
    var processedFiles = [];

    readdirp(root, opts(), function(fi) { processedFiles.push(fi);}, function (err, res) {
          assert.equal(processedFiles.length, res.files.length, 'calls back for each file processed');
          // t.deepEquals();
          assert.deepEqual(processedFiles.map(pluckName).sort(),res.files.map(pluckName).sort(), 'same file names');
          done()
        }
    )
  });
});

describe('resolving of name, full and relative paths', function () {
  var expected = {
        name          :  'root_dir1_file1.ext1'
      , parentDirName :  'root_dir1'
      , path          :  'root_dir1/root_dir1_file1.ext1'
      , fullPath      :  'test/bed/root_dir1/root_dir1_file1.ext1'
      }
    , opts = [
        { root: './bed'          ,  prefix: ''     }
      , { root: './bed/'         ,  prefix: ''     }
      , { root: 'bed'            ,  prefix: ''     }
      , { root: 'bed/'           ,  prefix: ''     }
      , { root: '../test/bed/'   ,  prefix: ''     }
      , { root: '.'              ,  prefix: 'bed'  }
    ];

  opts.forEach(function (op) {
    op.fileFilter = 'root_dir1_file1.ext1';

    it('' + util.inspect(op), function (done) {
      this.timeout(5000);
      readdirp(op.root, op, function(err, res) {
        assert.ifError(err);
        assert.equal(res.files[0].name, expected.name, 'correct name');
        assert.equal(res.files[0].path, path.join(op.prefix, expected.path), 'correct path');

        fs.realpath(op.root, function(err, fullRoot) {
          readdirp(op.root, op, function(err, res) {
            assert.equal(
                res.files[0].fullParentDir
              , path.join(fullRoot, op.prefix, expected.parentDirName)
              , 'correct parentDir'
            );
            assert.equal(
                res.files[0].fullPath
              , path.join(fullRoot, op.prefix, expected.parentDirName, expected.name)
              , 'correct fullPath'
            );
            done();
          })
        })
      })
    })
  })
})


