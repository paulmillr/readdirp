// TypeScript Version: 3.2

/// <reference types="node" lib="esnext" />

import * as fs from "fs";
import {Readable} from "stream";

interface EntryInfo {
  path: string,
  fullPath: string,
  basename: string,
  stats: fs.Stats
}

interface ReaddirpOptions {
  root?: string;
  fileFilter?: (entry: EntryInfo) => boolean,
  directoryFilter?: (entry: EntryInfo) => boolean,
  type?: 'files' | 'directories' | 'files_directories' | 'all'
  lstat?: boolean,
  depth?: number
}

declare class ReaddirpStream extends Readable implements AsyncIterable<EntryInfo> {
  read(): EntryInfo;
  [Symbol.asyncIterator](): AsyncIterableIterator<EntryInfo>;
}

interface Readdirp {
  (root: string, options?: ReaddirpOptions): ReaddirpStream;
  promise(root: string, options?: ReaddirpOptions): Promise<Array<EntryInfo>>;
  ReaddirpStream: ReaddirpStream;
  EntryInfo: EntryInfo;
}

declare const readdir: Readdirp;
export = readdir;
