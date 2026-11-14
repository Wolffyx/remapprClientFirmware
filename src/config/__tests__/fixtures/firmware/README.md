# Firmware-produced golden blobs

Byte-identical copies of `tests/config_blob/golden/*.bin` in the firmware repo
(`Wolffyx/Ramappr-firmware`): what `remappr_config_encode_keymap`
(`lib/config_blob/keymap_encode.c`) writes for the keymaps in its
`tests/config_blob/src/test_golden_encode.c`. A fresh device returns this
encoder's output, so `remappr.firmwareGolden.test.ts` decodes them.

The firmware suite fails when its encoder drifts from its copy; when that
happens on purpose, copy the regenerated files here too.
