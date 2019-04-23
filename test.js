const fs = require('fs');
const sysPath = require('path');
const chai = require('chai');
const chaiSubset = require('chai-subset');
const {Readable} = require('stream');
chai.use(chaiSubset);
chai.should();
const {promisify} = require('util');
const rimraf = promisify(require('rimraf'));
const mkdir = promisify(fs.mkdir);
const symlink = promisify(fs.symlink);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const supportsDirent = 'Dirent' in fs;

const readdirp = require('.');

const root = sysPath.join(__dirname, 'test-fixtures');
let testCount = 0;
let currPath;

const read = async (options) => {
  return await readdirp.promise(currPath, options);
};

const touch = async (files=[], dirs=[]) => {
  for (const name of files) {
    await writeFile(sysPath.join(currPath, name), `${Date.now()}`);
  }
  for (const dir of dirs) {
    await mkdir(sysPath.join(currPath, dir));
  }
}

const convertPath = path => process.platform === "win32" ? path.replace(/\//gi, "\\") : path;

const formatEntry = (file, dir = root) => {
  const basename = sysPath.basename(file);
  return {
    basename,
    path: convertPath(file),
    fullPath: convertPath(sysPath.join(dir, file)),
  };
};

beforeEach(async () => {
  testCount++;
  currPath = sysPath.join(root, testCount.toString())
  await rimraf(currPath);
  await mkdir(currPath);
});

afterEach(async () => {
  await rimraf(currPath);
});

before(async () => {
  await rimraf(root);
  await mkdir(root);
});
after(async () => {
  await rimraf(root);
})

describe('basic', () => {
  it('reads directory', async () => {
    const files = ['a.txt', 'b.txt', 'c.txt'];
    await touch(files);
    const res = await read();
    res.should.have.lengthOf(files.length);
    res.forEach((entry, index) => 
      entry.should.containSubset(formatEntry(files[index], currPath))
    );
  });

  it('handles symlinks', async () => {
    const newPath = sysPath.join(currPath, 'test-symlinked.js');
    await symlink(sysPath.join(__dirname, 'test.js'), newPath);
    const res = await read();
    const first = res[0];
    first.should.containSubset(formatEntry('test-symlinked.js', currPath));
    const contents = await readFile(first.fullPath);
    contents.should.match(/handles symlinks/); // name of this test
  });
  it('should use lstat instead stat', async () => {
    const files = ['a.txt', 'b.txt', 'c.txt'];
    const symlinkName = 'test-symlinked.js';
    const newPath = sysPath.join(currPath, symlinkName);
    await symlink(sysPath.join(__dirname, 'test.js'), newPath);
    await touch(files);
    const expect = [...files, symlinkName];
    const res = await read({lstat: true, alwaysStat: true});
    res.should.have.lengthOf(expect.length);
    res.forEach((entry, index) => {
      entry.should.containSubset(formatEntry(expect[index], currPath, false))
      entry.should.include.own.key("stats");
      if (entry.basename === symlinkName) {
        entry.stats.isSymbolicLink().should.equals(true);
      }
    });
  });
});

describe('type', () => {
  const files = ['a.txt', 'b.txt', 'c.txt'];
  const dirs = ['d', 'e', 'f', 'g'];

  it('files', async () => {
    await touch(files, dirs);
    const res = await read({type: 'files'});
    res.should.have.lengthOf(files.length);
    res.forEach((entry, index) => 
      entry.should.containSubset(formatEntry(files[index], currPath))
    );
  });

  it('directories', async () => {
    await touch(files, dirs);
    const res = await read({type: 'directories'});
    res.should.have.lengthOf(dirs.length);
    res.map((entry, index) => 
      entry.should.containSubset(formatEntry(dirs[index], currPath))
    );
  });

  it('both', async () => {
    await touch(files, dirs);
    const res = await read({type: 'both'});
    const both = files.concat(dirs);
    res.should.have.lengthOf(both.length);
    res.map((entry, index) => 
      entry.should.containSubset(formatEntry(both[index], currPath))
    );
  });

  it('all', async () => {
    await touch(files, dirs);
    const res = await read({type: 'all'});
    const all = files.concat(dirs);
    res.should.have.lengthOf(all.length);
    res.map((entry, index) => 
      entry.should.containSubset(formatEntry(all[index], currPath))
    );
  });

  it('invalid', async () => {
    try {
      await read({type: 'bogus'})
    } catch (error) {
      error.message.should.match(/Invalid type/);
    }
  })
});

describe('depth', () => {
  const depth0 = ['a.js', 'b.js', 'c.js'];
  const subdirs = ['subdir', 'deep'];
  const depth1 = ['subdir/d.js', 'deep/e.js'];
  const deepSubdirs = ['subdir/s1', 'subdir/s2', 'deep/d1', 'deep/d2'];
  const depth2 = ['subdir/s1/f.js', 'deep/d1/h.js'];

  beforeEach(async () => {
    await touch(depth0, subdirs);
    await touch(depth1, deepSubdirs);
    await touch(depth2);
  });

  it('0', async () => {
    const res = await read({depth: 0});
    res.should.have.lengthOf(depth0.length);
    res.map((entry, index) => 
      entry.should.containSubset(formatEntry(depth0[index], currPath))
    );
  });

  it('1', async () => {
    const res = await read({depth: 1});
    const expect = [...depth0, ...depth1];
    res.should.have.lengthOf(expect.length);
    res
      .sort((a, b) => a.basename > b.basename ? 1 : -1)
      .map((entry, index) => 
        entry.should.containSubset(formatEntry(expect[index], currPath))
      );
  });

  it('2', async () => {
    const res = await read({depth: 2});
    const expect = [...depth0, ...depth1, ...depth2];
    res.should.have.lengthOf(expect.length);
    res
      .sort((a, b) => a.basename > b.basename ? 1 : -1)
      .map((entry, index) => 
        entry.should.containSubset(formatEntry(expect[index], currPath))
      );
  });

  it('default', async () => {
    const res = await read();
    const expect = [...depth0, ...depth1, ...depth2];
    res.should.have.lengthOf(expect.length);
    res
      .sort((a, b) => a.basename > b.basename ? 1 : -1)
      .map((entry, index) => 
        entry.should.containSubset(formatEntry(expect[index], currPath))
      );
  });
});

describe('filtering', () => {
  beforeEach(async () => {
    await touch(['a.js', 'b.txt', 'c.js', 'd.js', 'e.rb']);
  });
  it('glob', async () => {
    const expect1 = ['a.js', 'c.js', 'd.js'];
    const res = await read({fileFilter: '*.js'});
    res.should.have.lengthOf(expect1.length);
    res.map((entry, index) => 
      entry.should.containSubset(formatEntry(expect1[index], currPath))
    );

    const res2 = await read({fileFilter: ['*.js']});
    res2.should.have.lengthOf(expect1.length);
    res2.map((entry, index) => 
      entry.should.containSubset(formatEntry(expect1[index], currPath))
    );

    const expect2 = ['b.txt'];
    const res3 = await read({fileFilter: ['*.txt']});
    res3.should.have.lengthOf(expect2.length);
    res3.map((entry, index) => 
      entry.should.containSubset(formatEntry(expect2[index], currPath))
    );
  });
  it('leading and trailing spaces', async () => {
    const expect = ['a.js', 'c.js', 'd.js', 'e.rb'];
    const res = await read({fileFilter: [' *.js', '*.rb ']});
    res.should.have.lengthOf(expect.length);
    res.map((entry, index) => 
      entry.should.containSubset(formatEntry(expect[index], currPath))
    );
  });
  it('multiple glob', async () => {
    const expect = ['a.js', 'b.txt', 'c.js', 'd.js'];
    const res = await read({fileFilter: ['*.js', '*.txt']});
    res.should.have.lengthOf(expect.length);
    res.map((entry, index) => 
      entry.should.containSubset(formatEntry(expect[index], currPath))
    );
  });
  it('negated glob', async () => {
    const expect = ['a.js', 'b.txt', 'c.js', 'e.rb'];
    const res = await read({fileFilter: ['!d.js']});
    res.should.have.lengthOf(expect.length);
    res.map((entry, index) => 
      entry.should.containSubset(formatEntry(expect[index], currPath))
    );
  });
  it('glob & negated glob', async () => {
    const expect = ['a.js', 'c.js'];
    const res = await read({fileFilter: ['*.js', '!d.js']});
    res.should.have.lengthOf(expect.length);
    res.map((entry, index) => 
      entry.should.containSubset(formatEntry(expect[index], currPath))
    );
  });
  it('function', async () => {
    const expect = ['a.js', 'c.js', 'd.js'];
    const res = await read({fileFilter: (entry) => sysPath.extname(entry.fullPath) === '.js'});
    res.should.have.lengthOf(expect.length);
    res.map((entry, index) => 
      entry.should.containSubset(formatEntry(expect[index], currPath))
    );

    if (supportsDirent) {
      const expect2 = ['a.js', 'b.txt', 'c.js', 'd.js', 'e.rb'];
      const res2 = await read({fileFilter: (entry) => entry.dirent.isFile() });
      res2.should.have.lengthOf(expect2.length);
      res2.map((entry, index) => 
        entry.should.containSubset(formatEntry(expect2[index], currPath))
      );
    }
  });
  it('function with stats', async () => {
    const expect = ['a.js', 'c.js', 'd.js'];
    const res = await read({alwaysStat: true, fileFilter: (entry) => sysPath.extname(entry.fullPath) === '.js'});
    res.should.have.lengthOf(expect.length);
    res.map((entry, index) => {
      entry.should.containSubset(formatEntry(expect[index], currPath))
      entry.should.include.own.key("stats");
    });

    const expect2 = ['a.js', 'b.txt', 'c.js', 'd.js', 'e.rb'];
    const res2 = await read({alwaysStat: true, fileFilter: (entry) => entry.stats.size > 0 });
    res2.should.have.lengthOf(expect2.length);
    res2.map((entry, index) => {
      entry.should.containSubset(formatEntry(expect2[index], currPath))
      entry.should.include.own.key("stats");
    });
  });
});

describe('various', () => {
  it('emits readable stream', () => {
    const stream = readdirp(currPath);
    stream.should.be.an.instanceof(Readable);
    stream.should.be.an.instanceof(readdirp.ReaddirpStream);
  });

  it('fails without root option passed', async () => {
    try {
      readdirp();
    } catch (error) {
      error.should.be.an.instanceof(Error);
    }
  });

  it('disallows old API', () => {
    try {
      readdirp({root: '.'});
    } catch (error) {
      error.should.be.an.instanceof(Error);
    }
  });

  it('exposes promise API', async () => {
    const created = ['a.txt', 'c.txt'];
    await touch(created);
    const result = await readdirp.promise(currPath);
    result.should.have.lengthOf(created.length);
    result.map((entry, index) => 
      entry.should.containSubset(formatEntry(created[index], currPath))
    );
  });
  it('should emit warning for missing file', function(done) {
    this.timeout(4000);
    const unlinkedDir = sysPath.join(currPath, 'unlinked');
    fs.mkdirSync(unlinkedDir);
    let timer;
    let isUnlinked = false;
    let isWarningCalled = false;
    const stream = readdirp(currPath, { type: 'all' });
    stream.pause();
    stream
      .on('readable', async function() {
        if (!isUnlinked) {
          await rimraf(unlinkedDir);
          this.resume();
        }
      })
      .on('warn', warning => {
        warning.should.be.an.instanceof(Error);
        warning.code.should.equals('ENOENT');
        isWarningCalled = true;
        clearTimeout(timer);
        done();
      });
    timer = setTimeout(() => {
      isWarningCalled.should.equals(true);
      done();
    }, 3000);
  });
  it('should emit warning for file with strict permission', function(done) {
    this.timeout(4000);
    const permitedDir = sysPath.join(currPath, 'permited');
    fs.mkdirSync(permitedDir, 000);
    let isWarningCalled = false;
    let timer;
    const stream = readdirp(currPath, { type: 'all' })
      .on('data', () => {})
      .on('warn', warning => {
        warning.should.be.an.instanceof(Error);
        warning.code.should.equals('EACCES');
        isWarningCalled = true;
        clearTimeout(timer);
        done();
      });
    timer = setTimeout(() => {
      isWarningCalled.should.equals(true);
      done();
    }, 3000);
  });
  it('should not emit warning after "end" event', function(done) {
    this.timeout(4000);
    const subdir = sysPath.join(currPath, 'subdir');
    const permitedDir = sysPath.join(subdir, 'permited');
    fs.mkdirSync(subdir);
    fs.mkdirSync(permitedDir, 000);
    let isWarningCalled = false;
    let isEnded = false;
    let timer;
    const stream = readdirp(currPath, { type: 'all' })
      .on('data', () => {})
      .on('warn', warning => {
        warning.should.be.an.instanceof(Error);
        warning.code.should.equals('EACCES');
        isEnded.should.equals(false);
        isWarningCalled = true;
        clearTimeout(timer);
      })
      .on('end', () => {
        isWarningCalled.should.equals(true);
        isEnded = true;
        done();
      });
    timer = setTimeout(() => {
      isWarningCalled.should.equals(true);
      isEnded.should.equals(true);
      done();
    }, 3000);
  });
});
