> **Note:** Sorry for the lack of updates this summer! Development is temporarily paused until September 2026. Read the full status update in [Discussions](https://github.com/telegraf-hardened/telegraf-hardened/discussions/29).

<header>

<div align="center">
<img src="https://raw.githubusercontent.com/telegraf-hardened/telegraf-docs/master/assets/logo.svg" alt="logo" height="90" align="center">

<h1 align="center">
Telegraf-hardened - Community-led fork of Telegraf.js. Focusing on stability, strict TypeScript types, and integrating critical community PRs that were abandoned by upstream. 
</h1>

<p>Modern Telegram Bot API framework for Node.js</p>

<a href="https://core.telegram.org/bots/api">   
    <img src="https://img.shields.io/badge/Bot%20API-v9.6-f36caf.svg?style=flat-square" alt="Bot API Version" />
</a>
</div>

</header>

## ❤️ Special Thanks

This fork exists and improves thanks to the amazing contributors:
-   **[@Leask](https://github.com/Leask)** - Full Bot API 9.6 sync, modernization of the entire network stack, and bulletproof API-sync testing.
-   **[@BataevDaniil](https://github.com/BataevDaniil)** - Architect of the `custom-fetch` feature.
-   **[@clansty](https://github.com/clansty)** - Critical JSON serialization and thumbnail fixes.
-   **[@coolcat-lox](https://github.com/coolcat-lox)** - For proactive porting of community improvements.

## 🛠 Roadmap & Community Fixes

### 🎯 Current Status: v3 Strategic Roadmap Fully Closed ✅

Version: 🚀 **v6.0.0 Stable** | 🛡 **Hardened** | API Full 9.6
Closed Roadmaps:

-   **[Strategic Roadmap v1](https://github.com/telegraf-hardened/telegraf-hardened/issues/1)**
-   **[Roadmap v2](https://github.com/telegraf-hardened/telegraf-hardened/issues/15)**
-   **[Roadmap v3](https://github.com/telegraf-hardened/telegraf-hardened/issues/20)**

API 10.0 planned

We have successfully integrated all planned critical improvements from the community that were abandoned by the official Telegraf upstream. **Telegraf-hardened is now a feature-complete and stable alternative.**

<!-- Check our current active Roadmap **[Roadmap v3](https://github.com/telegraf-hardened/telegraf-hardened/issues/20)** -->

### Key Improvements in this Fork already done:

-   🛠 **Future:** Even stricter type validation & community-requested features.
-   ✅ **Resilience: 409 Conflict Retry:**
    -   Optional exponential backoff for `getUpdates` requests.
    -   Prevents bot crash-loops during Docker/PM2 restarts when the previous connection is still active.
    -   Opt-in via `bot.launch({ polling: { retryOnConflict: true } })`.
-   ✅ **Native Telegram Stars, Gifts, and Business Support (API 9.6):**
    -   `getUserGifts()` — Fetch the list of gifts received by a user.
    -   Full support for digital goods, star transactions, gifts, paid media, and business account methods.
    -   `sendPaidMedia()` — Send exclusive content for stars.
    -   `getStarTransactions()` — Built-in business logic for tracking star revenue.
    -   `refundStarPayment()` — Native refund support for star-based transactions.
-   ✅ **Zero-Dependency Network Layer:** Completely dropped `node-fetch` and `abort-controller`. Now using native **Node.js 18+ Fetch API** for maximum performance and security.
-   ✅ **Fail-Fast Security:** Integrated token validation and strict error handling to prevent state leaks.
-   ✅ **Community PRs:** Already merged some critical fixes from the community.
-   **New Features**
    -   **bot.validateTokenAsync()**
        Performs an actual network request to Telegram via getMe to verify the token and pre-populate botInfo.
        Throws a descriptive 401 Unauthorized error if the token is revoked or invalid.
        Automatically populates bot.botInfo on success.
-   ✅ **Native SOCKS5/TOR Support:** Built-in support for SOCKS4/5 and Tor proxies using `undici` and `socks`. No more external fetch-wrappers needed.

**Are you a Telegraf contributor?** If your PR is ignored upstream, [resubmit it here](https://github.com/telegraf-hardened/telegraf-hardened/issues/20)!

## ⚠️ Breaking Changes

## Class methods

#### **Telegraf Constructor (Fail-Fast Validation)**

-   **Change**: Added synchronous token validation directly in the constructor.
-   **Impact**: If you pass `undefined`, an empty string, or a malformed token (missing `:`), the constructor will now **throw an Error immediately**.
-   **Reason**: In original Telegraf, a bot could be instantiated with an invalid token and only fail much later during `launch()` or the first API call. We catch this at the earliest possible stage.

### Telegram API Methods

#### **setStickerSetThumbnail**

Method signature updated to align with the latest Bot API requirements.

-   **New parameter**: `format` (mandatory) is now required as the third argument.
-   **Before**: `telegram.setStickerSetThumbnail(name, userId, thumbnail)`
-   **After**: `telegram.setStickerSetThumbnail(name, userId, format, thumbnail)`
-   **Reason**: Telegram Bot API now strictly distinguishes between sticker formats (`static`, `animated`, `video`) for thumbnails.

#### **editMessageText** (Strict Mode)

-   **Change**: The method now uses a Discriminated Union for parameters.
-   **Impact**: You can no longer pass both `chat_id` and `inline_message_id` simultaneously (even as `undefined`). TypeScript will now enforce either the "Chat" signature or the "Inline" signature, preventing 400 Bad Request errors at compile time.

## Introduction

Bots are special [Telegram](https://telegram.org) accounts designed to handle messages automatically.
Users can interact with bots by sending them command messages in private or group chats.
These accounts serve as an interface for code running somewhere on your server.

Telegraf is a library that makes it simple for you to develop your own Telegram bots using JavaScript or [TypeScript](https://www.typescriptlang.org/).

## 🔌 Proxy Support (SOCKS/HTTP)

Telegraf-hardened supports SOCKS4, SOCKS5 (including Tor), and HTTP proxies out of the box.

```js
const { Telegraf } = require('telegraf-hardened')
const { FetchClient } = require('@telegraf-hardened/fetch') // Install this separately

const bot = new Telegraf(process.env.BOT_TOKEN, {
    telegram: {
        proxy: {
            proxy: 'socks5://127.0.0.1:9050',
            FetchClient: FetchClient, // Injecting the client class
        },
    },
})

// For authenticated proxies:
// proxy: '[http://user:pass@1.2.3.4:8080](http://user:pass@1.2.3.4:8080)'
```

### Features

-   Full [Telegram Bot API 9.6](https://core.telegram.org/bots/api) support
-   [Excellent TypeScript typings](https://github.com/telegraf-hardened/telegraf-hardened/releases/tag/v5.0.0-beta.3)
-   Lightweight: compare with [node-telegram-bot-api](https://packagephobia.com/result?p=telegraf-hardened,node-telegram-bot-api) or [original telegraf](https://packagephobia.com/result?p=telegraf-hardened,telegraf)
-   [AWS **λ**](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html)
    / [Firebase](https://firebase.google.com/products/functions/)
    / [Glitch](https://glitch.com/edit/#!/dashing-light)
    / [Fly.io](https://fly.io/docs/languages-and-frameworks/node)
    / Whatever ready
-   `http/https/fastify/Connect.js/express.js` compatible webhooks
-   Extensible

## 📖 Documentation

The complete documentation for `telegraf-hardened` is available at:
👉 **[telegraf-hardened/telegraf-docs](https://github.com/telegraf-hardened/telegraf-docs)** > _Note: We are currently updating the docs to include all the new Hardened features like Native Fetch, Telegram Stars, Gifts, and Business APIs._

### Example

```js
const { Telegraf } = require('telegraf-hardened')
const { message } = require('telegraf-hardened/filters')

const bot = new Telegraf(process.env.BOT_TOKEN)

;(async () => {
    await bot.validateTokenAsync()
    bot.start((ctx) => ctx.reply('Welcome'))
    bot.help((ctx) => ctx.reply('Send me a sticker'))
    bot.on(message('sticker'), (ctx) => ctx.reply('👍'))
    bot.hears('hi', (ctx) => ctx.reply('Hey there'))
    // Example: Sending paid media (Bot API 9.6)
    bot.command('vip', (ctx) => {
        return ctx.telegram.sendPaidMedia(ctx.chat.id, 50, [
            {
                type: 'photo',
                media: Input.fromLocalFile('./premium_content.jpg'),
            },
        ])
    })
    bot.command('my_gifts', async (ctx) => {
        const { total_count, gifts } = await ctx.telegram.getUserGifts(
            ctx.from.id
        )
        return ctx.reply(`You have ${total_count} gifts!`)
    п   })
    bot.launch()
})()

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
```

```js
const { Telegraf } = require('telegraf-hardened')

const bot = new Telegraf(process.env.BOT_TOKEN)(async () => {
    await bot.validateTokenAsync()
    bot.command('oldschool', (ctx) => ctx.reply('Hello'))
    bot.command('hipster', Telegraf.reply('λ'))
    bot.launch({
        polling: {
        retryOnConflict: true, // Enable exponential backoff on 409 errors
        maxRetryDelay: 30000,  // Cap retry delay at 30 seconds (default 60s)
    },
    )
})()

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
```

<!-- ### Resources

- [Getting started](#getting-started)
- [API reference](https://telegraf.js.org/modules.html)
- Telegram groups (sorted by number of members):
  - [English](https://t.me/TelegrafJSChat)
  - [Russian](https://t.me/telegrafjs_ru)
  - [Uzbek](https://t.me/botjs_uz)
  - [Ethiopian](https://t.me/telegraf_et)
- [GitHub Discussions](https://github.com/telegraf/telegraf/discussions)
- [Dependent repositories](https://libraries.io/npm/telegraf/dependent_repositories) -->

## Getting started

### Telegram token

To use the [Telegram Bot API](https://core.telegram.org/bots/api),
you first have to [get a bot account](https://core.telegram.org/bots)
by [chatting with BotFather](https://core.telegram.org/bots#6-botfather).

BotFather will give you a _token_, something like `123456789:AbCdefGhIJKlmNoPQRsTUVwxyZ`.

### Installation

```shellscript
$ npm install telegraf-hardened
```

<!--
or

```shellscript
$ yarn add telegraf
```

or

```shellscript
$ pnpm add telegraf
``` -->

### `Telegraf` class

[`Telegraf`] instance represents your bot. It's responsible for obtaining updates and passing them to your handlers.

Start by [listening to commands](https://telegraf.js.org/classes/Telegraf-1.html#command) and [launching](https://telegraf.js.org/classes/Telegraf-1.html#launch) your bot.

### `Context` class

`ctx` you can see in every example is a [`Context`] instance.
[`Telegraf`] creates one for each incoming update and passes it to your middleware.
It contains the `update`, `botInfo`, and `telegram` for making arbitrary Bot API requests,
as well as shorthand methods and getters.

This is probably the class you'll be using the most.

<!--
TODO: Verify and update list
Here is a list of

#### Known middleware

- [Internationalization](https://github.com/telegraf/telegraf-i18n)—simplifies selecting the right translation to use when responding to a user.
- [Redis powered session](https://github.com/telegraf/telegraf-session-redis)—store session data using Redis.
- [Local powered session (via lowdb)](https://github.com/RealSpeaker/telegraf-session-local)—store session data in a local file.
- [Rate-limiting](https://github.com/telegraf/telegraf-ratelimit)—apply rate limitting to chats or users.
- [Bottleneck powered throttling](https://github.com/KnightNiwrem/telegraf-throttler)—apply throttling to both incoming updates and outgoing API calls.
- [Menus via inline keyboards](https://github.com/EdJoPaTo/telegraf-inline-menu)—simplify creating interfaces based on menus.
- [Stateless Questions](https://github.com/EdJoPaTo/telegraf-stateless-question)—create stateless questions to Telegram users working in privacy mode.
- [Natural language processing via wit.ai](https://github.com/telegraf/telegraf-wit)
- [Natural language processing via recast.ai](https://github.com/telegraf/telegraf-recast)
- [Multivariate and A/B testing](https://github.com/telegraf/telegraf-experiments)—add experiments to see how different versions of a feature are used.
- [Powerfull bot stats via Mixpanel](https://github.com/telegraf/telegraf-mixpanel)
- [statsd integration](https://github.com/telegraf/telegraf-statsd)
- [and more...](https://www.npmjs.com/search?q=telegraf-)
-->

#### Shorthand methods

```js
import { Telegraf } from 'telegraf-hardened'
import { message } from 'telegraf-hardened/filters'

const bot = new Telegraf(process.env.BOT_TOKEN)

bot.command('quit', async (ctx) => {
    // Explicit usage
    await ctx.telegram.leaveChat(ctx.message.chat.id)

    // Using context shortcut
    await ctx.leaveChat()
})

bot.on(message('text'), async (ctx) => {
    // Explicit usage
    await ctx.telegram.sendMessage(
        ctx.message.chat.id,
        `Hello ${ctx.state.role}`
    )

    // Using context shortcut
    await ctx.reply(`Hello ${ctx.state.role}`)
})

bot.on('callback_query', async (ctx) => {
    // Explicit usage
    await ctx.telegram.answerCbQuery(ctx.callbackQuery.id)

    // Using context shortcut
    await ctx.answerCbQuery()
})

bot.on('inline_query', async (ctx) => {
    const result = []
    // Explicit usage
    await ctx.telegram.answerInlineQuery(ctx.inlineQuery.id, result)

    // Using context shortcut
    await ctx.answerInlineQuery(result)
})

bot.launch({
    polling: {
        retryOnConflict: true, // Enable exponential backoff on 409 errors
        maxRetryDelay: 30000, // Cap retry delay at 30 seconds (default 60s)
    },
})

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
```

## Production

### Production Resilience (Long Polling)

In production environments (Docker, PM2, K8s), a quick restart might trigger a `409: Conflict` error because Telegram keeps the previous connection open for a short timeout. Telegraf-hardened can handle this automatically:

```ts
bot.launch({
  polling: {
    retryOnConflict: true, // Enable exponential backoff on 409 errors
    maxRetryDelay: 30000,  // Cap retry delay at 30 seconds (default 60s)
  },
});
```

### Webhooks

```TS
import { Telegraf } from "telegraf-hardened";
import { message } from 'telegraf-hardened/filters';

const bot = new Telegraf(token);

bot.on(message("text"), ctx => ctx.reply("Hello"));

// Start webhook via launch method (preferred)
bot.launch({
  webhook: {
    // Public domain for webhook; e.g.: example.com
    domain: webhookDomain,

    // Port to listen on; e.g.: 8080
    port: port,

    // Optional path to listen for.
    // `bot.secretPathComponent()` will be used by default
    path: webhookPath,

    // Optional secret to be sent back in a header for security.
    // e.g.: `crypto.randomBytes(64).toString("hex")`
    secretToken: randomAlphaNumericString,
  },
});
```

Use `createWebhook()` if you want to attach Telegraf to an existing http server.

<!-- global bot, tlsOptions -->

```TS
import { createServer } from "http";

createServer(await bot.createWebhook({ domain: "example.com" })).listen(3000);
```

```TS
import { createServer } from "https";

createServer(tlsOptions, await bot.createWebhook({ domain: "example.com" })).listen(8443);
```

-   [AWS Lambda example integration](https://github.com/feathers-studio/telegraf-docs/tree/master/examples/functions/aws-lambda)
-   [Google Cloud Functions example integration](https://github.com/feathers-studio/telegraf-docs/blob/master/examples/functions/google-cloud-function.ts)
-   [`express` example integration](https://github.com/feathers-studio/telegraf-docs/blob/master/examples/webhook/express.ts)
-   [`fastify` example integration](https://github.com/feathers-studio/telegraf-docs/blob/master/examples/webhook/fastify.ts)
-   [`koa` example integration](https://github.com/feathers-studio/telegraf-docs/blob/master/examples/webhook/koa.ts)
-   [NestJS framework integration module](https://github.com/bukhalo/nestjs-telegraf)
-   [Cloudflare Workers integration module](https://github.com/Tsuk1ko/cfworker-middware-telegraf)
-   Use [`bot.handleUpdate`](https://telegraf.js.org/classes/Telegraf-1.html#handleupdate) to write new integrations

### Error handling

If middleware throws an error or times out, Telegraf calls `bot.handleError`. If it rethrows, update source closes, and then the error is printed to console and process terminates. If it does not rethrow, the error is swallowed.

Default `bot.handleError` always rethrows. You can overwrite it using `bot.catch` if you need to.

⚠️ Swallowing unknown errors might leave the process in invalid state!

ℹ️ In production, `systemd` or [`pm2`](https://www.npmjs.com/package/pm2) can restart your bot if it exits for any reason.

## Advanced topics

### Working with files

Supported file sources:

-   `Existing file_id`
-   `File path`
-   `Url`
-   `Buffer`
-   `ReadStream`

Also, you can provide an optional name of a file as `filename` when you send the file.

<!-- global bot, fs -->

```js
bot.on('message', async (ctx) => {
    // resend existing file by file_id
    await ctx.replyWithSticker('123123jkbhj6b')

    // send file
    await ctx.replyWithVideo(Input.fromLocalFile('/path/to/video.mp4'))

    // send stream
    await ctx.replyWithVideo(
        Input.fromReadableStream(fs.createReadStream('/path/to/video.mp4'))
    )

    // send buffer
    await ctx.replyWithVoice(Input.fromBuffer(Buffer.alloc()))

    // send url via Telegram server
    await ctx.replyWithPhoto(Input.fromURL('https://picsum.photos/200/300/'))

    // pipe url content
    await ctx.replyWithPhoto(
        Input.fromURLStream(
            'https://picsum.photos/200/300/?random',
            'kitten.jpg'
        )
    )
})
```

### Middleware

In addition to `ctx: Context`, each middleware receives `next: () => Promise<void>`.

As in Koa and some other middleware-based libraries,
`await next()` will call next middleware and wait for it to finish:

```TS
import { Telegraf } from 'telegraf-hardened';
import { message } from 'telegraf-hardened/filters';

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(async (ctx, next) => {
  console.time(`Processing update ${ctx.update.update_id}`);
  await next() // runs next middleware
  // runs after next middleware finishes
  console.timeEnd(`Processing update ${ctx.update.update_id}`);
})

bot.on(message('text'), (ctx) => ctx.reply('Hello World'));
bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
```

With this simple ability, you can:

-   extract information from updates and then `await next()` to avoid disrupting other middleware,
-   like [`Composer`] and [`Router`], `await next()` for updates you don't wish to handle,
-   like [`session`] and [`Scenes`], [extend the context](#extending-context) by mutating `ctx` before `await next()`,
-   reuse [other people's code](https://www.npmjs.com/search?q=telegraf-),
-   do whatever **you** come up with!

[`Telegraf`]: https://telegraf.js.org/classes/Telegraf-1.html
[`Composer`]: https://telegraf.js.org/classes/Composer.html
[`Context`]: https://telegraf.js.org/classes/Context.html
[`Router`]: https://telegraf.js.org/classes/Router.html
[`session`]: https://telegraf.js.org/modules.html#session
[`Scenes`]: https://telegraf.js.org/modules/Scenes.html

### Usage with TypeScript

Telegraf is written in TypeScript and therefore ships with declaration files for the entire library.
Moreover, it includes types for the complete Telegram API via the [`typegram`](https://github.com/KnorpelSenf/typegram) package.
While most types of Telegraf's API surface are self-explanatory, there's some notable things to keep in mind.

#### Extending `Context`

The exact shape of `ctx` can vary based on the installed middleware.
Some custom middleware might register properties on the context object that Telegraf is not aware of.
Consequently, you can change the type of `ctx` to fit your needs in order for you to have proper TypeScript types for your data.
This is done through Generics:

```ts
import { Context, Telegraf } from 'telegraf-hardened'

// Define your own context type
interface MyContext extends Context {
    myProp?: string
    myOtherProp?: number
}

// Create your bot and tell it about your context type
const bot = new Telegraf<MyContext>('SECRET TOKEN')

// Register middleware and launch your bot as usual
bot.use((ctx, next) => {
    // Yay, `myProp` is now available here as `string | undefined`!
    ctx.myProp = ctx.chat?.first_name?.toUpperCase()
    return next()
})
// ...
```
