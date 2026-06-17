const express = require('express');
const router = require('./routes');

const app = express();
app.use(express.json());
app.use(router);

let _server = null;

function start(port) {
  const p = port || process.env.MOCK_HCM_PORT || 4000;
  return new Promise((resolve) => {
    _server = app.listen(p, () => {
      console.log(`Mock HCM server running on port ${p}`);
      resolve(_server);
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    if (_server) _server.close(() => resolve());
    else resolve();
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start, stop };
