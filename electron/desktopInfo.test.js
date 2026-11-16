import { describe, expect, it } from 'vitest'
import { decodeDesktopInfo, encodeDesktopInfo, DESKTOP_INFO_ARG } from './desktopInfo.js'

describe('desktop info switch', () => {
  it('round-trips through argv', () => {
    const argv = ['/path/electron', '--type=renderer', `${DESKTOP_INFO_ARG}${encodeDesktopInfo({ version: '5.1.0', isMAS: true, secureStorage: false })}`]
    expect(decodeDesktopInfo(argv)).toEqual({ version: '5.1.0', isMAS: true, secureStorage: false })
  })

  it('is null when absent or malformed', () => {
    expect(decodeDesktopInfo(['--type=renderer'])).toBeNull()
    expect(decodeDesktopInfo([`${DESKTOP_INFO_ARG}%7Bnope`])).toBeNull()
    expect(decodeDesktopInfo([`${DESKTOP_INFO_ARG}${encodeURIComponent('{"version":3}')}`])).toBeNull()
    expect(decodeDesktopInfo([`${DESKTOP_INFO_ARG}${encodeURIComponent('{"version":"1","isMAS":false}')}`])).toBeNull()
  })
})
