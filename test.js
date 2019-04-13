const fs = require('fs');
const sysPath = require('path');
const chai = require('chai');
const {Readable} = require('stream');
chai.should();
const {promisify} = require('util');
const rimraf = require('rimraf');

const readdirp = require('.');

const root = sysPath.join(__dirname, 'test-fixtures');
let testCount = 0;
let currPath;

const read = async (options) => {
  return await readdirp.promise(currPath, options);
};

const touch = async (files=[], dirs=[]) => {
  for (const name of files) {
    await promisify(fs.writeFile)(sysPath.join(currPath, name), `${Date.now()}`);
  }
  for (const dir of dirs) {
    await promisify(fs.mkdir)(sysPath.join(currPath, dir));
  }
}

beforeEach(async () => {
  testCount++;
  currPath = sysPath.join(root, testCount.toString())
  await promisify(rimraf)(currPath);
  await promisify(fs.mkdir)(currPath);
});

afterEach(async () => {
  await promisify(rimraf)(currPath);
});

before(async () => {
  await promisify(rimraf)(root);
  await promisify(fs.mkdir)(root);
});
after(async () => {
  await promisify(rimraf)(root);
})

describe('basic', () => {
  it('reads directory', async () => {
    const files = ['a.txt', 'b.txt', 'c.txt'];
    await touch(files);
    const res = await read();
    res.should.have.lengthOf(files.length);
  });
});

describe('type', () => {
  const files = ['a.txt', 'b.txt', 'c.txt'];
  const dirs = ['d', 'e', 'f', 'g'];

  it('files', async () => {
    await touch(files, dirs);
    const res = await read({type: 'files'});
    res.should.have.lengthOf(files.length);
    res.map(e => e.basename).should.deep.equal(files);
  });

  it('directories', async () => {
    await touch(files, dirs);
    const res = await read({type: 'directories'});
    res.should.have.lengthOf(dirs.length);
    res.map(e => e.basename).should.deep.equal(dirs);
  });

  it('both', async () => {
    await touch(files, dirs);
    const res = await read({type: 'both'});
    res.should.have.lengthOf(files.length + dirs.length);
    res.map(e => e.basename).should.deep.equal(files.concat(dirs));
  });

  it('all', async () => {
    await touch(files, dirs);
    const res = await read({type: 'all'});
    res.should.have.lengthOf(files.length + dirs.length);
    res.map(e => e.basename).should.deep.equal(files.concat(dirs));
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
  const depth1Names = ['d.js', 'e.js'];
  const deepSubdirs = ['subdir/s1', 'subdir/s2', 'deep/d1', 'deep/d2'];
  const depth2 = ['subdir/s1/f.js', 'deep/d1/h.js'];
  const depth2Names = ['f.js', 'h.js'];
  const allNames = depth0.concat(depth1Names, depth2Names);

  beforeEach(async () => {
    await touch(depth0, subdirs);
    await touch(depth1, deepSubdirs);
    await touch(depth2);
  });

  it('0', async () => {
    const res = await read({depth: 0});
    res.map(e => e.basename).should.deep.equal(depth0);
  });

  it('1', async () => {
    const res = await read({depth: 1});
    res.map(e => e.basename).should.deep.equal(depth0.concat(depth1Names));
  });

  it('2', async () => {
    const res = await read({depth: 2});
    res.map(e => e.basename).sort().should.deep.equal(allNames);
  });

  it('default', async () => {
    const res = await read();
    res.map(e => e.basename).sort().should.deep.equal(allNames);
  });
});

describe('EntryInfo', () => {

});

describe('filtering', () => {
  beforeEach(async () => {
    await touch(['a.js', 'b.txt', 'c.js', 'd.js']);
  });
  it('glob', async () => {
    const res = await read({fileFilter: '*.js'});
    res.map(e => e.basename).should.deep.equal(['a.js', 'c.js', 'd.js']);

    const res2 = await read({fileFilter: ['*.js']});
    res2.map(e => e.basename).should.deep.equal(['a.js', 'c.js', 'd.js']);

    const res3 = await read({fileFilter: ['*.txt']});
    res3.map(e => e.basename).should.deep.equal(['b.txt']);
  });
  it('negated glob', async () => {
    const res = await read({fileFilter: ['!d.js']});
    res.map(e => e.basename).should.deep.equal(['a.js', 'b.txt', 'c.js']);
  });
  it('glob & negated glob', async () => {
    const res = await read({fileFilter: ['*.js', '!d.js']});
    res.map(e => e.basename).should.deep.equal(['a.js', 'c.js']);
  });
  it('function', async () => {
    const res = await read({fileFilter: (entry) => sysPath.extname(entry.fullPath) === '.js'});
    res.map(e => e.basename).should.deep.equal(['a.js', 'c.js', 'd.js']);

    const res2 = await read({fileFilter: (entry) => entry.stats.size > 0 });
    res2.map(e => e.basename).should.deep.equal(['a.js', 'b.txt', 'c.js', 'd.js']);
  });
});

describe('various', () => {
  it('emits readable stream', () => {
    readdirp(currPath).should.be.an.instanceof(Readable);
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
    try {
      readdirp('.', {entryType: 'file'});
    } catch (error) {
      error.should.be.an.instanceof(Error);
    }
  });

  it('exposes promise API', async () => {
    const created = ['a.txt', 'c.txt'];
    await touch(created);
    const result = await readdirp.promise(currPath);
    result.map(e => e.basename).should.deep.equal(created);
  });
});
