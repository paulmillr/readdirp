"use strict";

const fs = require("graceful-fs");
const path = require("path");
const { isMatch } = require("micromatch");
const sapi = require("./stream-api");

function negated(f) {
  return f.indexOf("!") === 0;
}

function isNegated(filters) {
  if (!filters.some(negated)) {
    return false;
  }
  if (filters.every(negated)) {
    return true;
  }

  // if we detect illegal filters, bail out immediately
  throw new Error(
    "Cannot mix negated with non negated glob filters: " +
      filters +
      "\n" +
      "https://github.com/paulmillr/readdirp#filters"
  );
}

function normalizeFilter(filter) {
  if (filter === undefined) {
    return;
  }

  // Turn all filters into a function
  if (typeof filter === "function") {
    return filter;
  }

  if (typeof filter === "string") {
    return entryInfo => isMatch(entryInfo.name, filter.trim());
  }

  if (Array.isArray(filter)) {
    filter = filter.map(f => f.trim());

    return isNegated(filter)
      ? // use AND to concat multiple negated filters
        entryInfo => filter.every(f => isMatch(entryInfo.name, f))
      : // use OR to concat multiple inclusive filters
        entryInfo => filter.some(f => isMatch(entryInfo.name, f));
  }
}

function processDir(
  { currentDir, statfn, entries, realRoot, aborted, handleError },
  callProcessed
) {
  if (aborted) {
    return;
  }
  const total = entries.length;
  const entryInfos = [];
  let processed = 0;

  fs.realpath(currentDir, (err, realCurrentDir) => {
    if (aborted) {
      return;
    }
    if (err) {
      handleError(err);
      callProcessed(entryInfos);
      return;
    }

    const relDir = path.relative(realRoot, realCurrentDir);

    if (entries.length === 0) {
      callProcessed([]);
    } else {
      entries.forEach(entry => {
        const fullPath = path.join(realCurrentDir, entry);
        const relPath = path.join(relDir, entry);

        statfn(fullPath, (err, stat) => {
          if (err) {
            handleError(err);
          } else {
            entryInfos.push({
              name: entry,
              path: relPath, // relative to root
              fullPath: fullPath,

              parentDir: relDir, // relative to root
              fullParentDir: realCurrentDir,

              stat: stat
            });
          }
          processed++;
          if (processed === total) {
            callProcessed(entryInfos);
          }
        });
      });
    }
  });
}

function readdirRec(options, callCurrentDirProcessed) {
  const {
    paused,
    statfn,
    currentDir,
    depth,
    aborted,
    handleError,
    realRoot,
    readdirOptions,
    readdirResult,
    fileProcessed
  } = options;
  if (aborted) {
    return;
  }
  if (paused) {
    setImmediate(() => readdirRec(options, callCurrentDirProcessed));
    return;
  }

  fs.readdir(currentDir, (err, entries) => {
    if (err) {
      handleError(err);
      callCurrentDirProcessed();
      return;
    }

    processDir(
      { currentDir, statfn, entries, aborted, realRoot, handleError },
      entryInfos => {
        const subdirs = entryInfos.filter(
          ei => ei.stat.isDirectory() && readdirOptions.directoryFilter(ei)
        );

        subdirs.forEach(di => {
          if (
            readdirOptions.entryType === "directories" ||
            readdirOptions.entryType === "both" ||
            readdirOptions.entryType === "all"
          ) {
            fileProcessed(di);
          }
          readdirResult.directories.push(di);
        });

        entryInfos
          .filter(ei => {
            const isCorrectType =
              readdirOptions.entryType === "all"
                ? !ei.stat.isDirectory()
                : ei.stat.isFile() || ei.stat.isSymbolicLink();
            return isCorrectType && readdirOptions.fileFilter(ei);
          })
          .forEach(fi => {
            if (
              readdirOptions.entryType === "files" ||
              readdirOptions.entryType === "both" ||
              readdirOptions.entryType === "all"
            ) {
              fileProcessed(fi);
            }
            readdirResult.files.push(fi);
          });

        let pendingSubdirs = subdirs.length;

        // Be done if no more subfolders exist or we reached the maximum desired depth
        if (pendingSubdirs === 0 || depth === readdirOptions.depth) {
          callCurrentDirProcessed();
        } else {
          // recurse into subdirs, keeping track of which ones are done
          // and call back once all are processed
          subdirs.forEach(subdir => {
            readdirRec(
              {
                ...options,
                depth: depth + 1,
                currentDir: subdir.fullPath
              },
              () => {
                pendingSubdirs = pendingSubdirs - 1;
                if (pendingSubdirs !== 0) {
                  return;
                }
                callCurrentDirProcessed();
              }
            );
          });
        }
      }
    );
  });
}

/**
 * Main function which ends up calling readdirRec and reads all files and directories in given root recursively.
 * @param { Object }   opts     Options to specify root (start directory), filters and recursion depth
 * @param { function } [callback1]  When callback2 is given calls back for each processed file - function (fileInfo) { ... },
 *                                  when callback2 is not given, it behaves like explained in callback2
 * @param { function } [callback2]  Calls back once all files have been processed with an array of errors and file infos
 *                                  function (err, fileInfos) { ... }
 */
function readdir(opts, callback1, callback2) {
  let stream;
  let handleError;
  let handleFatalError;
  let errors = [];
  let readdirResult = {
    directories: [],
    files: []
  };
  let fileProcessed;
  let allProcessed;
  let realRoot;
  let aborted = false;
  let paused = false;

  // If no callbacks were given we will use a streaming interface
  if (callback1 === undefined) {
    const api = sapi();
    stream = api.stream;
    callback1 = api.processEntry;
    callback2 = api.done;
    handleError = api.handleError;
    handleFatalError = api.handleFatalError;

    stream.on("close", () => {
      aborted = true;
    });
    stream.on("pause", () => {
      paused = true;
    });
    stream.on("resume", () => {
      paused = false;
    });
  } else {
    handleError = err => {
      errors.push(err);
    };
    handleFatalError = err => {
      handleError(err);
      allProcessed(errors, null);
    };
  }

  if (opts === undefined) {
    handleFatalError(
      new Error(
        "Need to pass at least one argument: opts! \n" +
          "https://github.com/paulmillr/readdirp#options"
      )
    );
    return stream;
  }

  opts.root = opts.root || ".";
  opts.fileFilter = opts.fileFilter || (() => true);
  opts.directoryFilter = opts.directoryFilter || (() => true);
  opts.depth = opts.depth === undefined ? 999999999 : opts.depth;
  opts.entryType = opts.entryType || "files";

  const statfn = opts.lstat === true ? fs.lstat.bind(fs) : fs.stat.bind(fs);

  if (callback2 === undefined) {
    fileProcessed = () => {};
    allProcessed = callback1;
  } else {
    fileProcessed = callback1;
    allProcessed = callback2;
  }

  // Validate and normalize filters
  try {
    opts.fileFilter = normalizeFilter(opts.fileFilter);
    opts.directoryFilter = normalizeFilter(opts.directoryFilter);
  } catch (err) {
    // if we detect illegal filters, bail out immediately
    handleFatalError(err);
    return stream;
  }

  // If filters were valid get on with the show
  fs.realpath(opts.root, function(err, res) {
    if (err) {
      handleFatalError(err);
      return stream;
    }

    realRoot = res;
    readdirRec(
      {
        paused,
        aborted,
        handleError,
        realRoot,
        currentDir: opts.root,
        statfn,
        depth: 0,
        readdirOptions: opts,
        readdirResult,
        fileProcessed
      },
      () => {
        // All errors are collected into the errors array
        const realErrors = errors.length > 0 ? errors : null;
        allProcessed(realErrors, readdirResult);
      }
    );
  });

  return stream;
}

module.exports = readdir;
