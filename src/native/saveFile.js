import { isNativePlatform } from '../sync/nativeHttp'

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('file read failed'))
    reader.onload = () => {
      const s = String(reader.result)
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s) // strip the data: URL prefix
    }
    reader.readAsDataURL(blob)
  })
}

// Deliver a generated file (image export, JSON backup, …) to the user.
//
// On web this is the classic URL.createObjectURL + <a download> anchor. In a
// Capacitor Android WebView that anchor is a silent no-op — the shell installs
// no DownloadListener, so the click does nothing and the export appears dead
// (lastGLANCE #233). On native we instead write the file to the app cache via
// @capacitor/filesystem and open the system share sheet via @capacitor/share.
//
// Returns true when delivered, false when the user dismissed the share sheet (a
// cancel, not an error). Throws on real failures so callers can surface them.
export async function saveOrShareFile({ filename, blob }) {
  if (!isNativePlatform()) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.download = filename
    a.href = url
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
    return true
  }

  // Dynamic import so the plugin code isn't pulled into the web bundle.
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  const data = await blobToBase64(blob)
  const { uri } = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache })
  try {
    await Share.share({ title: filename, url: uri, dialogTitle: filename })
    return true
  } catch (err) {
    const msg = String(err?.message ?? err).toLowerCase()
    if (msg.includes('cancel') || msg.includes('abort') || msg.includes('dismiss')) return false
    throw err
  }
}
