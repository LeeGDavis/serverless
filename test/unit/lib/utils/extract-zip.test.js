'use strict';

const path = require('path');
const fse = require('fs-extra');
const JSZip = require('jszip');
const chai = require('chai');
const extractZip = require('../../../../lib/utils/extract-zip');
const { getTmpDirPath } = require('../../../utils/fs');

chai.use(require('chai-as-promised'));

const expect = chai.expect;

const writeZip = async (zipPath, entries) => {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.path, entry.content, entry.options);
  }
  await fse.outputFile(zipPath, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
};

describe('#extractZip()', () => {
  let tmpDir;
  let archivePath;
  let destinationPath;

  beforeEach(() => {
    tmpDir = getTmpDirPath();
    archivePath = path.join(tmpDir, 'archive.zip');
    destinationPath = path.join(tmpDir, 'extracted');
  });

  it('extracts zip files into the target directory', async () => {
    await writeZip(archivePath, [{ path: 'dir/file.txt', content: 'content' }]);

    const extractedFiles = await extractZip(archivePath, destinationPath);

    expect(extractedFiles).to.deep.equal([{ path: 'dir/file.txt' }]);
    expect(await fse.readFile(path.join(destinationPath, 'dir', 'file.txt'), 'utf8')).to.equal(
      'content'
    );
  });

  it('supports filtering entries', async () => {
    await writeZip(archivePath, [
      { path: 'included.txt', content: 'included' },
      { path: 'ignored.txt', content: 'ignored' },
    ]);

    const extractedFiles = await extractZip(archivePath, destinationPath, {
      filter: (file) => file.path !== 'ignored.txt',
    });

    expect(extractedFiles).to.deep.equal([{ path: 'included.txt' }]);
    expect(await fse.pathExists(path.join(destinationPath, 'included.txt'))).to.equal(true);
    expect(await fse.pathExists(path.join(destinationPath, 'ignored.txt'))).to.equal(false);
  });

  it('supports stripping leading path segments', async () => {
    await writeZip(archivePath, [
      { path: 'archive-root/service/serverless.yml', content: 'service' },
    ]);

    const extractedFiles = await extractZip(archivePath, destinationPath, { strip: 1 });

    expect(extractedFiles).to.deep.equal([{ path: 'service/serverless.yml' }]);
    expect(await fse.pathExists(path.join(destinationPath, 'archive-root'))).to.equal(false);
    expect(
      await fse.readFile(path.join(destinationPath, 'service', 'serverless.yml'), 'utf8')
    ).to.equal('service');
  });

  it('rejects entries that resolve outside of the target directory', async () => {
    await writeZip(archivePath, [{ path: '../escaped.txt', content: 'escaped' }]);

    await expect(extractZip(archivePath, destinationPath)).to.be.rejectedWith(
      /outside target directory|invalid relative path/
    );
    expect(await fse.pathExists(path.join(tmpDir, 'escaped.txt'))).to.equal(false);
  });

  it('rejects symlink entries', async () => {
    await writeZip(archivePath, [
      {
        path: 'link',
        content: '../escaped.txt',
        options: { unixPermissions: 0o120777 },
      },
    ]);

    await expect(extractZip(archivePath, destinationPath)).to.be.rejectedWith(
      'Refusing to extract symlink'
    );
  });
});
