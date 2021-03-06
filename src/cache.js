/* eslint-disable no-cond-assign */
import { PassThrough } from 'stream'
import initDebug from 'debug'

import { stringToStream, toStream, fromStream } from './stream-utils'

const debug = initDebug('persistent-memoize')

// Modified from
// https://nodejs.org/api/stream.html#stream_readable_unshift_chunk

const parseMetadata = (stream) => new Promise((resolve) => {
  let header = ''
  const onReadable = () => {
    let chunk
    while ((chunk = stream.read()) !== null) {
      const str = chunk.toString()
      const match = str.match(/\n\n/)
      if (match) {
        stream.removeListener('readable', onReadable)
        // found the header boundary
        const split = str.split(/\n\n/)
        header += split.shift()
        /*
        oops, this does not work if the body doesn't contain utf8...
        const remaining = split.join('\n\n')
        const buf = bufferFrom(remaining, 'utf8')
        if (buf.length) {
          stream.unshift(buf)
        }
        */
        const remaining = chunk.slice(match.index + '\n\n'.length)
        if (remaining.length) {
          stream.unshift(remaining)
        }
        // now the body of the message can be read from the stream.
        const metadata = JSON.parse(header)
        if (metadata.createdAt) {
          metadata.createdAt = new Date(metadata.createdAt)
        }
        return resolve({ metadata, stream })
      }
      // still reading the header.
      header += str
    }
  }
  stream.on('readable', onReadable)
})

const isExpired = (createdAt, maxAge) => {
  if (!createdAt) return false
  const now = (new Date()).getTime()
  const expiryDate = createdAt.getTime() + maxAge
  return (now > expiryDate)
}

export default (store) => {
  const get = (key, { maxAge = Infinity }) => new Promise((resolve, reject) => {
    store.exists({ key }, (err, exists) => {
      if (err) return reject(err)
      if (!exists) return resolve({ miss: true })
      // TODO: ... readStream = store.getStream((err) => reject(err)
      // read first line of stream for metadata...
      const cacheReadStream = store.createReadStream({ key })
      cacheReadStream.on('error', reject)

      // do something with metadata
      parseMetadata(cacheReadStream).then(({ metadata, stream }) => (
        fromStream(metadata.type, stream).then((value) => {
          const expired = isExpired(metadata.createdAt, maxAge)
          resolve({
            miss: expired,
            expired,
            metadata,
            value,
          })
        })
      )).catch(reject)
    })
  })

  const set = (key, value, metadata = {}) => (
    new Promise((resolve, reject) => {
      const { type, bodyStream } = toStream(value)

      debug('data type', type)
      let resolveValue = value

      const writeStream = store.createWriteStream({ key }, (err) => {
        if (err) return reject(err)
        debug('wrote body')
        resolve(resolveValue)
      })

      const actualMetadata = {
        createdAt: new Date(),
        type,
        ...metadata,
      }

      const headerStream = stringToStream(`${JSON.stringify(actualMetadata)}\n\n`)

      // Write metadata first but don't close write stream
      debug('writing metadata to cache')
      headerStream.on('error', reject)

      // Wait for metadata to have been written completely
      headerStream.on('end', () => {
        debug('wrote metadata')
        // If value is a stream we can't just naively
        // return the stream because the stream will
        // will be closed by the time we return it
        if (type === 'stream') {
          // We create a passthrough stream that will duplicate the stream's data
          // Not sure this is the best way to handle this situation
          const passthrough = new PassThrough()
          bodyStream.pipe(passthrough)
          resolveValue = passthrough
        }

        // Write actual encoded value and close write stream
        bodyStream.pipe(writeStream)
      })

      headerStream.pipe(writeStream, { end: false })
    })
  )

  return {
    get,
    set,
  }
}
