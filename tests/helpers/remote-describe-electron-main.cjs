'use strict';

const { app } = require('electron');
const path = require('node:path');
const { installTestWindowPolicy } = require('./electron-test-display.cjs');

app.setAppPath(path.resolve(__dirname, '../..'));
installTestWindowPolicy();

require('../../electron/main.js');
