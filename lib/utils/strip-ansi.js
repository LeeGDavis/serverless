'use strict';

const ansiPattern = new RegExp(
  ['\\u001b\\][^\\u0007]*(?:\\u0007|\\u001b\\\\)', '\\u001b\\[[0-?]*[ -/]*[@-~]'].join('|'),
  'g'
);

module.exports = (input) => String(input).replace(ansiPattern, '');
