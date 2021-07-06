const net = require('net')

module.exports = function Socket(path, close) {
  const socket = new net.Socket()
      , requests = new Map()
      , start = Date.now()

  let queue = []
    , uuid = 0
    , open = false

  socket.setEncoding('utf8')
  socket.connect(path)
  socket.on('error', (e) => {
    !open && e.code === 'ENOENT' && Date.now() - start < 10000
      ? setTimeout(() => socket.connect(path), 100)
      : close(e)
  })

  socket.on('connect', () => {
    queue.forEach(msg => socket.write(msg))
    socket.on('close', () => close())
    queue = []
    open = true
  })

  socket.on('data', data =>
    data
    .split(/\r?\n/g)
    .filter(x => x)
    .map(x =>
      JSON.parse(x.trim())
    )
    .forEach(message)
  )

  function message(m) {
    if (m.event)
      return m.name !== 'error' && socket.emit('event', m.name || m.event, m.data)

    if (!requests.has(m.request_id))
      return m.error !== 'success' && socket.emit('error', Object.assign(new Error(m.error), m))

    const request = requests.get(m.request_id)

    m.error === 'success'
      ? request.res(m.data)
      : request.rej(new Error(request.args.join(' ') + ' - failed with error: ' + m.error))

    requests.delete(m.request_id)
  }

  socket.send = (...args) => {
    return new Promise((res, rej) => {
      const id = ++uuid

      const message = JSON.stringify({
        request_id: id,
        command: args.filter(x => x !== undefined)
      }) + '\n'

      const result = open
        ? socket.write(message)
        : queue.push(message)

      result
        ? requests.set(id, { res, rej, args })
        : rej(new Error('Could not send command'))
    })
  }

  return socket
}
