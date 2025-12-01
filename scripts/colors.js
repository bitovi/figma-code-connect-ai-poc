const chalk = require('chalk').default;

// Shared palette for pipeline scripts
const figmaColor = (text) => chalk.red(text);
const codeColor = (text) => chalk.cyanBright(text);
const generatedColor = (text) => chalk.magentaBright(text);
const highlight = (text) => chalk.whiteBright(text);

module.exports = {
  figmaColor,
  codeColor,
  generatedColor,
  highlight
};
