const sysPath = require('path');
const chai = require('chai');
const {Readable} = require('stream');
chai.should();
const {promisify} = require('util');
const rimraf = require('rimraf');

const root = sysPath.join(__dirname, "fixtures");
const readdirp = require('..');

const fs = require('fs').promises;
let testCount = 0;
let currPath;

const read = async (options) => {
  return await readdirp.promise(currPath, options);
};

const touch = async (files=[], dirs=[]) => {
  for (const name of files) {
    await fs.writeFile(sysPath.join(currPath, name), `${Date.now()}`);
  }
  for (const dir of dirs) {
    await fs.mkdir(sysPath.join(currPath, dir));
  }
}

beforeEach(async () => {
  testCount++;
  currPath = sysPath.join(__dirname, 'fixtures', testCount.toString())
  await promisify(rimraf)(currPath);
  await fs.mkdir(currPath);
});

afterEach(async () => {
  await promisify(rimraf)(currPath);
});

describe('basic', () => {
  it('reads directory', async () => {
    const files = ['a.txt', 'b.txt', 'c.txt'];
    await touch(files);
    const res = await read();
    res.should.have.lengthOf(files.length);
  });
});

describe('entryType', () => {
  const files = ['a.txt', 'b.txt', 'c.txt'];
  const dirs = ['d', 'e', 'f', 'g'];

  it('files', async () => {
    await touch(files, dirs);
    const res = await read({entryType: 'files'});
    res.should.have.lengthOf(files.length);
    res.map(e => e.basename).should.deep.equal(files);
  });

  it('directories', async () => {
    await touch(files, dirs);
    const res = await read({entryType: 'directories'});
    res.should.have.lengthOf(dirs.length);
    res.map(e => e.basename).should.deep.equal(dirs);
  });

  it('both', async () => {
    await touch(files, dirs);
    const res = await read({entryType: 'both'});
    res.should.have.lengthOf(files.length + dirs.length);
    res.map(e => e.basename).should.deep.equal(files.concat(dirs));
  });

  it('all', async () => {
    await touch(files, dirs);
    const res = await read({entryType: 'all'});
    res.should.have.lengthOf(files.length + dirs.length);
    res.map(e => e.basename).should.deep.equal(files.concat(dirs));
  });

  // entryType: "directories",
  // directoryFilter: ["root_dir1", "*dir1_subdir1"]

  // entryType: "both",
  // directoryFilter: ["root_dir1", "*dir1_subdir1"],
  // fileFilter: ["!*.ext1"]

  // fileFilter: ["!*.ext1", "!*.ext3"]
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
  ["*.ext1", "*.ext3"]
  it('glob', async () => {});
  it('negated glob', async () => {});
  it('glob & negated glob', async () => {});
  it('function', async () => {});

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
  });

  it('exposes promise API', async () => {
    const created = ['a.txt', 'c.txt'];
    await touch(created);
    const result = await readdirp.promise(currPath);
    result.map(e => e.basename).should.deep.equal(created);
  });
});
