import { connect } from './presence.js'

const [spaceId, cardId] = process.argv.slice(2)
if (!spaceId) throw new Error('usage: node local-server/presence-example.mjs SPACE_ID [CARD_ID]')

const presence = await connect({
  url: `ws://127.0.0.1:${process.env.KINOPIO_LOCAL_PORT || 8081}/ws`,
  id: 'kaoru-agent',
  name: '小薰',
  color: '#b38aff'
})
presence.join(spaceId)
if (cardId) presence.select([cardId])
let x = 520
presence.cursor(x, 210)
const timer = setInterval(() => {
  x = x === 520 ? 620 : 520
  presence.cursor(x, 210)
  if (cardId) presence.select([cardId])
}, 1200)
process.on('SIGTERM', () => { clearInterval(timer); presence.leave() })
process.on('SIGINT', () => { clearInterval(timer); presence.leave() })
console.log(`小薰 joined ${spaceId}; Ctrl-C to leave`)
