/** Percent-encodes every path segment so the URI is safe in GVariant and dbus-send arguments. */
export const getFileManagerUri = (absolutePath: string): string =>
  `file://${absolutePath.split('/').map(encodeURIComponent).join('/')}`

// FileManager1.ShowItems opens the parent folder with the file selected (Nautilus, Dolphin,
// Nemo, Thunar, ...). Without that service, fall back to opening the folder.
export const showItemsScript = [
  'uri=$1',
  'gdbus call --session --dest org.freedesktop.FileManager1 ' +
    '--object-path /org/freedesktop/FileManager1 ' +
    '--method org.freedesktop.FileManager1.ShowItems "[\\"$uri\\"]" "" ' +
    '>/dev/null 2>&1 && exit 0',
  'dbus-send --session --print-reply --dest=org.freedesktop.FileManager1 ' +
    '/org/freedesktop/FileManager1 org.freedesktop.FileManager1.ShowItems ' +
    '"array:string:$uri" "string:" >/dev/null 2>&1 && exit 0',
  'exec xdg-open "$2"'
].join('\n')
