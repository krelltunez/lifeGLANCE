import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  initStartupLog,
  logStartup,
  startupLogPath,
  STARTUP_LOG_FILENAME,
  MAX_LOG_BYTES,
  __resetStartupLogForTests,
} from './startupLog.js'

// Real file I/O against a temp userData dir. The log must be bounded and must
// never throw into startup.

let dir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeglance-startuplog-'))
  __resetStartupLogForTests()
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('initStartupLog / logStartup', () => {
  it('creates the log under userData and appends timestamped lines', () => {
    const p = initStartupLog(dir)
    expect(p).toBe(path.join(dir, STARTUP_LOG_FILENAME))
    expect(startupLogPath()).toBe(p)

    logStartup('createWindow: called')
    logStartup('main window ready-to-show')

    const contents = fs.readFileSync(p, 'utf-8')
    expect(contents).toContain('===== session')
    expect(contents).toContain('createWindow: called')
    expect(contents).toContain('main window ready-to-show')
  })

  it('logs a fresh install\'s first launch, before userData exists', () => {
    const userData = path.join(dir, 'not-yet', 'lifeGLANCE')
    const p = initStartupLog(userData)
    expect(p).toBe(path.join(userData, STARTUP_LOG_FILENAME))
    logStartup('first launch')
    expect(fs.readFileSync(p, 'utf-8')).toContain('first launch')
  })

  it('keeps earlier sessions across inits', () => {
    initStartupLog(dir)
    logStartup('first launch line')
    __resetStartupLogForTests()

    initStartupLog(dir)
    const contents = fs.readFileSync(path.join(dir, STARTUP_LOG_FILENAME), 'utf-8')
    expect(contents).toContain('first launch line')
    expect(contents.match(/===== session/g)?.length).toBe(2)
  })

  it('drops an oversized log on init so it can never grow without bound', () => {
    const target = path.join(dir, STARTUP_LOG_FILENAME)
    fs.writeFileSync(target, 'x'.repeat(MAX_LOG_BYTES + 1))

    initStartupLog(dir)
    const contents = fs.readFileSync(target, 'utf-8')
    expect(contents).not.toContain('xxxx')
    expect(contents).toContain('===== session')
    expect(contents.length).toBeLessThan(MAX_LOG_BYTES)
  })

  it('is a no-op before init, and never throws', () => {
    expect(() => logStartup('should be ignored')).not.toThrow()
    expect(startupLogPath()).toBeNull()
  })

  it('answers null, and stays quiet, when userData cannot be made', () => {
    const blocker = path.join(dir, 'a-file')
    fs.writeFileSync(blocker, 'x')
    expect(initStartupLog(path.join(blocker, 'userData'))).toBeNull()
    expect(() => logStartup('ignored')).not.toThrow()
  })
})
