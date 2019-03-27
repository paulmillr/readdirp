"use strict";

const util = require("util");
const { Readable } = require("stream");

class ReaddirpReadable extends Readable {

  constructor(options = {}) {
    super({ ...options, objectMode: true });

    this._destroyed = false;
    this._paused = false;
    this._warnings = [];
    this._errors = [];
    this.highWaterMark = Infinity;

    this._pauseResumeErrors();
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

  _processEntry(entry) {
    if (this._destroyed) {
      return;
    }
    this.push(entry);
  }

  _read() {}

  destroy() {
    // when stream is destroyed it will emit nothing further, not even errors or warnings
    this.push(null);
    this.readable = false;
    this._destroyed = true;
    this.emit("close");
  }
}

function createStreamAPI() {
  const stream = new ReaddirpReadable();

  return {
    stream: stream,
    processEntry: stream._processEntry.bind(stream),
    done: stream._done.bind(stream),
    handleError: stream._handleError.bind(stream),
    handleFatalError: stream._handleFatalError.bind(stream)
  };
}

module.exports = createStreamAPI;
