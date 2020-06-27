const path = require('path')                // 路丽模块
const fs = require('fs')                    // 文件模块
const babylon = require('babylon')
const traverse = require('@babel/traverse').default
const types = require('@babel/types')
const generator = require('@babel/generator').default
const ejs = require('ejs')
const { SyncHook } = require('tapable')      // 发布订阅模式，即使用此方法注册和通知模块，在此引用的 SyncHook 是基于同步函数的发布订阅模块

// 下面是几个核心的依赖包，用于处理源码
// babylon          把源码转换成AST
// @babel/traverse  遍历AST上节点
// @baber/types     替换AST节点上要处理的属性值
// @babel/generator 将AST转换成源码
// ejs              其实就是模板引擎，入参为模板字符串和要循环的数据

class Compiler {
    constructor (config) {
        this.config = config

        // 入口路径
        this.entry = config.entry

        // 所有的loader
        this.loaders = config.modules.rules

        // 当前运行打包环境的目录
        this.root = process.cwd()

        // 注册好的所有模块
        this.modules = {}

        // 入口模块id
        this.entryId
        
        // 对外提供打包阶段的生命周期函数
        // 这也是webpack插件的核心实现原理：即在不同的生命周期函数中注册不同的方法，webpack执行阶段会依次触发这些生命周期函数及注册好的方法
        this.hooks = {
            run: new SyncHook(['status']),

            beforeEntryOptions: new SyncHook(),
            afterEntryOptions: new SyncHook(),

            beforeCompile: new SyncHook(),
            afterCompile: new SyncHook(),

            beforeEmitFile: new SyncHook(),
            afterEmitFile: new SyncHook(),

            done: new SyncHook(['status'])
        }

        // 初始化所有插件，将插件都注册到对应的钩子函数中
        this.initPlugins()
    }

    run () {

        this.hooks.run.call('pack run')

        this.hooks.beforeEntryOptions.call()

        // 从打包的入口路径文件开始构建
        const entry = path.resolve(this.root, this.entry.index) // 此处是一个相当路径

        this.hooks.afterEntryOptions.call()

        this.hooks.beforeCompile.call()

        // 生成依赖包
        this.buildModule(entry, true)

        this.hooks.afterCompile.call()

        this.hooks.beforeEmitFile.call()

        // 将生成的文件输出到指定目录
        this.emitFile()

        this.hooks.afterEmitFile.call()

        this.hooks.done.call('pack done')

        // console.log(this.modules)
    }

    initPlugins () {
        const plugins = this.config.plugins

        if (Array.isArray(plugins)) {
            plugins.forEach(item => item.applyFn(this))
        }
    }

    // 模块打包，分析模块间的依赖关系
    buildModule (modulePath, isEntry = false) {
        // 找到对应路径下的文件内容
        let source = this.getSource(modulePath)

        // 生成相对路径
        let moduleName = './' + path.relative(this.root, modulePath)

        if (isEntry) {
            this.entryId = moduleName
        }

        // 模块内容解析，对源码进行改造，主要是把内容中的路径都变成相对路径，并返回处理了后的源码和依赖关系的列表
        let {sourceCode, dependencies} = this.parseSource(source, path.dirname(moduleName))
        
        // 根据主入口路径，递归找到所有的模块依赖
        dependencies.forEach(dep => {
            this.buildModule(path.join(this.root, dep))
        })

        // 收集所有的模块入口，及模块对应的代码
        this.modules[moduleName] = sourceCode
    }

    parseSource (source, rootPath) {
        let dependencies = []
        let sourceCode

        // 生成ast
        let ast = babylon.parse(source)
        traverse(ast, {

            // 此函数的作用是找到所有的函数调用，例：a()、b()、require()
            // 而在这里的主要是为了找到 require 的调用，因为在此处 require 代表了一种模块间的相互引用的依赖关系，只有分析出依赖关系，才能进行打包
            CallExpression(p) {
                let node = p.node   // 找到对应的节点

                // 将所有require语法转换成原生js可识别的函数名，在此为 __webpack_require__，并收集代码的依赖关系
                if (node.callee.name === 'require') {
                    node.callee.name = '__webpack_require__'
                    let moduleName = node.arguments[0].value                    // 取到模块的引用名字
                    moduleName = moduleName + (path.extname(moduleName) ? '' : '.js')     // 对文件增加扩展名
                    moduleName = './' + path.join(rootPath, moduleName)         // 路径拼接
                    dependencies.push(moduleName)                               // 收集完所有的依赖关系
                    node.arguments = [types.stringLiteral(moduleName)]          // 修改原AST中的内容
                }
            }
        })

        sourceCode = generator(ast).code

        // console.log(sourceCode)

        return {
            sourceCode,
            dependencies
        }
    }

    // 将打包好的文件 发送到指定目录下
    emitFile () {
        const config = this.config

        // 获取输出路径
        let outputPath = path.join(config.output.path, config.output.filename)

        // 找到需要webpack打包后的模板，并对模板进行改造
        let source = this.getSource(path.resolve(__dirname, 'pack-template.tpl-js'))
        let code = ejs.render(source, {
            entryId: this.entryId,
            modules: this.modules
        })

        // 用一个对象存起来，因为可能会存在多入口打包的情况
        this.assset = {}
        this.assset[outputPath] = code

        // 将打包好的文件输出到指定目录
        fs.writeFileSync(outputPath, code)
    }

    // 获取路径下的内容
    getSource (path) {
        let source = fs.readFileSync(path, 'utf8')

        this.loaders.forEach(item => {
            if (item.test.test(path)) {
                // loader的执行顺序都是从下到上，从右至左执行的，所以在此用 reverse 反转数组，用reduce将每一个loader的处理结果传给下一个loader，直到产生最终结果
                source = item.use.reverse().reduce((result, item) => {
                    return require(item)(result)
                }, source)
            }
        })

        return source
    }
}

module.exports = Compiler