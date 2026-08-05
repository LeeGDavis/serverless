'use strict';

const path = require('path');
const { pipeline } = require('stream/promises');
const fse = require('fs-extra');
const fsp = require('fs').promises;
const yauzl = require('yauzl');

const symlinkFileType = 0o120000;
const fileTypeMask = 0o170000;

const openZip = (archivePath) =>
  new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zipfile) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(zipfile);
      }
    );
  });

const openReadStream = (zipfile, entry) =>
  new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, readStream) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(readStream);
    });
  });

const normalizeEntryPath = (entryPath, strip = 0) => {
  if (entryPath.includes('\0')) {
    throw new Error(`Refusing to extract zip entry with invalid path: ${entryPath}`);
  }

  const normalizedEntryPath = entryPath.replace(/\\/g, '/');
  const pathSegments = normalizedEntryPath.split('/').filter(Boolean);

  if (
    !normalizedEntryPath ||
    path.posix.isAbsolute(normalizedEntryPath) ||
    path.win32.isAbsolute(entryPath) ||
    pathSegments.includes('..')
  ) {
    throw new Error(`Refusing to extract zip entry outside target directory: ${entryPath}`);
  }

  const strippedPathSegments = pathSegments.slice(strip);
  if (!strippedPathSegments.length) return null;

  return {
    normalizedEntryPath: strippedPathSegments.join('/'),
    pathSegments: strippedPathSegments,
  };
};

const getEntryFileMode = (entry) => (entry.externalFileAttributes >>> 16) & 0xffff;

const extractZipEntry = async ({ zipfile, entry, destination, filter, extractedFiles }) => {
  const normalizedEntry = normalizeEntryPath(entry.fileName, zipfile.extractOptions.strip);
  if (!normalizedEntry) return;

  const { normalizedEntryPath, pathSegments } = normalizedEntry;
  const entryFile = { path: normalizedEntryPath };
  const targetPath = path.resolve(destination, ...pathSegments);
  const destinationPath = path.resolve(destination);

  if (targetPath !== destinationPath && !targetPath.startsWith(`${destinationPath}${path.sep}`)) {
    throw new Error(`Refusing to extract zip entry outside target directory: ${entry.fileName}`);
  }

  const mode = getEntryFileMode(entry);
  if ((mode & fileTypeMask) === symlinkFileType) {
    throw new Error(`Refusing to extract symlink from zip archive: ${entry.fileName}`);
  }

  if (filter && !filter(entryFile)) {
    return;
  }

  if (entry.fileName.endsWith('/')) {
    await fse.ensureDir(targetPath);
    return;
  }

  await fse.ensureDir(path.dirname(targetPath));
  await pipeline(await openReadStream(zipfile, entry), fse.createWriteStream(targetPath));

  const permissionMode = zipfile.extractOptions.mode || mode & 0o777;
  if (permissionMode) await fsp.chmod(targetPath, permissionMode);
  extractedFiles.push(entryFile);
};

module.exports = async (archivePath, destination, options = {}) => {
  const destinationPath = path.resolve(destination);
  await fse.ensureDir(destinationPath);

  const zipfile = await openZip(archivePath);
  zipfile.extractOptions = {
    mode: options.mode && Number.parseInt(options.mode, 8),
    strip: options.strip || 0,
  };
  const extractedFiles = [];

  return await new Promise((resolve, reject) => {
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      zipfile.close();
      reject(error);
    };

    zipfile.on('entry', (entry) => {
      extractZipEntry({
        zipfile,
        entry,
        destination: destinationPath,
        filter: options.filter,
        extractedFiles,
      })
        .then(() => zipfile.readEntry())
        .catch(rejectOnce);
    });
    zipfile.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(extractedFiles);
    });
    zipfile.on('error', rejectOnce);
    zipfile.readEntry();
  });
};
