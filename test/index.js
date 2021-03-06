import test from 'blue-tape'
import initMemoize from '../src'
import initBlobStore from 'fs-blob-store'
import rimraf from 'rimraf'
import fs from 'fs'
import { join } from 'path'
import isStream from 'is-stream'
import * as streamUtils from '../src/stream-utils'
import request from 'request'

const tmpPath = join(__dirname, '.tmp')
// Clean tmp dir
rimraf.sync(tmpPath)

const blobStore = initBlobStore(tmpPath)
const memoize = initMemoize(blobStore)

test('simple cache miss, cache hit', (t) => {
  let callCount = 0
  const square = memoize((i) => {
    callCount++
    if (callCount === 1) {
      return Promise.resolve(i * i)
    }
    return Promise.resolve(i * i * i)
  }, 'test-1')
  square(2)
    .then((val) => {
      t.equal(val, 4, 'val = 4')
    })
    .then(() => square(2))
    .then((val) => {
      t.equal(val, 4, 'returns cached result')
    })
    .then(() => {
      t.end()
    })
    .catch((err) => {
      t.fail(err)
    })
})

// promisified read file
// returns buffer
const readFile = (filePath) => new Promise((resolve, reject) => {
  fs.readFile(filePath, (err, data) => {
    if (err) reject(err)
    resolve(data)
  })
})

const poemPath = `${__dirname}/poem.txt`
const poemData = fs.readFileSync(poemPath).toString()

test('simple cache miss, cache hit with promise', (t) => {
  let callCount = 0
  const readPoem = memoize(() => {
    callCount++
    if (callCount === 1) {
      return readFile(poemPath).then((data) => data.toString())
    }
    return Promise.resolve('oopsie')
  }, 'test-2')

  readPoem()
    .then((val) => {
      t.equal(val, poemData, 'poem data')
    })
    .then(() => readPoem())
    .then((val) => {
      t.equal(val, poemData, 'returns cached result')
    })
    .then(() => t.end())
    .catch((err) => t.fail(err))
})

test('simple cache miss, cache hit with promise that returns buffer', (t) => {
  let callCount = 0
  const readPoem = memoize(() => {
    callCount++
    if (callCount === 1) {
      return readFile(poemPath)
    }
    return Promise.resolve('oopsie')
  }, 'test-3')

  readPoem()
    .then((val) => {
      t.equal(val.toString(), poemData, 'poem data')
    })
    .then(() => readPoem())
    .then((val) => {
      t.ok(Buffer.isBuffer(val), 'is a buffer')
      t.equal(val.toString(), poemData, 'returns cached result')
    })
    .then(() => t.end())
    .catch((err) => t.fail(err))
})

test('promise returning a stream', (t) => {
  let callCount = 0
  const readPoemStream = memoize(() => {
    callCount++
    if (callCount === 1) {
      return fs.createReadStream(poemPath)
    }
    return Promise.resolve('oopsie')
  }, 'test-4')

  readPoemStream()
    .then((readStream) => {
      t.ok(isStream(readStream, 'returns a stream'))
      return streamUtils.streamToString(readStream)
    })
    .then((val) => {
      t.equal(val.toString(), poemData, 'poem data')
    })
    .then(() => readPoemStream())
    .then((readStream) => {
      t.ok(isStream(readStream, 'returns a stream'))
      return streamUtils.streamToString(readStream)
    })
    .then((val) => {
      t.equal(val.toString(), poemData, 'returns cached result')
    })
    .then(() => t.end())
    .catch((err) => t.fail(err))
})

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('maxAge', (t) => {
  let callCount = 0
  const someFn = memoize(() => {
    callCount++
    return `callCount: ${callCount}`
  }, 'test-5', { maxAge: 300 })

  return someFn()
    .then((str) => t.equal(str, 'callCount: 1'))
    .then(() => someFn())
    .then((str) => t.equal(str, 'callCount: 1'))
    .then(() => timeout(400))
    .then(() => someFn())
    .then((str) => t.equal(str, 'callCount: 2'))
    .then(() => someFn())
    .then((str) => t.equal(str, 'callCount: 2'))
})

test('issue #1', (t) => {
  const getBody = (url) => new Promise((resolve, reject) => {
    request({
      url,
      encoding: null,
    }, (err, res, body) => {
      if (err) {
        return reject(err)
      }
      resolve(body)
    })
  })
  const memoGetBody = memoize(getBody, 'getBody')

  const url = 'https://raw.githubusercontent.com/maxogden/abstract-blob-store/master/badge.png'
  let firstBody
  let secondBody
  return memoGetBody(url)
    .then((body) => {
      firstBody = body
      // console.log(body)
    })
    .then(() => memoGetBody(url))
    .then((body) => {
      secondBody = body
      // console.log(body)
    })
    .then(() => {
      t.ok(Buffer.isBuffer(firstBody))
      t.ok(Buffer.isBuffer(secondBody))
      t.deepEqual(firstBody, secondBody)
    })
})
