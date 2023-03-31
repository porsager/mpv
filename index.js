import cp from 'child_process'
import events from 'events'
import fs from 'fs'
import net from 'net'

import prexit from 'prexit'

export default Mpv

async function Mpv({
  args = [],
  options = {},
  path = process.platform === 'win32'
    ? fs.existsSync('mpv.exe') ? 'mpv.exe' : 'mpv'
    : fs.existsSync('mpv') ? './mpv' : 'mpv'
} = {}) {
  const socketArg = '--input-ipc-server'
  const socket = new net.Socket()
  const mpv = Object.assign(new events.EventEmitter(), {
    end,
    status: 'stopped',
    set: (...args) => command('set_property', ...args),
    get: (...args) => command('get_property', ...args),
    command,
    observe,
    socket
  })

  const observers = new Map()
      , requests = new Map()

  let observeId = 0
    , requestId = 0
    , queue = []

  args = (args || []).slice(0)

  const defaults = [
    randomPath(),
    '--audio-fallback-to-null=yes',
    '--no-config',
    '--idle',
    '--msg-level=all=warn'
  ]

  defaults.forEach(a => args.some(x => x.startsWith(a.split('=')[0])) || args.push(a))

  const socketPath = args.find(x => x.startsWith(socketArg)).slice(socketArg.length + 1)

  socket
    .unref()
    .setEncoding('utf8')
    .on('error', error)
    .on('data', data)

  prexit.last(end)

  await start()

  return mpv

  function end() {
    mpv.process.removeAllListeners()
    kill()
    mpv.process.unref()
  }

  function kill() {
    mpv.process && !mpv.process.killed && mpv.process.kill()
  }

  function error(e) {
    mpv.status === 'started' && kill()
  }

  async function start(emit) {
    if (mpv.status !== 'stopped')
      return

    mpv.status = 'starting'

    try {
      mpv.process && end()
      mpv.process = cp.spawn(path, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        ...options
      })

      let stderr = ''
      mpv.process.stderr.setEncoding('utf8')
      mpv.process.stderr.on('data', x => stderr += x)

      await new Promise((resolve, reject) => {
        mpv.process.once('error', reject)
        mpv.process.once('close', (code, signal) => reject(Object.assign(new Error(stderr || 'closed'), { code, signal })))
        connect().then(resolve, reject)
      })

      ready()
      mpv.status = 'started'
      emit && mpv.emit('restarted')
      mpv.process.on('close', () => {
        mpv.status = 'stopped'
        start(true).catch(e => mpv.emit('error', e))
      })
    } catch (error) {
      mpv.status = 'errored'
      throw error
    }
  }

  async function connect({
    connectStart = process.hrtime.bigint() / 1000000n,
    timeout = 5000
  } = {}) {
    let resolve
      , reject
      , error

    const promise = new Promise((r, e) => (resolve = r, reject = e))

    socket.once('ready', resolve)
    socket.on('error', errored)
    socket.on('close', close)
    socket.connect(socketPath)

    return promise.finally(() => {
      socket.off('error', errored)
      socket.off('ready', resolve)
      socket.off('close', close)
    })

    function errored(e) {
      error = e
    }

    function close() {
      process.hrtime.bigint() / 1000000n - connectStart > timeout
        ? reject(error || new Error('Timed out'))
        : setTimeout(() => socket.connect(socketPath), 20)
    }
  }

  async function observe(x, fn) {
    if (observers.has(x)) {
      const observer = await observers[x]
      observer.fns.add(fn)
      return () => unobserve(x, fn)
    }

    const id = ++observeId
    observers[x] = mpv.command('observe_property', id, x).then(result => {
      observers.set(x, { id, fns: new Set([fn]) })
      return result
    })
    return () => unobserve(x, fn)
  }

  async function unobserve(x, fn) {
    const observer = observers.get(x)
    observer.fns.delete(fn)
    if (observer.fns.size === 0) {
      observers.delete(x)
      mpv.command('unobserve_property', observer.id).catch(e => mpv.emit('error', e))
    }
  }

  function ready() {
    observers.forEach(({ id }, x) => command('observe_property', id, x))
    requests.forEach(write)
    queue.forEach(write)
    queue = []
  }

  function data(x) {
    x
    .split(/\r?\n/g)
    .filter(x => x)
    .map(x =>
      JSON.parse(x.trim())
    )
    .forEach(handle)
  }

  function handle(x) {
    if (x.event) {
      return x.event === 'property-change'
        ? observers.has(x.name) && observers.get(x.name).fns.forEach(fn => fn(x.data))
        : mpv.emit(x.event, x)
    }

    if (!requests.has(x.request_id))
      return x.error !== 'success' && mpv.emit('error', Object.assign(new Error(x.error), x))

    const request = requests.get(x.request_id)
    requests.delete(x.request_id)

    x.error === 'success'
      ? request.resolve(x.data)
      : request.reject(new Error(request.args.join(' ') + ' - failed with error: ' + x.error))
  }

  function command(...args) {
    return new Promise((resolve, reject) => {
      const id = ++requestId
      const request = {
        id,
        resolve,
        reject,
        args,
        message: JSON.stringify({
          request_id: id,
          command: args.filter(x => x !== undefined)
        }) + '\n'
      }

      socket.readyState === 'open'
        ? write(request)
        : queue.push(request)
    })
  }

  function write(request) {
    socket.write(request.message)
    requests.set(request.id, request)
  }

  function randomPath() {
    return socketArg + '='
         + (process.platform === 'win32' ? '\\\\.\\pipe\\mpvsocket' : '/tmp/mpvsocket')
         + Math.random().toString(36).slice(2)
  }

}
