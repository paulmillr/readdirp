"use strict";

const readdirp = require("./lib/stream-api");

/**
 * Main function which ends up calling readdirRec and reads all files and directories in given root recursively.
 * @param { Object }   opts     Options to specify root (start directory), filters and recursion depth
 * @param { function } [fileProcessed]  When callback2 is given calls back for each processed file - function (fileInfo) { ... },
 *                                  when callback2 is not given, it behaves like explained in callback2
 * @param { function } [allProcessed]  Calls back once all files have been processed with an array of errors and file infos
 *                                  function (err, fileInfos) { ... }
 */
function readdir(options, fileProcessed, allProcessed) {
  const errors = [];
  const readdirResult = {
    directories: [],
    files: []
  };
  const api = readdirp.createStreamAPI(options);
  const stream = api.stream;

  if (options === undefined) {
    stream._handleFatalError(
      new Error(
        "Need to pass at least one argument: opts! \n" +
          "https://github.com/paulmillr/readdirp#options"
      )
    );
  }

  if (!fileProcessed && !allProcessed) {
    return stream;
  }

  const notifyAllProcessed = allProcessed || fileProcessed;
  const notifyFileProcessed =
    fileProcessed !== notifyAllProcessed && fileProcessed;

  stream.on("data", entryInformation => {
    if (stream.isFile(entryInformation)) {
      readdirResult.files.push(entryInformation);
    }
    if (typeof notifyFileProcessed === "function") {
      notifyFileProcessed(entryInformation);
    }
  });

  stream.on("__directory", entryInformation => {
    readdirResult.directories.push(entryInformation);
  });

  stream.on("warn", error => {
    errors.push(error);
  });

  stream.on("error", error => {
    errors.push(error);
    if (typeof notifyAllProcessed === "function") {
      notifyAllProcessed(errors, null);
    }
  });

  stream.on("end", () => {
    if (typeof notifyAllProcessed === "function") {
      const realErrors = errors.length > 0 ? errors : null;
      notifyAllProcessed(realErrors, readdirResult);
    }
  });

  return stream;
}

module.exports = readdir;
