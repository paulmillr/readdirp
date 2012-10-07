var Stream = require('stream');

function createStreamAPI () {
  var stream
    , callback1
    , callback2
    , handleFatalError
    , paused = true
    , buffer = []
    ;

  stream = new Stream();
  stream.writable = false;
  stream.readable = true;

  stream.pause = function () {
    paused = true;
  };

  stream.resume = function () {
    paused = false;
    
    // emit all buffered entries, errors and ends
    while (!paused && buffer.length) {
      var msg = buffer.shift();
      this.emit(msg.type, msg.data);
    }
  };

  // called for each entry
  callback1 = function (entry) {
    return paused ? buffer.push({ type: 'data', data: entry }) : stream.emit('data', entry);
  };

  // called with all found entries when directory walk finished
  callback2 = function (err, entries) {
    // since  we already emitted each entry,
    // all we need to do here is to signal that we are done

    // unless there were non-fatal errors, which we should let the user know about at least now
    // TODO: figure out how to handle non fatal errors for streams

    stream.emit('end');
  };

  handleFatalError = function (err) {
    return paused ? buffer.push({ type: 'error', data: err }) : stream.emit('error', err);
  };

  // Allow stream to be returned and handlers to be attached and/or stream to be piped before emitting messages
  // Otherwise we may loose data/errors that are emitted immediately
  process.nextTick(function () { stream.resume(); });

  return { stream: stream, callback1: callback1, callback2: callback2, handleFatalError: handleFatalError };
}

module.exports = createStreamAPI;
