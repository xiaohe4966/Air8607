"""esptool wrapper: write ROM flash blocks in 256-byte packets.

The ESP32-C3 rev0.3 ROM accepts 0x400-byte FLASH_DATA packets over a CH343
USB-UART bridge on some boards but then reports "invalid message format" or a
checksum error.  Splitting each block into 256-byte packets keeps the sequence
numbers contiguous and flashes reliably (slower, but a one-off cost).
"""

import sys

from esptool.targets.esp32c3 import ESP32C3ROM

SUB = 0x100
_orig_block = ESP32C3ROM.flash_block


def _split_block(self, data, seq, timeout=3.0, encrypted=False):
    per = max(1, self.FLASH_WRITE_SIZE // SUB)
    for i in range(0, len(data), SUB):
        _orig_block(self, data[i:i + SUB], seq * per + i // SUB, timeout, encrypted)


ESP32C3ROM.flash_block = _split_block

import esptool  # noqa: E402

esptool.main(sys.argv[1:])
