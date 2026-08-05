'use strict';

const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fse = require('fs-extra');
const fetch = require('node-fetch');
const extractZip = require('./extract-zip');

const resolveFilename = (uri) => path.basename(new URL(uri).pathname) || 'download';

module.exports = async (uri, output, options = {}) => {
  const headers = {};
  if (options.username || options.password) {
    headers.authorization = `Basic ${Buffer.from(
      `${options.username || ''}:${options.password || ''}`
    ).toString('base64')}`;
  }

  const response = await fetch(uri, {
    headers,
    timeout: options.timeout,
  });

  if (!response.ok) {
    throw new Error(`Download failed with status code ${response.status}`);
  }

  const data = await response.buffer();

  if (options.extract) {
    const archivePath = path.join(
      os.tmpdir(),
      `serverless-download-${crypto.randomBytes(8).toString('hex')}.zip`
    );
    try {
      await fse.outputFile(archivePath, data);
      return await extractZip(archivePath, output, options);
    } finally {
      await fse.remove(archivePath);
    }
  }

  const outputPath = path.join(output, options.filename || resolveFilename(uri));
  await fse.outputFile(outputPath, data);
  return data;
};
