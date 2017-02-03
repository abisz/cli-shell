var cliLogger = require('winston');

cliLogger.setLevels({
    info:     0,
    success:  1,
    error:    2,
    start:    3,
    end:      4,
    abort:    5
});
cliLogger.addColors({
    info:     'yellow',
    success:  'green',
    error:    'red',
    start:    'blue',
    end:      'blue',
    abort:    'red'
});

module.exports = cliLogger;