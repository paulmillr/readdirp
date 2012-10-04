var readdirp =  require('..')
  , path     =  require('path')
  , tap      =  require('tap-stream')
  , util     =  require('util');

readdirp({ root: path.join(__dirname + '/../test/bed'), fileFilter: '*'})
  .pipe(tap(0));



