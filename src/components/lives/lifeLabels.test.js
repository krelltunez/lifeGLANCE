import { describe, it, expect } from 'vitest'
import { lifeName, lifeColor, blockingDeviceLabel } from './lifeLabels'

// A stand-in for i18next's t: returns the key, with interpolation shown.
const t = (key, vars) => (vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')})` : key)

describe('Life labels', () => {
  it('Me is always the translated "Me", with its nickname when it has one', () => {
    expect(lifeName({ id: 'me', name: 'Me' }, t)).toBe('me')
    expect(lifeName({ id: 'me', name: 'Me', nickname: 'Jay' }, t)).toBe('me (Jay)')
    expect(lifeName({ id: 'L1', name: 'Mom' }, t)).toBe('Mom')
  })

  it("uses the Life's colour, or the app's amber", () => {
    expect(lifeColor({ color: 'var(--teal)' })).toBe('var(--teal)')
    expect(lifeColor({})).toBe('var(--amber)')
  })

  it('names a blocking device by platform and version, or as an older device', () => {
    expect(blockingDeviceLabel({ legacy: true }, t)).toBe('gateLegacyDevice')
    expect(blockingDeviceLabel({ platform: 'android', app: '4.1.0' }, t)).toBe('gateDevice(platform=platformAndroid,app=4.1.0)')
    expect(blockingDeviceLabel({ platform: 'ios' }, t)).toBe('platformIos')
    expect(blockingDeviceLabel({ platform: 'symbian', app: '4.1.0' }, t)).toBe('gateDevice(platform=platformUnknown,app=4.1.0)')
  })
})
