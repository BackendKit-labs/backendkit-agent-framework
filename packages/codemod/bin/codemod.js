#!/usr/bin/env node
require('../dist/cli').main(process.argv.slice(2)).then(code => { process.exitCode = code; });
