var fs = require('fs');
var path = require('path');
var isempty = require('is-empty');
var program = require('commander');
var logger = require('./cli-logger');
var xml = require('xml2js').Parser();
var app = require('../package.json');
var debug = require('debug')(app.name + '-application');
var moment = require('moment');
const stdin = process.stdin;

// types
function customCli({moduleName, defaultActionToExecute, addCliOptions, parseInputLine}) {
  this.moduleName = moduleName;
  this.defaultActionToExecute = defaultActionToExecute;
  this.addCliOptions = addCliOptions;
  this.parseInputLine = parseInputLine;
}

// regexes
var reNewLine = /\r\n?|\n/;

// functions
function readStdin() {
  let ret = '';

  return new Promise(s => {
    if (stdin.isTTY) {
      debug('stdin was TTY - received no input from stdin... moving on');
      return s(ret);
    }

    stdin.setEncoding('utf8');

    stdin.on('readable', () => {
      let chunk;
      while ((chunk = stdin.read())) {
        ret += chunk;
      }
    });

    stdin.on('end', () => {
      debug('finished reading input from stdin. input was:');
      debug(ret);
      s(ret);
    });
  });
}

function setupCliApplication(addCliOptions) {

  // standard input options for all cli applications
  program
      .version(app.version)
      .option('-i, --input <path>', `set config path. defaults to "./${app.name}.json"`, `./${app.name}.json`)
      .option('-o, --output <path>', `optionally set output path. output written to to console by default.`)
      .option('-O, --log-output <path>', `set logger path. defaults to "./${app.name}.log"`, `./${app.name}.log`)
      .option('-L, --no-logger', 'optionally turn off logging. the cli will always log all info and above messages.')
      .option('-S, --sandbox <items>', 'list of tools to be added to the application sandbox')
      .option('-N, --no-color', 'optionally remove color from console output. defaults to "false".')
      .option('-v, --verbose', 'optionally remove commandline output. defaults to "false".');

  // add custom options with a function operating on program that is defined in individual cli implementation. if passed
  if (typeof addCliOptions === "function")
    addCliOptions(program);

  // parse the cli input
  debug('parsing cli input');
  program.parse(process.argv);

  // create cli sandbox adding application paths to the environment PATH variable
  if (program.sandbox) {
    debug('adding to PATH, creating sandbox:');
    debug(program.sandbox);
    process.env.PATH = [process.env.PATH].concat(program.sandbox.split(',')).join(';');
  }

  process.on('SIGINT', () => {
    console.log('Received SIGINT.  Press Control-D to exit.');
  });
}

function configureOutput() {
    // log output to console and all other information to file
    logger.remove(logger.transports.Console);

    if (program.verbose) {
      debug('application is verbose. adding console logger');
      logger.add(logger.transports.Console, { level: 'abort', colorize: program.color, prettyPrint: true });
    }

    if (program.logOutput && program.logger) {
      debug('application has output log defined. adding file logger to ' + program.logger);
      logger.add(logger.transports.File, { level: 'abort', filename: program.logOutput, colorize: false, prettyPrint: true });
    }

    // logger.cli();
    logger.start(app.name + ' --version ' + app.version + ' --time ' + new Date().toTimeString());
    return moment();
}

function readFromInputChannels (stdin, parseInputLine, moduleName) {

  var input;
  // stdin trumps all
  if (!isempty(stdin)) {
    input = stdin;
    debug('set config from standard in');

  } else {

    debug('detected nothing from stdin');
    debug('using --input flag to load file: ' + program.input);
    input = fs.readFileSync(program.input);
  }

  debug('figuring out input file type... currently supported: plain text, xml, json.');
  var config;
  if (/^[\],:{}\s]*$/.test(input.toString('utf8').replace(/\\["\\\/bfnrtu]/g, '@').
    replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']').
    replace(/(?:^|:|,)(?:\s*\[)+/g, ''))) {

      debug('input is JSON format');
      debug('parsing to JS object');
      //the json is ok
      config = JSON.parse(input);

  } else if (input.toString('utf8').trim()[0] === '<' ) {

    debug('input is XML format');
    debug('parsing to JS object');
    var error;
    var result;
    xml.parseString(input, function (e, r) {

        error = e;
        result = r;
    });

    if (error) {

      debug('failed to parse XML input');
      throw error;
    }

    debug('input parsed from XML');
    config = result;

  } else {

    debug('input is plain-text format');
    debug('converting the input to an array of lines');
    config = input.toString('utf8').split(reNewLine);
    debug(config);

    // parse the input according to the parsing function passed from the cli implementation
    if (typeof parseInputLine === 'function') {
      debug('applying the custom parseInputLine function to each line of config for the module:' + moduleName);
      config = config.map(parseInputLine).filter(i => !isempty(i));
    }
  }

  return config;
}

/**
 * Create and execute the CLI.
 * @param {customCli} ci - The CLI plugin functions that hold the logic of the be-cli implementation. be-cli is a collection of generic cli functions.
 */
function cmd (ci) {
  return new Promise((s, e) => {
    readStdin().then(stdin => {

      debug(ci);
      setupCliApplication(ci.addCliOptions);
      var start = configureOutput();
      program.inputData = readFromInputChannels(stdin, ci.parseInputLine, ci.moduleName);

      ci.defaultActionToExecute(program)
        .then(o => {

          if (program.output)
            fs.writeSync(program.output, o);
          else
            console.log(o);
          logger.end(app.name + ' --version ' + app.version + ' --time ' + new Date().toTimeString() + ' --elapsed ' + start.fromNow(true));
          process.exit(0);
        })
        .catch(e => {

          debug(e);
          var errorMessage = [e.message, e.stdout, e.stderr].filter(i => !isempty(i)).join(',');
          logger.error(errorMessage);
          logger.abort(app.name + ' --version ' + app.version + ' --time ' + new Date().toTimeString() + ' --elapsed ' + start.fromNow(true));
          process.exit(1);
        });

    });
  });
}

/**
 * Create and execute the CLI.
 * @param {customCli} ci - The CLI plugin functions that hold the logic of the be-cli implementation. be-cli is a collection of generic cli functions.
 */
function cmdSync (ci) {
  readStdin().then(stdin => {

    setupCliApplication(ci.addCliOptions);
    var start = configureOutput();
    program.inputData = readFromInputChannels(stdin, ci.parseInputLine, ci.moduleName);

    try {

      var o = ci.defaultActionToExecute(program);
      if (program.output)
        fs.writeSync(program.output, o);
      else
        console.log(o);
      logger.end(app.name + ' --version ' + app.version + ' --time ' + new Date().toTimeString() + ' --elapsed ' + start.fromNow(true) );
      process.exit(0);

    } catch (e) {

      logger.error(e.message + e.stdout + e.stderr);
      logger.abort(app.name + ' --version ' + app.version + ' --time ' + new Date().toTimeString() + ' --elapsed ' + start.fromNow(true));
      process.exit(1);

    }

  }).catch(e => {
    logger.error(e);
  });
}

// exports

module.exports = {
  cmdSync: cmdSync,
  cmd: cmd,
  customCli: customCli,
  logger: logger
};