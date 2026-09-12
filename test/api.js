const http = require('http')
const { execFileSync } = require('child_process')
const os = require('os')
const fs = require('fs')
const path = require('path')
const util = require('util')
const ts = require('typescript')
const test = require('ava')
const { Context, Input, TelegrafNetworkError, Telegram } = require('../')

function readTypeFile(name) {
    const typesRoot = path.dirname(
        require.resolve('@telegraf/types/package.json')
    )
    return fs
        .readFileSync(path.join(typesRoot, `${name}.d.ts`), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
}

function readMethodsFromTypes() {
    const methods = readTypeFile('methods')
    const source = ts.createSourceFile(
        'methods.d.ts',
        methods,
        ts.ScriptTarget.Latest,
        true
    )
    const names = []
    const getName = (name) =>
        ts.isIdentifier(name) || ts.isStringLiteral(name)
            ? name.text
            : undefined
    const visit = (node) => {
        if (
            ts.isTypeAliasDeclaration(node) &&
            node.name.text === 'ApiMethods' &&
            ts.isTypeLiteralNode(node.type)
        ) {
            for (const member of node.type.members) {
                const name = member.name && getName(member.name)
                if (name) names.push(name)
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return [...new Set(names)]
}

function getBlock(source, pattern) {
    const match = pattern.exec(source)
    if (!match) return ''
    const open = source.indexOf('{', match.index)
    if (open === -1) return ''

    let depth = 0
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++
        if (source[i] === '}') depth--
        if (depth === 0) return source.slice(open, i + 1)
    }
    return ''
}

function getInterface(source, name) {
    return getBlock(source, new RegExp(`\\binterface ${name}\\b`))
}

function getMethodArgs(source, name) {
    return getBlock(source, new RegExp(`\\b${name}\\(args\\??: \\{`))
}

function compact(value) {
    return value.replace(/\s+/g, ' ')
}

function hasField(block, name, type) {
    return compact(block).includes(`${name}: ${type};`)
}

function hasOptionalField(block, name, type) {
    return compact(block).includes(`${name}?: ${type};`)
}

function hasAnyField(block, name) {
    return new RegExp(`\\b${name}\\??\\s*:`).test(block)
}

function hasTypeMember(source, name, member) {
    const match = new RegExp(`\\btype ${name} = ([\\s\\S]*?);`).exec(source)
    return Boolean(match && compact(match[1]).includes(member))
}

// Package root as a TypeScript import specifier; forward slashes keep Windows paths valid in string literals
const packageRoot = process.cwd().split(path.sep).join('/')

function compileTypeScript(name, source) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegraf-types-'))
    const file = path.join(dir, name)
    fs.writeFileSync(file, source)
    try {
        // run tsc through node: the extensionless .bin shim cannot be spawned on Windows
        execFileSync(
            process.execPath,
            [
                require.resolve('typescript/bin/tsc'),
                '--noEmit',
                '--strict',
                '--module',
                'node16',
                '--moduleResolution',
                'node16',
                '--target',
                'es2022',
                '--skipLibCheck',
                file,
            ],
            { stdio: 'pipe' }
        )
    } catch (err) {
        // surface compiler diagnostics instead of an opaque Buffer
        if (err.stdout) err.message += `\n${err.stdout}`
        throw err
    }
}

test('Telegram wraps every typed Bot API method', (t) => {
    const methods = readMethodsFromTypes()
    const missing = methods.filter(
        (method) => typeof Telegram.prototype[method] !== 'function'
    )
    t.deepEqual(missing, [])
})

test('Telegram wrappers call through to matching Bot API methods', (t) => {
    const source = fs.readFileSync(path.join(__dirname, '../src/telegram.ts'), {
        encoding: 'utf8',
    })
    const wrapped = new Set(
        [...source.matchAll(/callApi\('([a-zA-Z0-9]+)'/g)].map(
            (match) => match[1]
        )
    )
    const aliases = new Set(
        [
            ...source.matchAll(/get ([a-zA-Z0-9]+)\(\) \{\n {8}return this\./g),
        ].map((match) => match[1])
    )
    const missing = readMethodsFromTypes().filter(
        (method) => !wrapped.has(method) && !aliases.has(method)
    )
    t.deepEqual(missing, [])
})

test('Telegram answerCallbackQuery passes raw Bot API options', (t) => {
    const telegram = new Telegram('token')
    telegram.callApi = (method, payload) => {
        t.is(method, 'answerCallbackQuery')
        t.deepEqual(payload, {
            callback_query_id: 'callback-query-id',
            text: 'ok',
        })
        return true
    }

    t.true(
        telegram.answerCallbackQuery({
            callback_query_id: 'callback-query-id',
            text: 'ok',
        })
    )
})

test('Telegram setStickerSetThumbnail follows Bot API order', (t) => {
    const telegram = new Telegram('token')
    telegram.callApi = (method, payload) => {
        t.is(method, 'setStickerSetThumbnail')
        t.deepEqual(payload, {
            name: 'stickers',
            user_id: 42,
            thumbnail: 'attach://thumbnail',
            format: 'static',
        })
        return true
    }

    t.true(
        telegram.setStickerSetThumbnail(
            'stickers',
            42,
            'attach://thumbnail',
            'static'
        )
    )
})

test('Context exposes business update helpers', async (t) => {
    let businessConnectionId
    const calls = []
    const telegram = {
        getBusinessConnection(id) {
            businessConnectionId = id
            return { id }
        },
        sendMessage(...args) {
            calls.push(['sendMessage', args])
            return true
        },
        sendPhoto(...args) {
            calls.push(['sendPhoto', args])
            return true
        },
    }
    const ctx = new Context(
        {
            update_id: 1,
            business_message: {
                business_connection_id: 'biz-1',
                message_id: 12,
                date: 1,
                chat: { id: 42, type: 'private' },
                text: 'hello',
            },
        },
        telegram,
        { id: 7, is_bot: true, first_name: 'Bot' }
    )

    t.is(ctx.bizConnId, 'biz-1')
    t.is(ctx.msg.text, 'hello')
    t.deepEqual(await ctx.getBusinessConnection(), { id: 'biz-1' })
    t.is(businessConnectionId, 'biz-1')

    await ctx.reply('business reply')
    await ctx.sendPhoto('photo-id')

    t.deepEqual(calls, [
        [
            'sendMessage',
            [
                42,
                'business reply',
                {
                    business_connection_id: 'biz-1',
                    message_thread_id: undefined,
                },
            ],
        ],
        [
            'sendPhoto',
            [
                42,
                'photo-id',
                {
                    business_connection_id: 'biz-1',
                    message_thread_id: undefined,
                },
            ],
        ],
    ])
})

// Bot API 10.3: ephemeral messages

const botInfo = { id: 7, is_bot: true, first_name: 'Bot' }
const ephemeralUser = { id: 99, is_bot: false, first_name: 'User' }
const privateChat = { id: 42, type: 'private' }
const ephemeralParams = { receiver_user_id: 99, callback_query_id: 'cbq-1' }
const inlineMarkup = {
    inline_keyboard: [[{ text: 'ok', callback_data: 'ok' }]],
}
const EPHEMERAL_MANAGEMENT_METHODS = [
    'editEphemeralMessageText',
    'editEphemeralMessageCaption',
    'editEphemeralMessageMedia',
    'editEphemeralMessageReplyMarkup',
    'deleteEphemeralMessage',
]

const boldEntities = (length) => [{ type: 'bold', offset: 0, length }]

/** Telegram client whose `callApi` records `[method, payload]` instead of hitting the network */
function recordingTelegram(result = true) {
    const calls = []
    const telegram = new Telegram('token')
    telegram.callApi = (method, payload) => {
        calls.push([method, payload])
        return result
    }
    return { telegram, calls }
}

function callbackUpdate(message) {
    return {
        update_id: 1,
        callback_query: {
            id: 'cbq-1',
            from: ephemeralUser,
            chat_instance: 'instance',
            data: 'more',
            message,
        },
    }
}

const ephemeralMessage = {
    message_id: 12,
    date: 1,
    chat: privateChat,
    from: botInfo,
    text: 'only you can see this',
    ephemeral_message_id: 'eph-1',
}

const plainMessageUpdate = {
    update_id: 2,
    message: {
        message_id: 13,
        date: 1,
        chat: privateChat,
        from: ephemeralUser,
        text: 'hello',
    },
}

/** Returns the members of `ApiMethods` whose args accept `field`, read from the installed types */
function readMethodsAcceptingField(field) {
    const source = ts.createSourceFile(
        'methods.d.ts',
        readTypeFile('methods'),
        ts.ScriptTarget.Latest,
        true
    )
    const names = []
    const visit = (node) => {
        if (
            ts.isTypeAliasDeclaration(node) &&
            node.name.text === 'ApiMethods' &&
            ts.isTypeLiteralNode(node.type)
        ) {
            for (const member of node.type.members) {
                const args = member.parameters?.[0]?.type
                if (
                    args &&
                    new RegExp(`\\b${field}\\??:`).test(args.getText(source))
                ) {
                    names.push(member.name.text)
                }
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return [...new Set(names)].sort()
}

/** Spins up a local Bot API stub, runs `call` against it and resolves with the captured request */
async function captureBotApiRequest(call) {
    let resolveRequest
    const request = new Promise((resolve) => {
        resolveRequest = resolve
    })
    const server = http.createServer((req, res) => {
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
            resolveRequest({
                url: req.url,
                headers: req.headers,
                body: Buffer.concat(chunks).toString('utf8'),
            })
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: true, result: true }))
        })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
        const telegram = new Telegram('123:abc', {
            apiRoot: `http://127.0.0.1:${server.address().port}`,
        })
        const result = await call(telegram)
        return { result, ...(await request) }
    } finally {
        server.close()
    }
}

function getMultipartField(body, name) {
    const match = new RegExp(
        `name="${name}"\\r\\n(?:[^\\r\\n]+\\r\\n)*\\r\\n([^\\r\\n]*)`
    ).exec(body)
    return match && match[1]
}

test('Telegram.editEphemeralMessageText sends plain and formatted text', async (t) => {
    const { bold } = require('../format')
    const { telegram, calls } = recordingTelegram({ marker: 'api-result' })
    const linkPreview = { is_disabled: true }

    const result = await telegram.editEphemeralMessageText(
        42,
        'eph-1',
        '<b>hi</b>',
        {
            parse_mode: 'HTML',
            link_preview_options: linkPreview,
            reply_markup: inlineMarkup,
        }
    )
    await telegram.editEphemeralMessageText('@channel', 'eph-2', bold('new'), {
        parse_mode: 'HTML',
    })

    t.deepEqual(result, { marker: 'api-result' })
    t.deepEqual(calls, [
        [
            'editEphemeralMessageText',
            {
                chat_id: 42,
                ephemeral_message_id: 'eph-1',
                parse_mode: 'HTML',
                link_preview_options: linkPreview,
                reply_markup: inlineMarkup,
                text: '<b>hi</b>',
            },
        ],
        [
            'editEphemeralMessageText',
            {
                chat_id: '@channel',
                ephemeral_message_id: 'eph-2',
                // entities from FmtString win over a parse_mode passed in extra
                parse_mode: undefined,
                text: 'new',
                entities: boldEntities(3),
            },
        ],
    ])
})

test('Telegram.editEphemeralMessageCaption formats, keeps and clears captions', async (t) => {
    const { bold } = require('../format')
    const { telegram, calls } = recordingTelegram()

    await telegram.editEphemeralMessageCaption(42, 'eph-1', 'caption', {
        parse_mode: 'MarkdownV2',
        show_caption_above_media: true,
        reply_markup: inlineMarkup,
    })
    await telegram.editEphemeralMessageCaption(42, 'eph-1', bold('formatted'))
    await telegram.editEphemeralMessageCaption(42, 'eph-1', undefined)

    t.deepEqual(calls, [
        [
            'editEphemeralMessageCaption',
            {
                chat_id: 42,
                ephemeral_message_id: 'eph-1',
                parse_mode: 'MarkdownV2',
                show_caption_above_media: true,
                reply_markup: inlineMarkup,
                caption: 'caption',
            },
        ],
        [
            'editEphemeralMessageCaption',
            {
                chat_id: 42,
                ephemeral_message_id: 'eph-1',
                caption: 'formatted',
                caption_entities: boldEntities(9),
                parse_mode: undefined,
            },
        ],
        [
            'editEphemeralMessageCaption',
            { chat_id: 42, ephemeral_message_id: 'eph-1', caption: undefined },
        ],
    ])
})

test('Telegram.editEphemeralMessageMedia formats captions and passes caption-less media through', async (t) => {
    const { bold } = require('../format')
    const { telegram, calls } = recordingTelegram()
    const location = { type: 'location', latitude: 51.5, longitude: -0.12 }
    const venue = {
        type: 'venue',
        latitude: 1,
        longitude: 2,
        title: 'Venue',
        address: 'Street 1',
    }
    const link = { type: 'link', url: 'https://example.test' }
    const upload = Input.fromBuffer(Buffer.from('bytes'), 'photo.png')

    await telegram.editEphemeralMessageMedia(
        42,
        'eph-1',
        { type: 'photo', media: 'photo-id', caption: bold('media') },
        { reply_markup: inlineMarkup }
    )
    await telegram.editEphemeralMessageMedia(42, 'eph-1', {
        type: 'video',
        media: 'video-id',
        caption: 'plain',
        parse_mode: 'HTML',
    })
    await telegram.editEphemeralMessageMedia(42, 'eph-1', location)
    await telegram.editEphemeralMessageMedia(42, 'eph-1', venue)
    await telegram.editEphemeralMessageMedia(42, 'eph-1', link)
    await telegram.editEphemeralMessageMedia(42, 'eph-1', {
        type: 'photo',
        media: upload,
    })

    const target = { chat_id: 42, ephemeral_message_id: 'eph-1' }
    t.deepEqual(calls, [
        [
            'editEphemeralMessageMedia',
            {
                ...target,
                media: {
                    type: 'photo',
                    media: 'photo-id',
                    caption: 'media',
                    caption_entities: boldEntities(5),
                    parse_mode: undefined,
                },
                reply_markup: inlineMarkup,
            },
        ],
        [
            'editEphemeralMessageMedia',
            {
                ...target,
                media: {
                    type: 'video',
                    media: 'video-id',
                    caption: 'plain',
                    parse_mode: 'HTML',
                },
            },
        ],
        ['editEphemeralMessageMedia', { ...target, media: location }],
        ['editEphemeralMessageMedia', { ...target, media: venue }],
        ['editEphemeralMessageMedia', { ...target, media: link }],
        [
            'editEphemeralMessageMedia',
            { ...target, media: { type: 'photo', media: upload } },
        ],
    ])
    // caption-less media objects are forwarded as-is, not copied
    t.is(calls[2][1].media, location)
})

test('Telegram.editEphemeralMessageReplyMarkup sets and removes keyboards', async (t) => {
    const { telegram, calls } = recordingTelegram()

    await telegram.editEphemeralMessageReplyMarkup(42, 'eph-1', inlineMarkup)
    await telegram.editEphemeralMessageReplyMarkup(
        '@channel',
        'eph-1',
        undefined
    )

    t.deepEqual(calls, [
        [
            'editEphemeralMessageReplyMarkup',
            {
                chat_id: 42,
                ephemeral_message_id: 'eph-1',
                reply_markup: inlineMarkup,
            },
        ],
        [
            'editEphemeralMessageReplyMarkup',
            {
                chat_id: '@channel',
                ephemeral_message_id: 'eph-1',
                reply_markup: undefined,
            },
        ],
    ])
})

test('Telegram.deleteEphemeralMessage targets chat and ephemeral id', async (t) => {
    const { telegram, calls } = recordingTelegram()

    t.true(await telegram.deleteEphemeralMessage(42, 'eph-1'))
    await telegram.deleteEphemeralMessage('@channel', 'eph-2')

    t.deepEqual(calls, [
        [
            'deleteEphemeralMessage',
            { chat_id: 42, ephemeral_message_id: 'eph-1' },
        ],
        [
            'deleteEphemeralMessage',
            { chat_id: '@channel', ephemeral_message_id: 'eph-2' },
        ],
    ])
})

test('ephemeral methods serialize to the Bot API as JSON', async (t) => {
    const { bold } = require('../format')
    const requests = []
    const telegram = new Telegram('123:abc', {
        fetch: async (url, init) => {
            requests.push({
                url: String(url),
                contentType: init.headers['content-type'],
                body: JSON.parse(init.body),
            })
            return {
                status: 200,
                statusText: 'OK',
                json: async () => ({ ok: true, result: true }),
            }
        },
    })

    await telegram.sendMessage(42, 'hi', {
        ephemeral_message_parameters: {
            ...ephemeralParams,
            replace_callback_query_message: true,
        },
    })
    t.true(await telegram.editEphemeralMessageText(42, 'eph-1', bold('bold')))
    t.true(await telegram.deleteEphemeralMessage(42, 'eph-1'))

    const endpoint = (method) => `https://api.telegram.org/bot123:abc/${method}`
    t.deepEqual(requests, [
        {
            url: endpoint('sendMessage'),
            contentType: 'application/json',
            body: {
                chat_id: 42,
                text: 'hi',
                ephemeral_message_parameters: {
                    receiver_user_id: 99,
                    callback_query_id: 'cbq-1',
                    replace_callback_query_message: true,
                },
            },
        },
        {
            url: endpoint('editEphemeralMessageText'),
            contentType: 'application/json',
            // undefined parse_mode is dropped from the wire payload
            body: {
                chat_id: 42,
                ephemeral_message_id: 'eph-1',
                text: 'bold',
                entities: boldEntities(4),
            },
        },
        {
            url: endpoint('deleteEphemeralMessage'),
            contentType: 'application/json',
            body: { chat_id: 42, ephemeral_message_id: 'eph-1' },
        },
    ])
})

test('ephemeral parameters and media survive multipart uploads', async (t) => {
    const sent = await captureBotApiRequest((telegram) =>
        telegram.sendPhoto(
            42,
            Input.fromBuffer(Buffer.from('photo-bytes'), 'photo.png'),
            { caption: 'pic', ephemeral_message_parameters: ephemeralParams }
        )
    )
    t.is(sent.url, '/bot123:abc/sendPhoto')
    t.regex(sent.headers['content-type'], /^multipart\/form-data/)
    t.deepEqual(
        JSON.parse(
            getMultipartField(sent.body, 'ephemeral_message_parameters')
        ),
        ephemeralParams
    )
    t.true(sent.body.includes('filename="photo.png"'))

    const edited = await captureBotApiRequest((telegram) =>
        telegram.editEphemeralMessageMedia(42, 'eph-1', {
            type: 'photo',
            media: Input.fromBuffer(Buffer.from('new-bytes'), 'new.png'),
        })
    )
    t.true(edited.result)
    t.is(edited.url, '/bot123:abc/editEphemeralMessageMedia')
    t.regex(edited.headers['content-type'], /^multipart\/form-data/)
    t.is(getMultipartField(edited.body, 'ephemeral_message_id'), 'eph-1')
    const media = JSON.parse(getMultipartField(edited.body, 'media'))
    t.is(media.type, 'photo')
    const attachment = /^attach:\/\/([0-9a-f]+)$/.exec(media.media)
    t.truthy(attachment)
    t.true(edited.body.includes(`name="${attachment[1]}"`))
    t.true(edited.body.includes('new-bytes'))
})

test('Context.ephemeralMessageId resolves from the current update', (t) => {
    const idOf = (update) => new Context(update, {}, botInfo).ephemeralMessageId

    t.is(idOf(callbackUpdate(ephemeralMessage)), 'eph-1')
    t.is(
        idOf({
            update_id: 3,
            message: { ...ephemeralMessage, ephemeral_message_id: 'eph-msg' },
        }),
        'eph-msg'
    )
    t.is(idOf(plainMessageUpdate), undefined)
    // inaccessible callback message (date 0) carries no ephemeral id
    t.is(
        idOf(callbackUpdate({ chat: privateChat, message_id: 12, date: 0 })),
        undefined
    )
    t.is(
        idOf({
            update_id: 4,
            inline_query: {
                id: 'iq',
                from: ephemeralUser,
                query: '',
                offset: '',
            },
        }),
        undefined
    )
})

test('Context ephemeral helpers default to the ephemeral message in the update', async (t) => {
    const { bold } = require('../format')
    const { telegram, calls } = recordingTelegram()
    const ctx = new Context(callbackUpdate(ephemeralMessage), telegram, botInfo)

    await ctx.editEphemeralMessageText('edited', {
        parse_mode: 'HTML',
        reply_markup: inlineMarkup,
    })
    await ctx.editEphemeralMessageCaption(bold('caption'), {
        show_caption_above_media: true,
    })
    await ctx.editEphemeralMessageMedia(
        { type: 'photo', media: 'photo-id', caption: 'plain' },
        { reply_markup: inlineMarkup }
    )
    await ctx.editEphemeralMessageReplyMarkup(inlineMarkup)
    await ctx.deleteEphemeralMessage()

    const target = { chat_id: 42, ephemeral_message_id: 'eph-1' }
    t.deepEqual(calls, [
        [
            'editEphemeralMessageText',
            {
                ...target,
                parse_mode: 'HTML',
                reply_markup: inlineMarkup,
                text: 'edited',
            },
        ],
        [
            'editEphemeralMessageCaption',
            {
                ...target,
                show_caption_above_media: true,
                caption: 'caption',
                caption_entities: boldEntities(7),
                parse_mode: undefined,
            },
        ],
        [
            'editEphemeralMessageMedia',
            {
                ...target,
                media: { type: 'photo', media: 'photo-id', caption: 'plain' },
                reply_markup: inlineMarkup,
            },
        ],
        [
            'editEphemeralMessageReplyMarkup',
            { ...target, reply_markup: inlineMarkup },
        ],
        ['deleteEphemeralMessage', target],
    ])
})

test('Context ephemeral helpers accept an explicit ephemeral message id', async (t) => {
    const { telegram, calls } = recordingTelegram()
    const fromEphemeral = new Context(
        callbackUpdate(ephemeralMessage),
        telegram,
        botInfo
    )
    const fromPlain = new Context(plainMessageUpdate, telegram, botInfo)
    const other = { ephemeral_message_id: 'eph-other' }

    for (const ctx of [fromEphemeral, fromPlain]) {
        await ctx.editEphemeralMessageText('text', { ...other })
        await ctx.editEphemeralMessageCaption('caption', { ...other })
        await ctx.editEphemeralMessageMedia(
            { type: 'photo', media: 'photo-id' },
            { ...other }
        )
        await ctx.editEphemeralMessageReplyMarkup(undefined, { ...other })
        await ctx.deleteEphemeralMessage('eph-other')
    }

    const target = { chat_id: 42, ephemeral_message_id: 'eph-other' }
    const expected = [
        ['editEphemeralMessageText', { ...target, text: 'text' }],
        ['editEphemeralMessageCaption', { ...target, caption: 'caption' }],
        [
            'editEphemeralMessageMedia',
            { ...target, media: { type: 'photo', media: 'photo-id' } },
        ],
        [
            'editEphemeralMessageReplyMarkup',
            { ...target, reply_markup: undefined },
        ],
        ['deleteEphemeralMessage', target],
    ]
    // the override wins over the update's id
    t.deepEqual(calls, [...expected, ...expected])

    // and is stripped from the extras handed to Telegram
    const extras = []
    const spy = (...args) => {
        extras.push(args.at(-1))
        return true
    }
    const spyCtx = new Context(
        callbackUpdate(ephemeralMessage),
        {
            editEphemeralMessageText: spy,
            editEphemeralMessageCaption: spy,
            editEphemeralMessageMedia: spy,
        },
        botInfo
    )
    await spyCtx.editEphemeralMessageText('text', {
        ...other,
        parse_mode: 'HTML',
    })
    await spyCtx.editEphemeralMessageCaption('caption', { ...other })
    await spyCtx.editEphemeralMessageMedia(
        { type: 'photo', media: 'photo-id' },
        { ...other }
    )
    t.deepEqual(extras, [{ parse_mode: 'HTML' }, {}, {}])
})

test('Context ephemeral helpers throw without a target and make no API call', (t) => {
    const { telegram, calls } = recordingTelegram()
    const invoke = {
        editEphemeralMessageText: (ctx, extra) =>
            ctx.editEphemeralMessageText('text', extra),
        editEphemeralMessageCaption: (ctx, extra) =>
            ctx.editEphemeralMessageCaption('caption', extra),
        editEphemeralMessageMedia: (ctx, extra) =>
            ctx.editEphemeralMessageMedia(
                { type: 'photo', media: 'photo-id' },
                extra
            ),
        editEphemeralMessageReplyMarkup: (ctx, extra) =>
            ctx.editEphemeralMessageReplyMarkup(inlineMarkup, extra),
        deleteEphemeralMessage: (ctx, extra) =>
            ctx.deleteEphemeralMessage(extra?.ephemeral_message_id),
    }
    t.deepEqual(
        Object.keys(invoke).sort(),
        [...EPHEMERAL_MANAGEMENT_METHODS].sort()
    )

    const noEphemeral = new Context(plainMessageUpdate, telegram, botInfo)
    const inaccessible = new Context(
        callbackUpdate({ chat: privateChat, message_id: 12, date: 0 }),
        telegram,
        botInfo
    )
    const noChat = new Context(
        {
            update_id: 5,
            inline_query: {
                id: 'iq',
                from: ephemeralUser,
                query: '',
                offset: '',
            },
        },
        telegram,
        botInfo
    )

    for (const [method, call] of Object.entries(invoke)) {
        t.throws(() => call(noEphemeral), {
            instanceOf: TypeError,
            message: `Telegraf: "${method}" isn't available for "message"`,
        })
        t.throws(() => call(inaccessible), {
            instanceOf: TypeError,
            message: `Telegraf: "${method}" isn't available for "callback_query"`,
        })
        // an explicit id cannot stand in for a missing chat
        t.throws(() => call(noChat, { ephemeral_message_id: 'eph-1' }), {
            instanceOf: TypeError,
            message: `Telegraf: "${method}" isn't available for "inline_query"`,
        })
    }
    t.deepEqual(calls, [])
})

// Every Telegram wrapper for a method whose Bot API args accept ephemeral_message_parameters
const telegramEphemeralSendCalls = {
    sendAnimation: (tg, extra) => tg.sendAnimation(42, 'animation-id', extra),
    sendAudio: (tg, extra) => tg.sendAudio(42, 'audio-id', extra),
    sendContact: (tg, extra) => tg.sendContact(42, '+100', 'Name', extra),
    sendDocument: (tg, extra) => tg.sendDocument(42, 'document-id', extra),
    sendLivePhoto: (tg, extra) =>
        tg.sendLivePhoto({
            chat_id: 42,
            photo: 'photo-id',
            video: Input.fromBuffer(Buffer.from('clip'), 'clip.mp4'),
            ...extra,
        }),
    sendLocation: (tg, extra) => tg.sendLocation(42, 1, 2, extra),
    sendMessage: (tg, extra) => tg.sendMessage(42, 'text', extra),
    sendPhoto: (tg, extra) => tg.sendPhoto(42, 'photo-id', extra),
    sendRichMessage: (tg, extra) =>
        tg.sendRichMessage({
            chat_id: 42,
            rich_message: { markdown: '*rich*' },
            ...extra,
        }),
    sendSticker: (tg, extra) => tg.sendSticker(42, 'sticker-id', extra),
    sendVenue: (tg, extra) => tg.sendVenue(42, 1, 2, 'Title', 'Address', extra),
    sendVideo: (tg, extra) => tg.sendVideo(42, 'video-id', extra),
    sendVideoNote: (tg, extra) => tg.sendVideoNote(42, 'note-id', extra),
    sendVoice: (tg, extra) => tg.sendVoice(42, 'voice-id', extra),
}

// Context helpers for the same methods; Bot API 10.x methods without a Context helper are listed explicitly
const contextEphemeralSendCalls = {
    sendAnimation: (ctx, extra) =>
        ctx.replyWithAnimation('animation-id', extra),
    sendAudio: (ctx, extra) => ctx.replyWithAudio('audio-id', extra),
    sendContact: (ctx, extra) => ctx.replyWithContact('+100', 'Name', extra),
    sendDocument: (ctx, extra) => ctx.replyWithDocument('document-id', extra),
    sendLocation: (ctx, extra) => ctx.replyWithLocation(1, 2, extra),
    sendMessage: (ctx, extra) => ctx.reply('text', extra),
    sendPhoto: (ctx, extra) => ctx.replyWithPhoto('photo-id', extra),
    sendSticker: (ctx, extra) => ctx.replyWithSticker('sticker-id', extra),
    sendVenue: (ctx, extra) =>
        ctx.replyWithVenue(1, 2, 'Title', 'Address', extra),
    sendVideo: (ctx, extra) => ctx.replyWithVideo('video-id', extra),
    sendVideoNote: (ctx, extra) => ctx.replyWithVideoNote('note-id', extra),
    sendVoice: (ctx, extra) => ctx.replyWithVoice('voice-id', extra),
}
const EPHEMERAL_SEND_METHODS_WITHOUT_CONTEXT_HELPER = [
    'sendLivePhoto',
    'sendRichMessage',
]

test('Bot API 10.3 ephemeral message fields are typed', (t) => {
    const files = {
        manage: readTypeFile('manage'),
        message: readTypeFile('message'),
        methods: readTypeFile('methods'),
    }
    const parameters = getInterface(files.manage, 'EphemeralMessageParameters')
    const management = Object.fromEntries(
        EPHEMERAL_MANAGEMENT_METHODS.map((method) => [
            method,
            getMethodArgs(files.methods, method),
        ])
    )
    const checks = {
        'EphemeralMessageParameters.receiver_user_id': hasField(
            parameters,
            'receiver_user_id',
            'number'
        ),
        'EphemeralMessageParameters.callback_query_id': hasOptionalField(
            parameters,
            'callback_query_id',
            'string'
        ),
        'EphemeralMessageParameters.replace_callback_query_message':
            hasOptionalField(
                parameters,
                'replace_callback_query_message',
                'boolean'
            ),
        'Message.ephemeral_message_id': hasOptionalField(
            getInterface(files.message, 'CommonMessage'),
            'ephemeral_message_id',
            'string'
        ),
        'ReplyParameters.ephemeral_message_id': hasOptionalField(
            getInterface(files.message, 'ReplyParameters'),
            'ephemeral_message_id',
            'string'
        ),
        'editEphemeralMessageText.link_preview_options': hasOptionalField(
            management.editEphemeralMessageText,
            'link_preview_options',
            'LinkPreviewOptions'
        ),
        'editEphemeralMessageMedia.media': hasField(
            management.editEphemeralMessageMedia,
            'media',
            'InputMedia<F>'
        ),
        'editEphemeralMessageCaption.show_caption_above_media':
            hasOptionalField(
                management.editEphemeralMessageCaption,
                'show_caption_above_media',
                'true'
            ),
        'editEphemeralMessageReplyMarkup.reply_markup': hasOptionalField(
            management.editEphemeralMessageReplyMarkup,
            'reply_markup',
            'InlineKeyboardMarkup'
        ),
        'InputMedia caption-less members': ['Location', 'Venue', 'Link'].every(
            (member) =>
                hasTypeMember(
                    files.methods,
                    'InputMedia<F>',
                    `InputMedia${member}`
                )
        ),
    }
    for (const method of EPHEMERAL_MANAGEMENT_METHODS) {
        checks[`${method}.chat_id`] = hasField(
            management[method],
            'chat_id',
            'number | string'
        )
        checks[`${method}.ephemeral_message_id`] = hasField(
            management[method],
            'ephemeral_message_id',
            'string'
        )
    }
    const missing = Object.entries(checks)
        .filter(([, ok]) => !ok)
        .map(([name]) => name)
    t.deepEqual(missing, [])
})

test('ephemeral_message_parameters coverage matches the Bot API types', (t) => {
    const typed = readMethodsAcceptingField('ephemeral_message_parameters')

    // fails when the types add or drop ephemeral support on a method
    t.deepEqual(Object.keys(telegramEphemeralSendCalls).sort(), typed)
    t.deepEqual(
        Object.keys(contextEphemeralSendCalls).sort(),
        typed.filter(
            (method) =>
                !EPHEMERAL_SEND_METHODS_WITHOUT_CONTEXT_HELPER.includes(method)
        )
    )
    // methods that must never gain the parameter by accident
    for (const method of [
        'sendMediaGroup',
        'sendPaidMedia',
        'copyMessage',
        'forwardMessage',
        'sendPoll',
        'sendDice',
        'sendInvoice',
        'sendGame',
    ]) {
        t.false(typed.includes(method), method)
    }
    // the management methods identify messages by ephemeral id, not by message_id
    t.deepEqual(
        readMethodsAcceptingField('ephemeral_message_id').filter((method) =>
            EPHEMERAL_MANAGEMENT_METHODS.includes(method)
        ),
        [...EPHEMERAL_MANAGEMENT_METHODS].sort()
    )
})

test('Telegram send wrappers forward ephemeral_message_parameters', async (t) => {
    for (const [method, call] of Object.entries(telegramEphemeralSendCalls)) {
        const { telegram, calls } = recordingTelegram()
        await call(telegram, { ephemeral_message_parameters: ephemeralParams })
        await call(telegram)

        t.is(calls.length, 2, method)
        const [[withMethod, withPayload], [withoutMethod, withoutPayload]] =
            calls
        t.is(withMethod, method)
        t.is(withoutMethod, method)
        t.is(withPayload.chat_id, 42, method)
        t.deepEqual(
            withPayload.ephemeral_message_parameters,
            ephemeralParams,
            method
        )
        // backward compatibility: no key is injected when the caller omits it
        t.false('ephemeral_message_parameters' in withoutPayload, method)
    }
})

test('Context send helpers forward ephemeral_message_parameters', async (t) => {
    for (const [method, call] of Object.entries(contextEphemeralSendCalls)) {
        const { telegram, calls } = recordingTelegram()
        const ctx = new Context(
            callbackUpdate(ephemeralMessage),
            telegram,
            botInfo
        )
        await call(ctx, {
            ephemeral_message_parameters: {
                receiver_user_id: ctx.from.id,
                callback_query_id: ctx.callbackQuery.id,
            },
        })
        await call(ctx)

        t.is(calls.length, 2, method)
        const [[withMethod, withPayload], [, withoutPayload]] = calls
        t.is(withMethod, method)
        t.is(withPayload.chat_id, 42, method)
        t.deepEqual(
            withPayload.ephemeral_message_parameters,
            ephemeralParams,
            method
        )
        t.false('ephemeral_message_parameters' in withoutPayload, method)
    }
})

test('Context send helpers combine ephemeral and business parameters', async (t) => {
    const { telegram, calls } = recordingTelegram()
    const ctx = new Context(
        {
            update_id: 6,
            business_message: {
                business_connection_id: 'biz-1',
                message_id: 12,
                date: 1,
                chat: privateChat,
                text: 'hello',
            },
        },
        telegram,
        botInfo
    )

    await ctx.reply('hi', { ephemeral_message_parameters: ephemeralParams })

    t.deepEqual(calls, [
        [
            'sendMessage',
            {
                chat_id: 42,
                message_thread_id: undefined,
                business_connection_id: 'biz-1',
                ephemeral_message_parameters: ephemeralParams,
                text: 'hi',
            },
        ],
    ])
})

test('pre-10.3 message methods keep their payloads', async (t) => {
    const { bold } = require('../format')
    const { telegram, calls } = recordingTelegram()
    const location = { type: 'location', latitude: 1, longitude: 2 }

    await telegram.sendMessage(42, 'hi')
    await telegram.sendPhoto(42, 'photo-id')
    await telegram.editMessageText(42, 12, undefined, 'edited')
    await telegram.editMessageCaption(42, 12, undefined, bold('caption'))
    await telegram.editMessageMedia(42, 12, undefined, {
        type: 'photo',
        media: 'photo-id',
        caption: bold('media'),
    })
    await telegram.editMessageMedia(42, 12, undefined, location)
    await telegram.editMessageReplyMarkup(42, 12, undefined, inlineMarkup)
    await telegram.deleteMessage(42, 12)

    const ctx = new Context(plainMessageUpdate, telegram, botInfo)
    await ctx.reply('reply')
    await ctx.deleteMessage()

    const message = {
        chat_id: 42,
        message_id: 12,
        inline_message_id: undefined,
    }
    t.deepEqual(calls, [
        ['sendMessage', { chat_id: 42, text: 'hi' }],
        ['sendPhoto', { chat_id: 42, photo: 'photo-id' }],
        [
            'editMessageText',
            {
                text: 'edited',
                entities: undefined,
                parse_mode: undefined,
                reply_markup: undefined,
                link_preview_options: undefined,
                business_connection_id: undefined,
                chat_id: 42,
                message_id: 12,
            },
        ],
        [
            'editMessageCaption',
            {
                ...message,
                caption: 'caption',
                caption_entities: boldEntities(7),
                parse_mode: undefined,
            },
        ],
        [
            'editMessageMedia',
            {
                ...message,
                media: {
                    type: 'photo',
                    media: 'photo-id',
                    caption: 'media',
                    caption_entities: boldEntities(5),
                    parse_mode: undefined,
                },
            },
        ],
        ['editMessageMedia', { ...message, media: location }],
        ['editMessageReplyMarkup', { ...message, reply_markup: inlineMarkup }],
        ['deleteMessage', { chat_id: 42, message_id: 12 }],
        [
            'sendMessage',
            {
                chat_id: 42,
                message_thread_id: undefined,
                business_connection_id: undefined,
                text: 'reply',
            },
        ],
        ['deleteMessage', { chat_id: 42, message_id: 13 }],
    ])
    for (const [, payload] of calls) {
        t.false('ephemeral_message_id' in payload)
        t.false('ephemeral_message_parameters' in payload)
    }
})

test('ephemeral message APIs are typed for Telegram and Context', (t) => {
    compileTypeScript(
        'ephemeral-types.ts',
        [
            `import { Context, Telegram } from '${packageRoot}'`,
            `import { bold } from '${packageRoot}/format'`,
            `import type { Convenience, EphemeralMessageParameters } from '${packageRoot}/types'`,
            '',
            'declare const ctx: Context',
            'declare const telegram: Telegram',
            'const ephemeral_message_parameters: EphemeralMessageParameters = {',
            '    receiver_user_id: 7,',
            '    callback_query_id: "cbq",',
            '    replace_callback_query_message: true,',
            '}',
            '',
            '// send helpers accept ephemeral parameters',
            'const replyExtra: Convenience.ExtraReplyMessage = { ephemeral_message_parameters }',
            'const photoExtra: Convenience.ExtraPhoto = { caption: bold("hi"), ephemeral_message_parameters }',
            'void ctx.reply("hi", replyExtra)',
            'void ctx.replyWithPhoto("photo", photoExtra)',
            'void ctx.sendDocument("doc", { ephemeral_message_parameters })',
            'void telegram.sendSticker(1, "s", { ephemeral_message_parameters })',
            'void telegram.sendVenue(1, 0, 0, "t", "a", { ephemeral_message_parameters })',
            'void telegram.sendRichMessage({ chat_id: 1, rich_message: { markdown: "*hi*" }, ephemeral_message_parameters })',
            '// @ts-expect-error receiver_user_id is required',
            'const missingReceiver: EphemeralMessageParameters = { callback_query_id: "cbq" }',
            '',
            '// methods without ephemeral support reject the parameter',
            '// @ts-expect-error sendMediaGroup',
            'void telegram.sendMediaGroup(1, [], { ephemeral_message_parameters })',
            '// @ts-expect-error copyMessage',
            'void telegram.copyMessage(1, 2, 3, { ephemeral_message_parameters })',
            '// @ts-expect-error forwardMessage',
            'void telegram.forwardMessage(1, 2, 3, { ephemeral_message_parameters })',
            '',
            '// management methods on Telegram',
            'const t1: Promise<true> = telegram.editEphemeralMessageText(1, "e", bold("x"), { link_preview_options: { is_disabled: true } })',
            'const t2: Promise<true> = telegram.editEphemeralMessageCaption("@channel", "e", undefined, { show_caption_above_media: true })',
            'const t3: Promise<true> = telegram.editEphemeralMessageMedia(1, "e", { type: "location", latitude: 0, longitude: 0 })',
            'const t4: Promise<true> = telegram.editEphemeralMessageReplyMarkup(1, "e", undefined)',
            'const t5: Promise<true> = telegram.deleteEphemeralMessage(1, "e")',
            '// @ts-expect-error the ephemeral id is positional on Telegram',
            'void telegram.editEphemeralMessageText(1, "e", "x", { ephemeral_message_id: "other" })',
            '// @ts-expect-error ephemeral message ids are strings',
            'void telegram.deleteEphemeralMessage(1, 5)',
            '',
            '// management helpers on Context',
            'const c1: Promise<true> = ctx.editEphemeralMessageText("x", { ephemeral_message_id: "other", parse_mode: "HTML" })',
            'const c2: Promise<true> = ctx.editEphemeralMessageCaption(bold("x"))',
            'const c3: Promise<true> = ctx.editEphemeralMessageMedia({ type: "photo", media: "id", caption: bold("x") })',
            'const c4: Promise<true> = ctx.editEphemeralMessageReplyMarkup(undefined, { ephemeral_message_id: "other" })',
            'const c5: Promise<true> = ctx.deleteEphemeralMessage()',
            'const currentId: string | undefined = ctx.ephemeralMessageId',
            '// @ts-expect-error text is positional',
            'void ctx.editEphemeralMessageText("x", { text: "y" })',
            '',
            '// pre-10.3 signatures keep compiling',
            'const legacyReply: Convenience.ExtraReplyMessage = { reply_parameters: { message_id: 1 } }',
            'void telegram.sendMessage(1, "hi", legacyReply)',
            'void telegram.sendPhoto(1, "photo", { caption: bold("x") })',
            'void telegram.editMessageText(1, 2, undefined, "hi")',
            'void telegram.editMessageMedia(1, 2, undefined, { type: "photo", media: "id", caption: bold("x") })',
            'void ctx.editMessageMedia({ type: "video", media: "id" })',
            'void ctx.deleteMessage()',
            '',
            'void [missingReceiver, t1, t2, t3, t4, t5, c1, c2, c3, c4, c5, currentId]',
        ].join('\n')
    )
    t.pass()
})

test('Bot API 9.4-9.6 changelog fields are typed', (t) => {
    const files = {
        manage: readTypeFile('manage'),
        markup: readTypeFile('markup'),
        message: readTypeFile('message'),
        methods: readTypeFile('methods'),
        update: readTypeFile('update'),
    }
    const blocks = {
        chatAdministratorRights: getInterface(
            files.manage,
            'ChatAdministratorRights'
        ),
        chatMemberAdministrator: getInterface(
            files.manage,
            'ChatMemberAdministrator'
        ),
        chatMemberMember: getInterface(files.manage, 'ChatMemberMember'),
        chatMemberRestricted: getInterface(
            files.manage,
            'ChatMemberRestricted'
        ),
        chatPermissions: getInterface(files.manage, 'ChatPermissions'),
        keyboardButtonRequestManagedBot: getInterface(
            files.markup,
            'KeyboardButtonRequestManagedBot'
        ),
        keyboardButtonRequestManagedBotVariant: getInterface(
            files.markup,
            'RequestManagedBot'
        ),
        managedBotCreated: getInterface(files.manage, 'ManagedBotCreated'),
        managedBotCreatedMessage: getInterface(
            files.message,
            'ManagedBotCreatedMessage'
        ),
        managedBotUpdated: getInterface(files.manage, 'ManagedBotUpdated'),
        messageCommon: getInterface(files.message, 'CommonMessage'),
        messageEntityDateTime: getInterface(files.message, 'DateTime'),
        poll: getInterface(files.message, 'Poll'),
        pollAnswer: getInterface(files.message, 'PollAnswer'),
        pollOption: getInterface(files.message, 'PollOption'),
        pollOptionAdded: getInterface(files.message, 'PollOptionAdded'),
        pollOptionAddedMessage: getInterface(
            files.message,
            'PollOptionAddedMessage'
        ),
        pollOptionDeleted: getInterface(files.message, 'PollOptionDeleted'),
        pollOptionDeletedMessage: getInterface(
            files.message,
            'PollOptionDeletedMessage'
        ),
        preparedKeyboardButton: getInterface(
            files.markup,
            'PreparedKeyboardButton'
        ),
        replyParameters: getInterface(files.message, 'ReplyParameters'),
        textQuote: getInterface(files.message, 'TextQuote'),
        updateManagedBot: getInterface(files.update, 'ManagedBotUpdate'),
        user: getInterface(files.manage, 'User'),
        userFromGetMe: getInterface(files.manage, 'UserFromGetMe'),
    }
    const methods = {
        getManagedBotToken: getMethodArgs(files.methods, 'getManagedBotToken'),
        getUserProfileAudios: getMethodArgs(
            files.methods,
            'getUserProfileAudios'
        ),
        giftPremiumSubscription: getMethodArgs(
            files.methods,
            'giftPremiumSubscription'
        ),
        promoteChatMember: getMethodArgs(files.methods, 'promoteChatMember'),
        replaceManagedBotToken: getMethodArgs(
            files.methods,
            'replaceManagedBotToken'
        ),
        savePreparedKeyboardButton: getMethodArgs(
            files.methods,
            'savePreparedKeyboardButton'
        ),
        sendGift: getMethodArgs(files.methods, 'sendGift'),
        sendPoll: getMethodArgs(files.methods, 'sendPoll'),
        setChatMemberTag: getMethodArgs(files.methods, 'setChatMemberTag'),
        setMyProfilePhoto: getMethodArgs(files.methods, 'setMyProfilePhoto'),
    }
    const checks = {
        'User.can_manage_bots absent': !hasAnyField(
            blocks.user,
            'can_manage_bots'
        ),
        'UserFromGetMe.can_manage_bots': hasOptionalField(
            blocks.userFromGetMe,
            'can_manage_bots',
            'boolean'
        ),
        'UserFromGetMe.allows_users_to_create_topics': hasOptionalField(
            blocks.userFromGetMe,
            'allows_users_to_create_topics',
            'boolean'
        ),
        KeyboardButtonRequestManagedBot:
            hasField(
                blocks.keyboardButtonRequestManagedBot,
                'request_id',
                'number'
            ) &&
            hasOptionalField(
                blocks.keyboardButtonRequestManagedBot,
                'suggested_name',
                'string'
            ) &&
            hasOptionalField(
                blocks.keyboardButtonRequestManagedBot,
                'suggested_username',
                'string'
            ),
        'KeyboardButton.request_managed_bot': hasField(
            blocks.keyboardButtonRequestManagedBotVariant,
            'request_managed_bot',
            'KeyboardButtonRequestManagedBot'
        ),
        ManagedBotCreated: hasField(blocks.managedBotCreated, 'bot', 'User'),
        'Message.managed_bot_created': hasField(
            blocks.managedBotCreatedMessage,
            'managed_bot_created',
            'ManagedBotCreated'
        ),
        ManagedBotUpdated:
            hasField(blocks.managedBotUpdated, 'user', 'User') &&
            hasField(blocks.managedBotUpdated, 'bot', 'User'),
        'Update.managed_bot': hasField(
            blocks.updateManagedBot,
            'managed_bot',
            'ManagedBotUpdated'
        ),
        PreparedKeyboardButton: hasField(
            blocks.preparedKeyboardButton,
            'id',
            'string'
        ),
        'getManagedBotToken.user_id': hasField(
            methods.getManagedBotToken,
            'user_id',
            'number'
        ),
        'replaceManagedBotToken.user_id': hasField(
            methods.replaceManagedBotToken,
            'user_id',
            'number'
        ),
        'savePreparedKeyboardButton.button': compact(
            methods.savePreparedKeyboardButton
        ).includes(
            'button: KeyboardButton.RequestUsers | KeyboardButton.RequestChat | KeyboardButton.RequestManagedBot;'
        ),
        'Poll.correct_option_ids': hasOptionalField(
            blocks.poll,
            'correct_option_ids',
            'number[]'
        ),
        'sendPoll.correct_option_ids': hasOptionalField(
            methods.sendPoll,
            'correct_option_ids',
            'number[]'
        ),
        'sendPoll.allows_revoting': hasOptionalField(
            methods.sendPoll,
            'allows_revoting',
            'boolean'
        ),
        'sendPoll.shuffle_options': hasOptionalField(
            methods.sendPoll,
            'shuffle_options',
            'boolean'
        ),
        'sendPoll.allow_adding_options': hasOptionalField(
            methods.sendPoll,
            'allow_adding_options',
            'boolean'
        ),
        'sendPoll.hide_results_until_closes': hasOptionalField(
            methods.sendPoll,
            'hide_results_until_closes',
            'boolean'
        ),
        'sendPoll.description':
            hasOptionalField(methods.sendPoll, 'description', 'string') &&
            hasOptionalField(
                methods.sendPoll,
                'description_entities',
                'MessageEntity[]'
            ),
        'PollOption.persistent_id': hasField(
            blocks.pollOption,
            'persistent_id',
            'string'
        ),
        'PollAnswer.option_persistent_ids': hasField(
            blocks.pollAnswer,
            'option_persistent_ids',
            'string[]'
        ),
        'PollOption.added_by_user':
            hasOptionalField(blocks.pollOption, 'added_by_user', 'User') &&
            hasOptionalField(blocks.pollOption, 'added_by_chat', 'Chat') &&
            hasOptionalField(blocks.pollOption, 'addition_date', 'number'),
        PollOptionAdded:
            hasOptionalField(
                blocks.pollOptionAdded,
                'poll_message',
                'MaybeInaccessibleMessage'
            ) &&
            hasField(blocks.pollOptionAdded, 'option_persistent_id', 'string'),
        'Message.poll_option_added': hasField(
            blocks.pollOptionAddedMessage,
            'poll_option_added',
            'PollOptionAdded'
        ),
        PollOptionDeleted:
            hasOptionalField(
                blocks.pollOptionDeleted,
                'poll_message',
                'MaybeInaccessibleMessage'
            ) &&
            hasField(
                blocks.pollOptionDeleted,
                'option_persistent_id',
                'string'
            ),
        'Message.poll_option_deleted': hasField(
            blocks.pollOptionDeletedMessage,
            'poll_option_deleted',
            'PollOptionDeleted'
        ),
        'ReplyParameters.poll_option_id': hasOptionalField(
            blocks.replyParameters,
            'poll_option_id',
            'string'
        ),
        'Message.reply_to_poll_option_id': hasOptionalField(
            blocks.messageCommon,
            'reply_to_poll_option_id',
            'string'
        ),
        'MessageEntity.date_time':
            hasField(blocks.messageEntityDateTime, 'type', '"date_time"') &&
            hasOptionalField(
                blocks.messageEntityDateTime,
                'unix_time',
                'number'
            ) &&
            hasOptionalField(
                blocks.messageEntityDateTime,
                'date_time_format',
                'string'
            ) &&
            hasTypeMember(
                files.message,
                'MessageEntity',
                'MessageEntity.DateTime'
            ),
        'TextQuote date_time entities': hasOptionalField(
            blocks.textQuote,
            'entities',
            'MessageEntity[]'
        ),
        'ReplyParameters date_time entities': hasOptionalField(
            blocks.replyParameters,
            'quote_entities',
            'MessageEntity[]'
        ),
        'Gift text date_time entities':
            hasOptionalField(
                methods.sendGift,
                'text_entities',
                'MessageEntity[]'
            ) &&
            hasOptionalField(
                methods.giftPremiumSubscription,
                'text_entities',
                'MessageEntity[]'
            ),
        'Checklist date_time entities':
            hasTypeMember(
                files.message,
                'MessageEntity',
                'MessageEntity.DateTime'
            ) &&
            getInterface(files.message, 'InputChecklistTask').includes(
                'MessageEntity.DateTime'
            ) &&
            getInterface(files.message, 'InputChecklist').includes(
                'MessageEntity.DateTime'
            ),
        'ChatMemberMember.tag': hasOptionalField(
            blocks.chatMemberMember,
            'tag',
            'string'
        ),
        'ChatMemberRestricted.tag': hasOptionalField(
            blocks.chatMemberRestricted,
            'tag',
            'string'
        ),
        'ChatMemberRestricted.can_edit_tag': hasField(
            blocks.chatMemberRestricted,
            'can_edit_tag',
            'boolean'
        ),
        'ChatPermissions.can_edit_tag': hasOptionalField(
            blocks.chatPermissions,
            'can_edit_tag',
            'boolean'
        ),
        'ChatAdministratorRights.can_manage_tags': hasOptionalField(
            blocks.chatAdministratorRights,
            'can_manage_tags',
            'boolean'
        ),
        'ChatMemberAdministrator.can_manage_tags': hasOptionalField(
            blocks.chatMemberAdministrator,
            'can_manage_tags',
            'boolean'
        ),
        'promoteChatMember.can_manage_tags': hasOptionalField(
            methods.promoteChatMember,
            'can_manage_tags',
            'boolean'
        ),
        'setChatMemberTag.tag':
            hasField(methods.setChatMemberTag, 'chat_id', 'number | string') &&
            hasField(methods.setChatMemberTag, 'user_id', 'number') &&
            hasOptionalField(methods.setChatMemberTag, 'tag', 'string'),
        'Message.sender_tag': hasOptionalField(
            blocks.messageCommon,
            'sender_tag',
            'string'
        ),
        'KeyboardButton icon and style':
            hasOptionalField(
                getInterface(files.markup, 'AbstractInlineKeyboardButton'),
                'icon_custom_emoji_id',
                'string'
            ) &&
            hasOptionalField(
                getInterface(files.markup, 'Common'),
                'style',
                '"danger" | "success" | "primary"'
            ),
        'ChatOwnerLeft/Changed':
            hasField(
                getInterface(files.message, 'ChatOwnerLeftMessage'),
                'chat_owner_left',
                'ChatOwnerLeft'
            ) &&
            hasField(
                getInterface(files.message, 'ChatOwnerChangedMessage'),
                'chat_owner_changed',
                'ChatOwnerChanged'
            ),
        VideoQuality:
            hasField(
                getInterface(files.message, 'VideoQuality'),
                'codec',
                'string'
            ) &&
            hasOptionalField(
                getInterface(files.message, 'Video'),
                'qualities',
                'VideoQuality[]'
            ),
        'ChatFullInfo.first_profile_audio': hasOptionalField(
            files.manage,
            'first_profile_audio',
            'Audio'
        ),
        UserProfileAudios:
            hasField(
                getInterface(files.manage, 'UserProfileAudios'),
                'audios',
                'Audio[]'
            ) && hasField(methods.getUserProfileAudios, 'user_id', 'number'),
        'setMyProfilePhoto.photo': hasField(
            methods.setMyProfilePhoto,
            'photo',
            'InputProfilePhoto<F>'
        ),
        'UniqueGiftModel.rarity': hasOptionalField(
            getInterface(files.manage, 'UniqueGiftModel'),
            'rarity',
            '"uncommon" | "rare" | "epic" | "legendary"'
        ),
        'UniqueGift.is_burned': hasOptionalField(
            getInterface(files.manage, 'UniqueGift'),
            'is_burned',
            'true'
        ),
    }
    const missing = Object.entries(checks)
        .filter(([, ok]) => !ok)
        .map(([name]) => name)
    t.deepEqual(missing, [])
})

test('multipart form data serializes nested input files', async (t) => {
    let resolveRequest
    const request = new Promise((resolve) => {
        resolveRequest = resolve
    })
    const server = http.createServer((req, res) => {
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
            resolveRequest({
                url: req.url,
                headers: req.headers,
                body: Buffer.concat(chunks).toString('utf8'),
            })
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: true, result: true }))
            server.close()
        })
    })

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    const telegram = new Telegram('123:abc', {
        apiRoot: `http://127.0.0.1:${port}`,
    })

    await telegram.setMyProfilePhoto({
        photo: {
            type: 'static',
            photo: Input.fromBuffer(Buffer.from('avatar-bytes'), 'avatar.png'),
        },
    })

    const captured = await request
    t.is(captured.url, '/bot123:abc/setMyProfilePhoto')
    t.regex(captured.headers['content-type'], /^multipart\/form-data/)
    const attachment = captured.body.match(/"photo":"attach:\/\/([0-9a-f]+)"/)
    t.truthy(attachment)
    t.true(captured.body.includes(`name="${attachment[1]}"`))
    t.true(captured.body.includes('filename="avatar.png"'))
    t.true(captured.body.includes('avatar-bytes'))
})

test('custom fetch is used for Bot API calls', async (t) => {
    let captured
    const telegram = new Telegram('123:abc', {
        fetch: async (url, init) => {
            captured = { url, init }
            return {
                status: 200,
                statusText: 'OK',
                json: async () => ({
                    ok: true,
                    result: { id: 42, is_bot: true, first_name: 'Bot' },
                }),
            }
        },
    })

    const result = await telegram.getMe()

    t.is(String(captured.url), 'https://api.telegram.org/bot123:abc/getMe')
    t.is(captured.init.method, 'POST')
    t.deepEqual(JSON.parse(captured.init.body), {})
    t.deepEqual(result, { id: 42, is_bot: true, first_name: 'Bot' })
})

test('custom fetch is used for URL attachments', async (t) => {
    const calls = []
    let botApiInit
    const telegram = new Telegram('123:abc', {
        fetch: async (url, init) => {
            calls.push(String(url))
            if (String(url) === 'https://example.test/avatar.png') {
                return {
                    status: 200,
                    statusText: 'OK',
                    body: new ReadableStream({
                        start(controller) {
                            controller.enqueue(Buffer.from('image-bytes'))
                            controller.close()
                        },
                    }),
                    json: async () => ({ ok: true, result: true }),
                }
            }
            botApiInit = init
            return {
                status: 200,
                statusText: 'OK',
                json: async () => ({ ok: true, result: true }),
            }
        },
    })

    await telegram.sendPhoto(
        1,
        Input.fromURLStream('https://example.test/avatar.png')
    )

    t.deepEqual(calls, [
        'https://example.test/avatar.png',
        'https://api.telegram.org/bot123:abc/sendPhoto',
    ])
    t.is(botApiInit.method, 'POST')
    t.is(botApiInit.duplex, 'half')
    t.regex(botApiInit.headers['content-type'], /^multipart\/form-data/)
})

test('request timeout aborts fetch calls', async (t) => {
    const telegram = new Telegram('123:abc', {
        requestTimeout: 1,
        fetch: async (_url, init) =>
            await new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => {
                    const err = new Error('aborted')
                    err.name = 'AbortError'
                    reject(err)
                })
            }),
    })

    const err = await t.throwsAsync(telegram.getMe())
    t.true(err instanceof TelegrafNetworkError)
    t.is(err.code, undefined)
    t.is(err.errorName, 'AbortError')
    t.false(err.transient)
    t.is(err.cause.name, 'AbortError')
})

test('fetch errors use safe network error boundary', async (t) => {
    class FetchLikeError extends Error {
        constructor(message, options) {
            super(message, options)
            this.name = 'FetchLikeError'
            this.code = 'ECONNRESET'
        }
    }

    const cause = new Error('root cause')
    const err = new FetchLikeError(
        'request to https://api.telegram.org/bot123:secret/getMe failed',
        { cause }
    )
    err.stack = `${err.name}: ${err.message}\n    at userland.js:1:1`

    const telegram = new Telegram('123:secret', {
        fetch: async () => {
            throw err
        },
    })

    const thrown = await t.throwsAsync(telegram.getMe())
    t.true(thrown instanceof TelegrafNetworkError)
    t.false(thrown instanceof FetchLikeError)
    t.is(thrown.name, 'TelegrafNetworkError')
    t.is(thrown.code, 'ECONNRESET')
    t.is(thrown.errorName, 'FetchLikeError')
    t.true(thrown.transient)
    t.is(thrown.method, 'getMe')
    t.deepEqual(thrown.request, {
        method: 'getMe',
        apiRoot: 'https://api.telegram.org',
        apiMode: 'bot',
        testEnv: false,
    })
    t.true(thrown.message.includes('[REDACTED]'))
    t.false(thrown.message.includes('secret'))
    t.false(thrown.stack.includes('secret'))
    t.is(thrown.cause.name, 'FetchLikeError')
    t.is(thrown.cause.code, 'ECONNRESET')
    thrown.cause.code = 'CHANGED'
    t.is(thrown.cause.code, 'CHANGED')
    t.true(thrown.cause.message.includes('[REDACTED]'))
    t.false(thrown.cause.message.includes('secret'))
    t.false(thrown.cause.stack.includes('secret'))
    t.is(thrown.cause.cause.message, cause.message)
    t.true(err.message.includes('secret'))

    const inspected = util.inspect(thrown, { depth: 5 })
    t.false(inspected.includes('secret'))
})

test('native fetch errors use safe network error boundary', async (t) => {
    const err = new DOMException(
        'request to https://api.telegram.org/bot123:secret/getMe failed',
        'AbortError'
    )

    const telegram = new Telegram('123:secret', {
        fetch: async () => {
            throw err
        },
    })

    const thrown = await t.throwsAsync(telegram.getMe())
    t.true(thrown instanceof TelegrafNetworkError)
    t.false(thrown instanceof DOMException)
    t.is(thrown.name, 'TelegrafNetworkError')
    t.is(thrown.code, 20)
    t.is(thrown.errorName, 'AbortError')
    t.false(thrown.transient)
    t.true(thrown.message.includes('[REDACTED]'))
    t.false(thrown.message.includes('secret'))
    t.false(thrown.stack.includes('secret'))
    t.is(thrown.cause.name, 'AbortError')
    t.true(thrown.cause.message.includes('[REDACTED]'))
    t.false(thrown.cause.message.includes('secret'))
    t.false(thrown.cause.stack.includes('secret'))
    t.true(err.message.includes('secret'))

    const inspected = util.inspect(thrown, { depth: 5 })
    t.false(inspected.includes('secret'))
})

test('plain object fetch errors are sanitized before exposure', async (t) => {
    const err = {
        message:
            'request to https://api.telegram.org/bot123:secret/getMe failed',
        stack: 'Error: https://api.telegram.org/bot123:secret/getMe',
        details: {
            url: 'https://api.telegram.org/bot123:secret/getMe',
        },
        self: undefined,
    }
    err.self = err

    const telegram = new Telegram('123:secret', {
        fetch: async () => {
            throw err
        },
    })

    const thrown = await t.throwsAsync(telegram.getMe())
    t.true(thrown instanceof TelegrafNetworkError)
    t.true(thrown.message.includes('[REDACTED]'))
    t.false(thrown.message.includes('secret'))
    t.true(thrown.cause.message.includes('[REDACTED]'))
    t.true(thrown.cause.details.url.includes('[REDACTED]'))
    t.is(thrown.cause.self, '[Circular]')

    const inspected = util.inspect(thrown, { depth: 5 })
    t.false(inspected.includes('secret'))
})

test('native fetch is accepted as telegram fetch type', (t) => {
    compileTypeScript(
        'native-fetch.ts',
        [
            `import { Telegraf } from '${packageRoot}'`,
            '',
            'new Telegraf("token", {',
            '  telegram: {',
            '    fetch: globalThis.fetch,',
            '  },',
            '})',
        ].join('\n')
    )
    t.pass()
})

test('scene helper types are exported and infer state', (t) => {
    compileTypeScript(
        'scene-types.ts',
        [
            `import { Context, Scenes } from '${packageRoot}'`,
            '',
            'interface MySceneSession extends Scenes.SceneSessionData {',
            '  state?: { lastMessageId?: number }',
            '}',
            '',
            'interface MyContext extends Context {',
            '  session: Scenes.SceneSession<MySceneSession>',
            '  scene: Scenes.SceneContextScene<MyContext, MySceneSession>',
            '}',
            '',
            'class CustomSceneContext extends Scenes.SceneContextScene<',
            '  MyContext,',
            '  MySceneSession',
            '> {',
            '  get ttl() {',
            '    return this.options.ttl',
            '  }',
            '}',
            '',
            'const options: Scenes.SceneOptions<MyContext> = {',
            '  handlers: [],',
            '  enterHandlers: [],',
            '  leaveHandlers: [],',
            '}',
            'void options',
            '',
            'declare const ctx: MyContext',
            'ctx.scene.state.lastMessageId = 1',
            'ctx.scene.enter("next", { lastMessageId: 2 })',
            'void CustomSceneContext',
        ].join('\n')
    )
    t.pass()
})
