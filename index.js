const cp = require('child_process')
    , os = require('os')
    , events = require('events')
    , socket = require('./socket')

const socketArg = '--input-ipc-server'
const win32 = os.platform() === 'win32'

function Mpv({
  args = [],
  options = {},
  path = win32 ? 'mpv.exe' : 'mpv'
} = {}) {
  args = args.slice(0)
  const mpv = new events.EventEmitter()

  const socketPath = win32 ? '\\\\.\\pipe\\mpvsocket' : '/tmp/mpvsocket'

  if (!args.some(x => x.startsWith(socketArg)))
    args.push(socketArg + '=' + socketPath + Math.random().toString(36).slice(2))

  if (!args.some(x => x.startsWith('--no-config')))
    args.push('--no-config')

  if (!args.some(x => x.startsWith('--idle')))
    args.push('--idle=yes')

  if (!args.some(x => x.startsWith('--msg-level')))
    args.push('--msg-level=all=warn')

  mpv.process = cp.spawn(path, args, options)

  const kill = () => mpv.process.kill()
  process.on('exit', kill)

  mpv.process.on('exit', () => process.off('exit', kill))
  mpv.process.stdout.setEncoding('utf8')
  mpv.process.stderr.setEncoding('utf8')
  mpv.process.stdout.on('data', () => { /* noop - ensure drain of mpv */ })
  mpv.process.stderr.on('data', () => { /* noop - ensure drain of mpv */ })
  mpv.process.on('error', error)

  mpv.socket = socket(
    args.find(x => x.startsWith(socketArg)).slice(socketArg.length + 1),
    err => {
      mpv.process.kill()
      error(err)
    }
  )
  mpv.socket.on('event', (eventName, data) => mpv.emit(eventName, data))

  mpv.command = mpv.socket.send
  mpv.set = (...args) => mpv.socket.send('set_property', ...args)
  mpv.get = (...args) => mpv.socket.send('get_property', ...args)

  return mpv

  function error(x) {
    mpv.emit('error', x)
  }
}

module.exports = Mpv
