var Stream = require('stream')
  , source
  , target;


source = new Stream();
source.readable = true;
source.writable = false;
source.paused = true;
source.buffer = [];

source.resume = function () {
  source.paused = false;
  while (source.buffer.length && !source.paused) {
    var msg = source.buffer.shift();
    source.emit(msg.type, msg.content);
  }
};

source.pause = function () {
  source.paused = true;
};

source.on('error', function (err) {
  console.log('source.error', err);
});

target = new Stream();
target.readable = true;
target.writable = true;

target.write = function (data) {
  console.log('target.data', data);
  return data !== 'hello';
};

target.on('error', function (err) {
  console.log('target.error', err);
});

function sendData (data) {
  if (!source.paused) 
    source.emit('data', data);
  else 
    source.buffer.push({ type: 'data', content: data });
}

function sendError (err) {
  if (!source.paused) 
    source.emit('error', err);
  else 
    source.buffer.push({ type: 'error', content: err });
}

source
  .pipe(target);

sendData ('hello');
sendData ('world');
sendError (new Error('oh no!'));

source.resume();


setTimeout(function () { target.emit('drain'); }, 1000);
