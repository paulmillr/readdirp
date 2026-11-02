import { describe, it } from '@paulmillr/jsbt/test.js';
import chai from 'chai';
import chaiSubset from 'chai-subset';
import { chmod, mkdir, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import sysPath from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readdirp, readdirpPromise, ReaddirpStream } from '../index.js';

chai.use(chaiSubset);
chai.should();

const __dirname = sysPath.dirname(fileURLToPath(import.meta.url));

const supportsDirent = true;
const isWindows = process.platform === 'win32';
const root = sysPath.join(tmpdir(), 'readdirp-' + Date.now());

let testCount = 0;
let currPath;

const read = (options) =>
  readdirpPromise(currPath, options).then((res) =>
    res.sort((a, b) => a.path.localeCompare(b.path))
  );

const touch = async (files = [], dirs = []) => {
  for (const name of files) {
    const p = sysPath.join(currPath, name);
    await writeFile(p, Date.now().toString());
  }
  for (const dir of dirs) {
    await mkdir(sysPath.join(currPath, dir));
  }
};

const formatEntry = (file, dir = root) => {
  return {
    basename: sysPath.basename(file),
    path: sysPath.normalize(file),
    fullPath: sysPath.join(dir, file),
  };
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForEnd = (stream) => new Promise((resolve) => stream.on('end', resolve));

async function beforeEach() {
  testCount++;
  const i = testCount.toString();
  currPath = sysPath.join(root, i);
  try {
    await rm(currPath, { recursive: true });
  } catch (e) {}
  await mkdir(currPath, { recursive: true });
  return true;
}

let afterEach = async () => {
  // await pRimraf(currPath);
  await rm(currPath, { recursive: true });
};

describe('readdirp', () => {
  describe('basic', () => {
    it('reads directory', async () => {
      await beforeEach();
      const files = ['a.txt', 'b.txt', 'c.txt'];
      await touch(files);
      const res = await read();
      res.should.have.lengthOf(files.length);
      res.forEach((entry, index) => {
        entry.should.containSubset(formatEntry(files[index], currPath));
      });
      await afterEach();
    });
  });

  describe('symlinks', () => {
    if (isWindows) return;

    it('handles symlinks', async () => {
      await beforeEach();
      const newPath = sysPath.join(currPath, 'test-symlinked.js');
      await symlink(sysPath.join(__dirname, 'index.test.js'), newPath);
      const res = await read();
      const first = res[0];
      first.should.containSubset(formatEntry('test-symlinked.js', currPath));
      const contents = await readFile(first.fullPath);
      contents.should.match(/handles symlinks/); // name of this test
    });

    it('handles symlinked directories', async () => {
      await beforeEach();
      const originalPath = sysPath.join(__dirname, '..', 'test');
      const originalFiles = await readdir(originalPath);
      const newPath = sysPath.join(currPath, 'test2');
      await symlink(originalPath, newPath);
      const res = await read();
      const symlinkedFiles = res.map((entry) => entry.basename);
      symlinkedFiles.should.eql(originalFiles.sort((a, b) => a.localeCompare(b)));
    });

    it('should use lstat instead of stat', async () => {
      await beforeEach();
      const files = ['a.txt', 'b.txt', 'c.txt'];
      const symlinkName = 'test-symlinked.js';
      const newPath = sysPath.join(currPath, symlinkName);
      await symlink(sysPath.join(__dirname, 'index.test.js'), newPath);
      await touch(files);
      const expect = [...files, symlinkName];
      const res = await read({ lstat: true, alwaysStat: true });
      res.should.have.lengthOf(expect.length);
      res.forEach((entry, index) => {
        entry.should.containSubset(formatEntry(expect[index], currPath, false));
        entry.should.include.own.key('stats');
        if (entry.basename === symlinkName) {
          entry.stats.isSymbolicLink().should.equals(true);
        }
      });
    });
  });

  describe('canonical symlink ancestry', () => {
    for (const [mode, options] of [
      ['dirent', {}],
      ['stat', { alwaysStat: true }],
      ['lstat', { alwaysStat: true, lstat: true }],
    ]) {
      for (const topology of [
        'direct root',
        'aliased root',
        'case-variant root',
        'filesystem root',
        'external self-loop',
        'external two-directory loop',
        'returning to the initial root',
        'returning to the aliased initial root',
        'returning to a nested external parent',
        'shared non-cyclic target',
      ]) {
        if (topology === 'case-variant root' && !isWindows) continue;
        it(`handles ${topology} with ${mode}`, async () => {
          await beforeEach();
          const links = [];
          const makeLink = async (target, name) => {
            const link = sysPath.join(currPath, name);
            await symlink(target, link, isWindows ? 'junction' : 'dir');
            links.push(link);
          };
          let scanRoot = currPath;
          let depth = 4;
          let expected;
          let expectedWarnings = 1;
          try {
            await touch([], ['scan', 'target', 'other']);
            await touch(['target/leaf.txt', 'other/other.txt']);
            const target = sysPath.join(currPath, 'target');
            if (
              topology === 'direct root' ||
              topology === 'aliased root' ||
              topology === 'case-variant root'
            ) {
              await makeLink(target, 'target/loop');
              if (topology === 'aliased root') {
                await makeLink(target, 'alias');
                scanRoot = sysPath.join(currPath, 'alias');
              } else if (topology === 'case-variant root') {
                scanRoot = target.toLowerCase();
              } else {
                scanRoot = target;
              }
              expected = ['leaf.txt'];
            } else if (topology === 'filesystem root') {
              scanRoot = sysPath.join(currPath, 'scan');
              await makeLink(sysPath.parse(currPath).root, 'scan/root');
              depth = 0;
              expected = [];
            } else if (
              topology === 'returning to the initial root' ||
              topology === 'returning to the aliased initial root'
            ) {
              scanRoot = sysPath.join(currPath, 'scan');
              await touch(['scan/root.txt']);
              await makeLink(target, 'scan/outside');
              await makeLink(scanRoot, 'target/back');
              if (topology === 'returning to the aliased initial root') {
                await makeLink(scanRoot, 'alias');
                scanRoot = sysPath.join(currPath, 'alias');
              }
              expected = ['root.txt', 'outside/leaf.txt'];
            } else {
              scanRoot = sysPath.join(currPath, 'scan');
              await makeLink(target, 'scan/entry');
              if (topology === 'external self-loop') {
                await makeLink(target, 'target/loop');
                expected = ['entry/leaf.txt'];
              } else if (topology === 'external two-directory loop') {
                await makeLink(sysPath.join(currPath, 'other'), 'target/to-other');
                await makeLink(target, 'other/to-target');
                expected = ['entry/leaf.txt', 'entry/to-other/other.txt'];
              } else if (topology === 'returning to a nested external parent') {
                await touch([], ['target/nested']);
                await touch(['target/nested/node.txt']);
                await makeLink(sysPath.join(currPath, 'other'), 'target/nested/outside');
                await makeLink(sysPath.join(target, 'nested'), 'other/back');
                expected = [
                  'entry/leaf.txt',
                  'entry/nested/node.txt',
                  'entry/nested/outside/other.txt',
                ];
              } else {
                await makeLink(target, 'scan/second');
                expected = ['entry/leaf.txt', 'second/leaf.txt'];
                expectedWarnings = 0;
              }
            }
            const warnings = [];
            const paths = [];
            const stream = readdirp(scanRoot, { ...options, depth });
            stream.on('warn', (error) => warnings.push(error.code));
            for await (const entry of stream) paths.push(entry.path);
            paths.sort().should.eql(expected.map((path) => sysPath.normalize(path)).sort());
            warnings.should.eql(Array(expectedWarnings).fill('READDIRP_RECURSIVE_ERROR'));
          } finally {
            for (const link of links.reverse()) await unlink(link);
            await afterEach();
          }
        });
      }
    }
  });

  describe('type', () => {
    const files = ['a.txt', 'b.txt', 'c.txt'];
    const dirs = ['d', 'e', 'f', 'g'];

    it('files', async () => {
      await beforeEach();
      await touch(files, dirs);
      const res = await read({ type: 'files' });
      res.should.have.lengthOf(files.length);
      res.forEach((entry, index) =>
        entry.should.containSubset(formatEntry(files[index], currPath))
      );
    });

    it('directories', async () => {
      await beforeEach();
      await touch(files, dirs);
      const res = await read({ type: 'directories' });
      res.should.have.lengthOf(dirs.length);
      res.forEach((entry, index) => entry.should.containSubset(formatEntry(dirs[index], currPath)));
    });

    it('both', async () => {
      await beforeEach();
      await touch(files, dirs);
      const res = await read({ type: 'both' });
      const both = files.concat(dirs);
      res.should.have.lengthOf(both.length);
      res.forEach((entry, index) => entry.should.containSubset(formatEntry(both[index], currPath)));
    });

    it('all', async () => {
      await beforeEach();
      await touch(files, dirs);
      const res = await read({ type: 'all' });
      const all = files.concat(dirs);
      res.should.have.lengthOf(all.length);
      res.forEach((entry, index) => entry.should.containSubset(formatEntry(all[index], currPath)));
    });

    it('invalid', async () => {
      await beforeEach();
      try {
        await read({ type: 'bogus' });
      } catch (error) {
        error.message.should.match(/Invalid type/);
      }
    });
  });

  describe('depth', () => {
    const depth0 = ['a.js', 'b.js', 'c.js'];
    const subdirs = ['subdir', 'deep'];
    const depth1 = ['subdir/d.js', 'deep/e.js'];
    const deepSubdirs = ['subdir/s1', 'subdir/s2', 'deep/d1', 'deep/d2'];
    const depth2 = ['subdir/s1/f.js', 'deep/d1/h.js'];

    async function cleanupDepth() {
      await touch(depth0, subdirs);
      await touch(depth1, deepSubdirs);
      await touch(depth2);
    }

    it('0', async () => {
      await beforeEach();
      await cleanupDepth();
      const res = await read({ depth: 0 });
      res.should.have.lengthOf(depth0.length);
      res.forEach((entry, index) =>
        entry.should.containSubset(formatEntry(depth0[index], currPath))
      );
    });

    it('1', async () => {
      await beforeEach();
      await cleanupDepth();
      const res = await read({ depth: 1 });
      const expect = [...depth0, ...depth1];
      res.should.have.lengthOf(expect.length);
      res
        .sort((a, b) => (a.basename > b.basename ? 1 : -1))
        .forEach((entry, index) =>
          entry.should.containSubset(formatEntry(expect[index], currPath))
        );
    });

    it('2', async () => {
      await beforeEach();
      await cleanupDepth();
      const res = await read({ depth: 2 });
      const expect = [...depth0, ...depth1, ...depth2];
      res.should.have.lengthOf(expect.length);
      res
        .sort((a, b) => (a.basename > b.basename ? 1 : -1))
        .forEach((entry, index) =>
          entry.should.containSubset(formatEntry(expect[index], currPath))
        );
    });

    it('default', async () => {
      await beforeEach();
      await cleanupDepth();
      const res = await read();
      const expect = [...depth0, ...depth1, ...depth2];
      res.should.have.lengthOf(expect.length);
      res
        .sort((a, b) => (a.basename > b.basename ? 1 : -1))
        .forEach((entry, index) =>
          entry.should.containSubset(formatEntry(expect[index], currPath))
        );
    });
  });

  describe('filtering', () => {
    async function cleanupFilter() {
      await beforeEach();
      await touch(['a.js', 'b.txt', 'c.js', 'd.js', 'e.rb']);
    }
    it('leading and trailing spaces', async () => {
      await cleanupFilter();
      const expect = ['a.js', 'c.js', 'd.js', 'e.rb'];
      const res = await read({
        fileFilter: (a) => a.basename.endsWith('.js') || a.basename.endsWith('.rb'),
      });
      res.should.have.lengthOf(expect.length);
      res.forEach((entry, index) =>
        entry.should.containSubset(formatEntry(expect[index], currPath))
      );
    });
    it('function', async () => {
      await cleanupFilter();
      const expect = ['a.js', 'c.js', 'd.js'];
      const res = await read({ fileFilter: (entry) => sysPath.extname(entry.fullPath) === '.js' });
      res.should.have.lengthOf(expect.length);
      res.forEach((entry, index) =>
        entry.should.containSubset(formatEntry(expect[index], currPath))
      );

      if (supportsDirent) {
        const expect2 = ['a.js', 'b.txt', 'c.js', 'd.js', 'e.rb'];
        const res2 = await read({ fileFilter: (entry) => entry.dirent.isFile() });
        res2.should.have.lengthOf(expect2.length);
        res2.forEach((entry, index) =>
          entry.should.containSubset(formatEntry(expect2[index], currPath))
        );
      }
    });
    it('function with stats', async () => {
      await cleanupFilter();
      const expect = ['a.js', 'c.js', 'd.js'];
      const res = await read({
        alwaysStat: true,
        fileFilter: (entry) => sysPath.extname(entry.fullPath) === '.js',
      });
      res.should.have.lengthOf(expect.length);
      res.forEach((entry, index) => {
        entry.should.containSubset(formatEntry(expect[index], currPath));
        entry.should.include.own.key('stats');
      });

      const expect2 = ['a.js', 'b.txt', 'c.js', 'd.js', 'e.rb'];
      const res2 = await read({ alwaysStat: true, fileFilter: (entry) => entry.stats.size > 0 });
      res2.should.have.lengthOf(expect2.length);
      res2.forEach((entry, index) => {
        entry.should.containSubset(formatEntry(expect2[index], currPath));
        entry.should.include.own.key('stats');
      });
    });
  });

  describe('options handling', () => {
    it('applies default highWaterMark of 256', async () => {
      await beforeEach();
      const stream = readdirp(currPath);
      stream.readableHighWaterMark.should.equal(256);
      stream.destroy();
    });

    it('respects custom highWaterMark', async () => {
      await beforeEach();
      const stream = readdirp(currPath, { highWaterMark: 1 });
      stream.readableHighWaterMark.should.equal(1);
      stream.destroy();
    });

    it('does not mutate the passed options object', async () => {
      await beforeEach();
      await touch(['a.txt']);
      const options = Object.freeze({ type: 'both' });
      const res = await readdirpPromise(currPath, options);
      res.should.have.lengthOf(1);
      chai.expect(options.root).to.equal(undefined);
      chai.expect(options.type).to.equal('both');
    });

    it('treats explicitly undefined options as defaults', async () => {
      await beforeEach();
      const files = ['a.txt', 'b.txt'];
      await touch(files);
      const res = await read({ type: undefined, root: undefined, fileFilter: undefined });
      res.should.have.lengthOf(files.length);
      res.forEach((entry, index) =>
        entry.should.containSubset(formatEntry(files[index], currPath))
      );
    });
  });

  describe('various', () => {
    it('emits readable stream', async () => {
      await beforeEach();
      const stream = readdirp(currPath);
      stream.should.be.an.instanceof(Readable);
      stream.should.be.an.instanceof(ReaddirpStream);
    });

    it('fails without root option passed', async () => {
      await beforeEach();
      try {
        readdirp();
      } catch (error) {
        error.should.be.an.instanceof(Error);
      }
    });

    it('disallows old API', async () => {
      // await beforeEach();
      try {
        readdirp({ root: '.' });
      } catch (error) {
        error.should.be.an.instanceof(Error);
      }
    });

    it('exposes promise API', async () => {
      await beforeEach();
      const created = ['a.txt', 'c.txt'];
      await touch(created);
      let result = await readdirpPromise(currPath);
      result = result.sort((a, b) => a.path.localeCompare(b.path));
      result.should.have.lengthOf(created.length);
      result.forEach((entry, index) =>
        entry.should.containSubset(formatEntry(created[index], currPath))
      );
    });
    it('should emit warning for missing directory', async () => {
      await beforeEach();
      // readdirp() is initialized on some big root directory
      // readdirp() receives path a/b/c to its queue
      // readdirp is reading something else
      // a/b gets deleted, so stat()-ting a/b/c would now emit enoent
      // We should emit warnings for this case.
      // this.timeout(4000);
      await mkdir(sysPath.join(currPath, 'a'));
      await mkdir(sysPath.join(currPath, 'b'));
      await mkdir(sysPath.join(currPath, 'c'));
      let isWarningCalled = false;
      const stream = readdirp(currPath, { type: 'all', highWaterMark: 1 });
      stream.on('warn', (warning) => {
        warning.should.be.an.instanceof(Error);
        warning.code.should.equals('ENOENT');
        isWarningCalled = true;
      });
      await delay(1000);
      await rm(sysPath.join(currPath, 'a'), { recursive: true });
      stream.resume();
      await Promise.race([waitForEnd(stream), delay(2000)]);
      isWarningCalled.should.equals(true);
    }); //.timeout(4000);
    it('should emit warning for missing file', async () => {
      await beforeEach();
      // readdirp() is initialized on some big root directory
      // readdirp() receives files f1, f2, f3 to its queue
      // readdirp is reading something else
      // f1 gets deleted, so stat()-ting f1 would now emit enoent
      // We should emit warnings for this case and properly process f2 and f3
      // this.timeout(4000);
      await touch(['f1', 'f2', 'f3']);
      let isWarningCalled = false;
      const stream = readdirp(currPath, { type: 'all', highWaterMark: 1, alwaysStat: true });
      stream.on('warn', (warning) => {
        warning.should.be.an.instanceof(Error);
        warning.code.should.equals('ENOENT');
        isWarningCalled = true;
      });
      await delay(1000);
      await rm(sysPath.join(currPath, 'f1'), { recursive: true });
      const detected = [];
      stream.on('data', (file) => {
        detected.push(file.path);
      });
      await Promise.race([waitForEnd(stream), delay(2000)]);

      chai.expect(detected).to.deep.equal(['f2', 'f3']);
      isWarningCalled.should.equals(true);
    });
    it('should emit warning for file with strict permission', async () => {
      // Windows doesn't throw permission error if you access permitted directory
      if (isWindows) {
        return true;
      }
      await beforeEach();
      const permitedDir = sysPath.join(currPath, 'permited');
      await mkdir(permitedDir, { mode: 0o333 });
      let isWarningCalled = false;
      const stream = readdirp(currPath, { type: 'all' })
        .on('data', (d) => {})
        .on('warn', (warning) => {
          warning.should.be.an.instanceof(Error);
          warning.code.should.equals('EACCES');
          isWarningCalled = true;
        });
      await Promise.race([waitForEnd(stream), delay(4000)]);
      isWarningCalled.should.equals(true);
      await chmod(permitedDir, 0o777);
    });
    it('should not emit warning after "end" event', async () => {
      // Windows doesn't throw permission error if you access permitted directory
      if (isWindows) {
        return true;
      }
      await beforeEach();
      const subdir = sysPath.join(currPath, 'subdir');
      const permitedDir = sysPath.join(subdir, 'permited');
      await mkdir(subdir);
      await mkdir(permitedDir, { mode: 0o333 });
      let isWarningCalled = false;
      let isEnded = false;
      let timer;
      const stream = readdirp(currPath, { type: 'all' })
        .on('data', () => {})
        .on('warn', (warning) => {
          warning.should.be.an.instanceof(Error);
          warning.code.should.equals('EACCES');
          isEnded.should.equals(false);
          isWarningCalled = true;
          clearTimeout(timer);
        })
        .on('end', () => {
          isWarningCalled.should.equals(true);
          isEnded = true;
        });
      await Promise.race([waitForEnd(stream), delay(2000)]);
      isWarningCalled.should.equals(true);
      isEnded.should.equals(true);
      await chmod(permitedDir, 0o777);
    });
  });
});

(async () => {
  await mkdir(root, { recursive: true });
  // Declare last task here
  it('clean-up', async () => {
    await rm(root, { recursive: true, force: true });
  });
  it.run(true);
})();
