import { chmod, rmdir, mkdir, symlink, readdir, readFile, writeFile } from 'node:fs/promises';
import sysPath from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { describe, it } from 'micro-should';
import { tmpdir } from 'node:os';
import chai from 'chai';
import chaiSubset from 'chai-subset';
import { readdirp, readdirpPromise, ReaddirpStream } from '../esm/index.js';

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
    await rmdir(currPath, { recursive: true });
  } catch (e) {}
  await mkdir(currPath, { recursive: true });
  return true;
}

let afterEach = async () => {
  // await pRimraf(currPath);
  await rmdir(currPath, { recursive: true });
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
      const originalPath = sysPath.join(__dirname, '..', 'esm');
      const originalFiles = await readdir(originalPath);
      const newPath = sysPath.join(currPath, 'esm');
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
    it('should emit warning for missing file', async () => {
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
      await rmdir(sysPath.join(currPath, 'a'), { recursive: true });
      stream.resume();
      await Promise.race([waitForEnd(stream), delay(2000)]);
      isWarningCalled.should.equals(true);
    }); //.timeout(4000);
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
    await rmdir(root, { recursive: true, force: true });
  });
  it.run();
})();
