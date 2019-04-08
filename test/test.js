const sysPath = require('path');
const chai = require('chai');
chai.should();
const {promisify} = require('util');
const rimraf = require('rimraf');

const root = sysPath.join(__dirname, "fixtures");
const readdirp = require('..');

const fs = require('fs').promises;
let testCount = 0;
let currPath;

const read = async (options) => {
  const entries = [];
  for await (const entry of readdirp(currPath, options)) {
    // console.log('test#entry', entry.path);
    entries.push(entry);
  }
  return entries;
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
});
