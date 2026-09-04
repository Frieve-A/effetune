const constants = require('./constants');

function buildAutoRestartArgs(argv = process.argv) {
  return [
    ...argv.slice(1).filter(argument => argument !== constants.AUTO_RESTART_FLAG),
    constants.AUTO_RESTART_FLAG
  ];
}

function queueAutoRestart(app, argv = process.argv) {
  app.relaunch({ args: buildAutoRestartArgs(argv) });
}

module.exports = {
  buildAutoRestartArgs,
  queueAutoRestart
};
