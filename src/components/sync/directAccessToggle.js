// What the Direct Access encrypt switch does when tapped. Turning it on needs
// a key in memory (encryptData derives one from the passphrase); without one
// the section asks for the passphrase first, and the switch flips only once
// the key is set up. Off is always immediate: it changes nothing until the
// file is replaced, since the file decides for every device after its first
// write.
export const decideEncryptToggle = ({ encrypt, keyInMemory }) =>
  (encrypt ? 'off' : keyInMemory ? 'on' : 'ask')
