import type { Peer } from 'crossws'
import { createWsSession } from '../lib/ws-protocol'

// Protocol: see server/lib/ws-protocol.ts. One session per peer, streaming the events of the
// runs that peer started.
const sessions = new Map<string, ReturnType<typeof createWsSession>>()

export default defineWebSocketHandler({
  open(peer: Peer) {
    sessions.set(
      peer.id,
      createWsSession(useAnyGen().runs, (message) => peer.send(JSON.stringify(message))),
    )
  },
  message(peer, message) {
    try {
      sessions.get(peer.id)?.onMessage(message.text())
    } catch (err) {
      console.error('[anygen] websocket handler failed', err)
      peer.send(JSON.stringify({ type: 'error', message: 'Internal error' }))
    }
  },
  close(peer) {
    sessions.get(peer.id)?.close()
    sessions.delete(peer.id)
  },
})
