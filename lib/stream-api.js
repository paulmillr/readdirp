"use strict";

const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const normalizeFilter = require("./normalizer");

class ReaddirpReadable extends Readable {
  static get defaultOptions() {
    return {
      root: ".",
      fileFilter: () => true,
      directoryFilter: () => true,
      entryType: "files",
      depth: Number.MAX_SAFE_INTEGER
    };
  }

  static createStreamAPI(options) {
    const stream = new ReaddirpReadable(options);
    return {
      stream: stream,
      processEntry: stream._processEntry.bind(stream),
      done: stream._done.bind(stream),
      handleError: stream._handleError.bind(stream),
      handleFatalError: stream._handleFatalError.bind(stream)
    };
  }

  constructor(receivedOptions = {}) {
    try {
      super({ ...receivedOptions, objectMode: true });
      const options = {
        ...ReaddirpReadable.defaultOptions,
        ...receivedOptions
      };
      options.fileFilter = normalizeFilter(options.fileFilter);
      options.directoryFilter = normalizeFilter(options.directoryFilter);
      this._options = options;
      this._destroyed = false;
      this._paused = false;
      this._warnings = [];
      this._errors = [];
      this._fatalError = false;
      this._readingQueue = [{ root: this._options.root, depth: 0 }];
      this._buffer = [];
      this._processing = 0;
      this._pauseResumeErrors();
    } catch (e) {
      this._handleFatalError(e);
    }
  }

  _read() {
    if (this._fatalError) {
      return;
    }
    if (this._buffer.length > 0) {
      this._popBuffer();
    }

    if (this._readingQueue.length > 0) {
      this._exploreDirectory();
    }
    this._checkEndOfReading();
  }

  stat(...args) {
    return this._options.lstat ? fs.lstat(...args) : fs.stat(...args);
  }

  destroy() {
    // when stream is destroyed it will emit nothing further, not even errors or warnings
    this._done();
    this.readable = false;
    this._destroyed = true;
    this.emit("close");
  }

  _done() {
    this.push(null);
  }

  // we emit errors and warnings async since we may handle errors like invalid args
  // within the initial event loop before any event listeners subscribed
  _handleError(err) {
    setImmediate(() => {
      if (this._paused) {
        return this._warnings.push(err);
      }
      if (!this._destroyed) {
        this.emit("warn", err);
      }
    });
  }

  _handleFatalError(err) {
    this._fatalError = true;
    setImmediate(() => {
      if (this._paused) {
        return this._errors.push(err);
      }
      if (!this._destroyed) {
        this.emit("error", err);
      }
    });
  }

  _pauseResumeErrors() {
    this.on("pause", () => {
      this._paused = true;
    });
    this.on("resume", () => {
      if (this._destroyed) {
        return;
      }
      this._paused = false;

      this._warnings.forEach(err => this.emit("warn", err));
      this._warnings.length = 0;

      this._errors.forEach(err => this.emit("error", err));
      this._errors.length = 0;
    });
  }

  _bufferOrPush(entryInformation) {
    const target = this._paused ? this._buffer : this;
    target.push(entryInformation);
  }

  _popBuffer() {
    const entryInformation = this._buffer.shift();
    this.push(entryInformation);
  }

  isFile(entryInformation) {
    const isCorrectType =
      (this._options.entryType === "all" &&
        !entryInformation.stat.isDirectory()) ||
      entryInformation.stat.isFile() ||
      entryInformation.stat.isSymbolicLink();
    return isCorrectType && this._options.fileFilter(entryInformation);
  }

  isDirectory(entryInformation) {
    return (
      entryInformation.stat.isDirectory() &&
      this._options.directoryFilter(entryInformation)
    );
  }

  isDirectoryWillBeIncluded() {
    return (
      this._options.entryType === "directories" ||
      this._options.entryType === "both" ||
      this._options.entryType === "all"
    );
  }

  isFileWillBeIncluded() {
    return (
      this._options.entryType === "files" ||
      this._options.entryType === "both" ||
      this._options.entryType === "all"
    );
  }

  _exploreDirectory() {
    if (this._paused) {
      return;
    }
    const { depth, root } = this._readingQueue.shift();
    this._processing++;
    fs.readdir(root, { encoding: "utf-8" }, (err, files) => {
      if (err) {
        this._completeReadingDirectory();
        this._handleFatalError(err);
        return;
      }
      this._prepeareToReading(root, files, depth, () => {
        this._completeReadingDirectory();
      });
    });
  }

  _completeReadingDirectory() {
    this._processing--;
    if (this._paused) {
      return;
    }

    if (this._readingQueue.length > 0) {
      this._exploreDirectory();
    }

    this._checkEndOfReading();
  }

  _checkEndOfReading() {
    if (
      !this._destroyed &&
      this._processing === 0 &&
      this._readingQueue.length === 0 &&
      this._buffer.length === 0
    ) {
      this.destroy();
    }
  }

  _prepeareToReading(currentDirectory, files, depth, done) {
    let processed = files.length;
    fs.realpath(currentDirectory, (error, directoryPath) => {
      if (this._destroyed) {
        return;
      }
      if (error) {
        done();
        this._handleError(error);
        return;
      }
      if (files.length === 0) {
        done();
        return;
      }
      const relativeDirectoryPath = path.relative(
        this._options.root,
        directoryPath
      );

      files.forEach((name, i) =>
        this._processEntry(
          name,
          directoryPath,
          relativeDirectoryPath,
          depth,
          () => {
            if (--processed === 0) {
              done();
            }
          }
        )
      );
    });
  }

  _processEntry(name, fullDirectoryPath, relativeDirectoryPath, depth, done) {
    if (this._destroyed) {
      return;
    }
    const fullEntryPath = path.join(fullDirectoryPath, name);
    const relativeEntryPath = path.join(relativeDirectoryPath, name);

    this.stat(fullEntryPath, (error, stat) => {
      if (error) {
        done();
        this._handleError(error);
        return;
      }
      const entryInformation = {
        name,
        stat,
        path: relativeEntryPath,
        fullPath: fullEntryPath,
        parentDir: relativeDirectoryPath,
        fullParentDir: fullDirectoryPath
      };
      this._decideToPushEntry(entryInformation, depth);
      done();
    });
  }

  _decideToPushEntry(entryInformation, depth) {
    const isSubDirectory = this.isDirectory(entryInformation);

    const isPickedDirectory =
      isSubDirectory && this.isDirectoryWillBeIncluded();

    const isPickedFile =
      this.isFile(entryInformation) && this.isFileWillBeIncluded();

    if (!isSubDirectory && !isPickedDirectory && !isPickedFile) {
      return;
    }

    if (isPickedDirectory || isPickedFile) {
      this._bufferOrPush(entryInformation);
    }

    if (isSubDirectory) {
      // Needed for including directories inside result object even if they must not be inlcuded
      // inside read stream
      this.emit("__directory", entryInformation);

      const newDepth = depth + 1;
      if (this._options.depth >= newDepth) {
        this._readingQueue.push({
          root: entryInformation.fullPath,
          depth: newDepth
        });
      }
    }
  }
}

module.exports = ReaddirpReadable;
