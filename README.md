# MPV

This library spawns [mpv](https://mpv.io) and talks to it using the [JSON IPC protocol](https://mpv.io/manual/master/#json-ipc).

# Quick start

```js
const mpv = Mpv({
  args: [],       // Arguments to child_process.spawn,
  options: {}     // Options to child_process.spawn,
  path: 'mpv'     // Path of mpv (defaults to mpv or mpv.exe)
})

mpv.command('loadfile', 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4')

mpv.on('playback-time', time =>
  console.log(time)
)

await mpv.get('volume')

await mpv.set('volume', 0.5)

mpv.process       // process from child_process.spawn
mpv.socket        // raw tcp socket
```
