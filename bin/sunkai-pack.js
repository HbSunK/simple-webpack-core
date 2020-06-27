#! /usr/bin/env node
const path = require('path')
const filePath = process.cwd()
const config = require(path.resolve(filePath, 'webpack.config.js'))
const Compiler = require('../lib/compiler')

console.log(`\n======================================> pack start <======================================\n`)

const compiler = new Compiler(config)
compiler.run()