/*jshint asi:true */

var test     =  require('tap').test
  , path     =  require('path')
  , fs       =  require('fs')
  , util     =  require('util')
  , Stream   =  require('stream')
  , through  =  require('through')
  , readdirp =  require('..')
  , root     =  path.join(__dirname, 'bed')
  // see test/readdirp.js for test bed layout
  , totalDirs  =  6
  , totalFiles =  12
  , ext1Files  =  4
  , ext2Files  =  3
  , ext3Files  =  2
  ;

function opts (extend) {
  var o = { root: root };

  if (extend) {
    for (var prop in extend) {
      o[prop] = extend[prop];
    }
  }
  return o;
}

function capture () {
  var result = { entries: [], errors: [], ended: false }
    , dst = new Stream();

  dst.writable = true;
  dst.readable = true;

  dst.write = function (entry) {
    result.entries.push(entry);
  }

  dst.end = function () {
    result.ended = true;
    dst.emit('data', result);
    dst.emit('end');
  }

  return dst;
}

//console.log('\033[2J'); // clear console

test('\nreading root without filter', function (t) {
  t.plan(2);
  readdirp(opts())
    .on('error', function (err) {
      t.fail('should not throw error', err);
    })
    .pipe(capture())
    .pipe(through(
      function (result) { 
        t.equals(result.entries.length, totalFiles, 'emits all files');
        t.ok(result.ended, 'ends stream');
        t.end();
      }
    ));
})

test('\nnormal: ["*.ext1", "*.ext3"]', function (t) {
  t.plan(2);

  readdirp(opts( { fileFilter: [ '*.ext1', '*.ext3' ] } ))
    .on('error', function (err) {
      t.fail('should not throw error', err);
    })
    .pipe(capture())
    .pipe(through(
      function (result) { 
        t.equals(result.entries.length, ext1Files + ext3Files, 'all ext1 and ext3 files');
        t.ok(result.ended, 'ends stream');
        t.end();
      }
    ))
})

test('\nnegated: ["!*.ext1", "!*.ext3"]', function (t) {
  t.plan(2);

  readdirp(opts( { fileFilter: [ '!*.ext1', '!*.ext3' ] } ))
    .on('error', function (err) {
      t.fail('should not throw error', err);
    })
    .pipe(capture())
    .pipe(through(
      function (result) { 
        t.equals(result.entries.length, totalFiles - ext1Files - ext3Files, 'all but ext1 and ext3 files');
        t.ok(result.ended, 'ends stream');
        t.end();
      }
    ))
})

test('\nno options given', function (t) {
  t.plan(1);
  readdirp()
    .on('error', function (err) {
      t.similar(err.toString() , /Need to pass at least one argument/ , 'emits meaningful error');
      t.end();
    })
})

test('\nmixed: ["*.ext1", "!*.ext3"]', function (t) {
  t.plan(1);

  readdirp(opts( { fileFilter: [ '*.ext1', '!*.ext3' ] } ))
    .on('error', function (err) {
      t.similar(err.toString() , /Cannot mix negated with non negated glob filters/ , 'emits meaningful error');
      t.end();
    })
})
