// pattern-check: skip mechanical extraction of UUID literals from src/main and renderer files
export const ZMK_SERVICE_UUID = '00000000-0196-6107-c967-c5cfb1c2482a'
export const ZMK_CHAR_UUID = '00000001-0196-6107-c967-c5cfb1c2482a'

export const ZMK_SERVICE_UUID_NOBLE = ZMK_SERVICE_UUID.replace(
    /-/g,
    '',
).toLowerCase()
export const ZMK_CHAR_UUID_NOBLE = ZMK_CHAR_UUID.replace(/-/g, '').toLowerCase()
