'use strict'

const test = require('ava')
const { session, Scenes } = require('../')
const { createBot } = require('./_helpers')

const BaseTextMessage = {
    chat: { id: 1 },
    from: { id: 1 },
    text: 'foo',
}

test('should execute enter middleware in scene', (t) => {
    const bot = createBot()
    const scene = new Scenes.BaseScene('hello')
    scene.enter((ctx) => t.pass())
    const stage = new Scenes.Stage([scene])
    stage.use((ctx) => ctx.scene.enter('hello'))
    bot.use(session())
    bot.use(stage)
    return bot.handleUpdate({ message: BaseTextMessage })
})

test('should execute enter middleware in wizard scene', (t) => {
    const bot = createBot()
    const scene = new Scenes.WizardScene('hello', [])
    scene.enter((ctx) => t.pass())
    const stage = new Scenes.Stage([scene])
    stage.use((ctx) => ctx.scene.enter('hello'))
    bot.use(session())
    bot.use(stage)
    return bot.handleUpdate({ message: BaseTextMessage })
})

test('should execute first step in wizard scene on enter', (t) => {
    const bot = createBot()
    const scene = new Scenes.WizardScene('hello', (ctx) => {
        t.pass()
    })
    const stage = new Scenes.Stage([scene])
    stage.use((ctx) => ctx.scene.enter('hello'))
    bot.use(session())
    bot.use(stage)
    return bot.handleUpdate({ message: BaseTextMessage })
})

test('should execute both enter middleware and first step in wizard scene on enter', (t) => {
    t.plan(2)
    const bot = createBot()
    const scene = new Scenes.WizardScene('hello', (ctx) => {
        t.pass()
    })
    scene.enter((ctx, next) => {
        t.pass()
        return next()
    })
    const stage = new Scenes.Stage([scene])
    stage.use((ctx) => ctx.scene.enter('hello'))
    bot.use(session())
    bot.use(stage)
    return bot.handleUpdate({ message: BaseTextMessage })
})
