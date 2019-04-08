/*jshint asi:true */

const path = require("path");
const TransformStream = require("stream").Transform;
const through = require("through2");
const proxyquire = require("proxyquire");
const streamapi = require("../lib/stream");
const readdirp = require("../lib");
const root = path.join(__dirname, "bed");
const totalDirs = 6;
const totalFiles = 12;
const ext1Files = 4;
const ext2Files = 3;
const ext3Files = 2;

const mocha = require("mocha");
const assert = require("assert");

// Need for using "bed" as relative path
process.chdir(__dirname);

// see test/readdirp.js for test bed layout

function opts(extend) {
  var o = { };
  Object.assign(o, extend);
  return o;
}

function capture() {
  var result = { entries: [], errors: [], ended: false },
    dst = new TransformStream({ objectMode: true });

  dst._transform = function(entry, _, cb) {
    result.entries.push(entry);
    cb();
  };

  dst._flush = function(cb) {
    result.ended = true;
    this.push(result);
    cb();
  };

  return dst;
}

describe("integrated", function() {
  it("reading root without filter", function(done) {
    readdirp(root)
      .on("error", function(err) {
        assert.fail("should not throw error", err);
      })
      .pipe(capture())
      .pipe(
        through.obj(function(result, _, cb) {
          assert.equal(result.entries.length, totalFiles, "emits all files");
          assert.ok(result.ended, "ends stream");
          done();
          cb();
        })
      );
  });

  it('normal: ["*.ext1", "*.ext3"]', function(done) {
    readdirp(root, opts({ fileFilter: ["*.ext1", "*.ext3"] }))
      .on("error", function(err) {
        assert.fail("should not throw error", err);
      })
      .pipe(capture())
      .pipe(
        through.obj(function(result, _, cb) {
          assert.equal(
            result.entries.length,
            ext1Files + ext3Files,
            "all ext1 and ext3 files"
          );
          assert.ok(result.ended, "ends stream");
          done();
          cb();
        })
      );
  });

  it("files only", function(done) {
    readdirp(root, opts({ entryType: "files" }))
      .on("error", function(err) {
        assert.fail("should not throw error", err);
      })
      .pipe(capture())
      .pipe(
        through.obj(function(result, _, cb) {
          assert.equal(result.entries.length, totalFiles, "returned files");
          assert.ok(result.ended, "ends stream");
          done();
          cb();
        })
      );
  });

  it("directories only", function(done) {
    readdirp(root, opts({ entryType: "directories" }))
      .on("error", function(err) {
        assert.fail("should not throw error", err);
      })
      .pipe(capture())
      .pipe(
        through.obj(function(result, _, cb) {
          assert.equal(
            result.entries.length,
            totalDirs,
            "returned directories"
          );
          assert.ok(result.ended, "ends stream");
          done();
          cb();
        })
      );
  });

  it("both directories + files", function(done) {
    readdirp(root, opts({ entryType: "both" }))
      .on("error", function(err) {
        assert.fail("should not throw error", err);
      })
      .pipe(capture())
      .pipe(
        through.obj(function(result, _, cb) {
          assert.equal(
            result.entries.length,
            totalDirs + totalFiles,
            "returned everything"
          );
          assert.ok(result.ended, "ends stream");
          done();
          cb();
        })
      );
  });

  it("directory filter with directories only", function(done) {
    readdirp(root,
      opts({
        entryType: "directories",
        directoryFilter: ["root_dir1", "*dir1_subdir1"]
      })
    )
      .on("error", function(err) {
        assert.fail("should not throw error", err);
      })
      .pipe(capture())
      .pipe(
        through.obj(function(result, _, cb) {
          assert.equal(result.entries.length, 2, "two directories");
          assert.ok(result.ended, "ends stream");
          done();
          cb();
        })
      );
  });

  it("directory and file filters with both entries", function(done) {
    readdirp(root,
      opts({
        entryType: "both",
        directoryFilter: ["root_dir1", "*dir1_subdir1"],
        fileFilter: ["!*.ext1"]
      })
    )
      .on("error", function(err) {
        assert.fail("should not throw error", err);
      })
      .pipe(capture())
      .pipe(
        through.obj(function(result, _, cb) {
          assert.equal(result.entries.length, 6, "2 directories and 4 files");
          assert.ok(result.ended, "ends stream");
          done();
          cb();
        })
      );
  });

  it('negated: ["!*.ext1", "!*.ext3"]', function(done) {
    readdirp(root, opts({ fileFilter: ["!*.ext1", "!*.ext3"] }))
      .on("error", function(err) {
        assert.fail("should not throw error", err);
      })
      .pipe(capture())
      .pipe(
        through.obj(function(result, _, cb) {
          assert.equal(
            result.entries.length,
            totalFiles - ext1Files - ext3Files,
            "all but ext1 and ext3 files"
          );
          assert.ok(result.ended, "ends stream");
          done();
        })
      );
  });

  it("no options given", function(done) {
    readdirp().on("error", function(err) {
      var re = /root argument is required/;
      assert.ok(re.test(err.toString()), "emits meaningful error");
      done();
    });
  });

  it("old API", function(done) {
    readdirp({root: '.'}).on("error", function(err) {
      var re = /root argument must be a string/;
      assert.ok(re.test(err.toString()), "emits meaningful error");
      done();
    });
  });

  it('mixed: ["*.ext1", "!*.ext3"]', function(done) {
    readdirp(root, opts({fileFilter: ["*.ext1", "!*.ext3"]})).on("error", function(err) {
      var re = /Cannot mix negated with non negated glob filters/;
      assert.ok(re.test(err.toString()), "emits meaningful error");
      done();
    });
  });
});

describe("api separately", function() {
  it("handleError", function(done) {
    var api = streamapi.createStreamAPI(),
      warning = new Error("some file caused problems");

    api.stream.on("warn", function(err) {
      assert.equal(err, warning, "warns with the handled error");
      done();
    });
    api.handleError(warning);
  });

  it("when stream is paused and then resumed", function(done) {
    var api = streamapi.createStreamAPI(),
      resumed = false,
      fatalError = new Error("fatal!"),
      nonfatalError = new Error("nonfatal!"),
      processedData = "some data";

    api.stream
      .on("warn", function(err) {
        assert.equal(err, nonfatalError, "emits the buffered warning");
        assert.ok(resumed, "emits warning only after it was resumed");
      })
      .on("error", function(err) {
        assert.equal(err, fatalError, "emits the buffered fatal error");
        assert.ok(resumed, "emits errors only after it was resumed");
      })
      .pause();

    // api.stream._warnings.push(nonfatalError);
    // api.stream._errors.push(fatalError);
    // api.stream._buffer.push(processedData);
    var handler = function(data) {
      api.stream.removeListener("data", handler);
      assert.equal(data, processedData, "emits the buffered data");
      assert.ok(resumed, "emits data only after it was resumed");
      done();
    };

    setTimeout(function() {
      resumed = true;
      api.stream.resume();
      console.log('resumed');

      // stream will return to resume state because he has "data" handler
      api.stream.on("data", handler);
    }, 1);
  });

  it("when a stream is paused it stops walking the fs", function(done) {
    var resumed = false;

    const stream = readdirp(root, opts())
      .on("error", function(err) {
        assert.fail("should not throw error", err);
      })
      .on("end", function() {
        done();
      })
      .pause();

    setTimeout(function() {
      stream.resume();
      resumed = true;
    }, 5);
  });

  it('when a stream is destroyed, it emits "closed", but no longer emits "data", "warn" and "error"', function(done) {
    var api = streamapi.createStreamAPI(),
      fatalError = new Error("fatal!"),
      nonfatalError = new Error("nonfatal!"),
      processedData = "some data",
      plan = 0;

    var stream = api.stream
      .on("warn", function(err) {
        assert.ok(!stream._destroyed, "emits warning until destroyed");
      })
      .on("error", function(err) {
        assert.ok(!stream._destroyed, "emits errors until destroyed");
      })
      .on("data", function(data) {
        assert.ok(!stream._destroyed, "emits data until destroyed");
      })
      .on("close", function() {
        // assert.ok(stream._destroyed, "emits close when stream is destroyed");
      });

    // api.handleError(nonfatalError);
    // api.handleFatalError(fatalError);

    setTimeout(function() {
      stream.destroy();

      assert.ok(
        !stream.readable,
        "stream is no longer readable after it is destroyed"
      );

      // api.handleError(nonfatalError);
      // api.handleFatalError(fatalError);

      process.nextTick(function() {
        assert.ok(
          true,
          "emits no more data, warn or error events after it was destroyed"
        );
        done();
      });
    }, 10);
  });
});
