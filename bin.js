#!/usr/bin/env node

'use strict'

const pino = require('pino')
const log = pino({ name: 'tg-asticker2vid-bot' })

const path = require('path')
const mainURL = process.argv[3]

const hapi = require('@hapi/hapi')
const boom = require('@hapi/boom')

const emoji = require('emoji-dictionary')
const prom = f => new Promise((resolve, reject) => f((err, res) => err ? reject(err) : resolve(res)))
const renderLottie = require('puppeteer-lottie')
const zlib = require('zlib')
const fs = require('fs')

const HELLO = `*This bot turns animated stickers into videos!*

Just send me your stickers and I'll convert them!

Oh, and could you please...
 \\* Report bugs when you spot them: https://github.com/mkg20001/tg-asticker2vid-bot/issues
 \\* Donate: https://paypal.me/mkg20001
`

const core = require('teleutils')('asticker2vid-bot', {
  token: process.argv[2],
  helloMessage: HELLO
})

async function postConvert (input, output, reply, opt) {
  let { chat: { id: cid }, message_id: msgId, animation: { file_id: id, file_name: fName } } = await reply.video(output.path, opt)

  if (fName.endsWith('_')) {
    fName = fName.replace(/_$/, '')
  }

  fName = encodeURI(fName)

  await bot.sendMessage(cid, `Here's the link to download the video: ${mainURL}/${id}/${fName}?dl=1

Donate to keep this bot up! https://paypal.me/mkg20001`, { webPreview: false, replyToMessage: msgId })

  // clean disk
  input.cleanup()
  output.cleanup()
}

const beConfused = async msg => {
  return msg.reply.file(path.join(__dirname, 'confused.webp'), { fileName: 'confused.webp', asReply: true })
}
const handleSticker = async msg => {
  const sticker = msg.sticker

  const location = await core.fetch.tg(sticker)

  if (sticker.is_animated) {
    let buffer = await prom(cb => fs.readFile(location.path, cb))
    if (buffer[0] !== 123) { // 123 is {, if not at begin then ungzip first
      buffer = await prom(cb => zlib.gunzip(buffer, cb))
    }
    location.cleanup() // cleanup original file

    // we have a JSON file now
    const lottie = core.tmp('_sticker.json')
    const generated = core.tmp('_generated.mp4')
    fs.writeFileSync(lottie.path, buffer)

    await renderLottie({
      path: lottie.path,
      output: generated.path,
      width: sticker.width,
      height: sticker.height,
      style: {
        background: 'black'
      }
    })

    await msg.track('convert/animated_sticker')
    await postConvert(lottie, generated, msg.reply, { fileName: (msg.sticker.emoji ? emoji.getName(msg.sticker.emoji) + '_animated_sticker' : 'animated_sticker') + '.mp4', asReply: true })
  } else {
    await msg.reply.text('This sticker isn\'t animated. There\'s no point in converting it into a video.', { asReply: true })
  }
}

const { bot } = core

bot.on('sticker', handleSticker)
bot.on('document', beConfused)
bot.on('photo', beConfused)
bot.on('text', () => {})
bot.on('forward', msg => {
  switch (true) {
    case Boolean(msg.sticker):
      return handleSticker(msg)
    case Boolean(msg.document):
      return beConfused(msg)
    case Boolean(msg.text):
      return beConfused(msg)
    case Boolean(msg.photo):
      return beConfused(msg)
    default: {} // eslint-disable-line no-empty
  }
})

const main = async () => {
  const server = hapi.server({
    port: 12534,
    host: 'localhost'
  })

  await server.register({
    plugin: require('hapi-pino'),
    options: { name: 'tg-asticker2vid-bot' }
  })

  if (process.env.SENTRY_DSN) { // TODO: this seems to cause heap out of memory
    await server.register({
      plugin: require('hapi-sentry'),
      options: { client: core.error }
    })
  }

  await server.register({
    plugin: require('@hapi/inert')
  })

  await server.route({
    path: '/',
    method: 'GET',
    handler: async (request, h) => {
      return h.redirect('https://t.me/asticker2vid_bot')
    }
  })

  await server.route({
    path: '/{id}/{real}',
    method: 'GET',
    config: {
      handler: async (request, h) => {
        let file
        try {
          file = await bot.getFile(request.params.id)
        } catch (error) {
          if (error.error_code === 400) {
            throw boom.notFound()
          } else {
            throw error
          }
        }
        log.info(file, 'Downloading %s...', file.file_id)
        const loc = await core.fetch.web(file.fileLink, path.basename(file.file_path || ''))

        if (request.query.dl) {
          return h.file(loc.path, { confine: false }).header('content-description', 'File Transfer').header('type', 'application/octet-stream').header('content-disposition', 'attachment; filename=' + JSON.stringify(request.params.real)).header('content-transfer-encoding', 'binary')
        }
        return h.file(loc.path, { confine: false }).type('video/mp4')

        // TODO: call loc.cleanup() afterwards
      }
    }
  })

  await server.start()

  core.start()
}

main().then(() => {}, console.error)
