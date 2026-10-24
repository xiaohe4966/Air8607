# ESP32-C3 WiFi bridge for Air8607

This ESP-IDF firmware turns an ESP32-C3 into a small WiFi network card for the
Air8607.  It connects to WiFi, fetches the public IP and server time once at
boot, and exposes the result over UART1 as line-delimited JSON.

```text
Air8607 UART2 (J110 RX2/TX2)  <->  ESP32-C3 UART1 (GPIO4/GPIO5)
```

## Wiring

| Air8607 J110 | Direction | ESP32-C3 |
| --- | --- | --- |
| pin 5 `RX2` | ← | GPIO4 `UART1_TX` |
| pin 6 `TX2` | → | GPIO5 `UART1_RX` |
| GND | ↔ | GND |

- 3.3 V logic on both sides.  Do not use level shifters for 5 V.
- Keep the grounds connected.
- During development the ESP32-C3 can be powered from USB.  In a finished
  product use a separate 3.3 V/5 V supply with enough peak current for WiFi.
  Do not power it from Air1603 `VDD_EXT`; that pin is for pull-ups, not a load.

## WiFi provisioning

If no credentials are stored, or the saved network cannot be joined, the
ESP32-C3 starts an access point:

- SSID: `Air8607-C3`
- Password: `air8607wifi`
- Configuration page: <http://192.168.4.1/>

Connect a phone to the AP, enter the target WiFi SSID/password, and save.  The
ESP32-C3 stores the credentials in NVS and restarts.  On the next boot it joins
the WiFi and fetches the API once.

Credentials are stored only in the ESP32-C3 NVS partition.  They are not sent
to the Air8607.

## Build and flash

Requirements: ESP-IDF 5.4 (or a compatible 5.x release).  The firmware was
built and tested with ESP-IDF 5.4.3 on macOS.

```bash
cd esp32c3_wifi_bridge
source ~/esp/v5.4/esp-idf/export.sh
idf.py set-target esp32c3
idf.py build
```

On this Mac the CH343 `usbmodem` interface was unreliable for flash writes;
the `wchusbserial` interface worked:

```bash
python -m esptool --chip esp32c3 -p /dev/cu.wchusbserialXXXX \
  -b 115200 --no-stub --before default_reset --after hard_reset \
  write_flash --no-compress --flash_mode dio --flash_size 4MB --flash_freq 40m \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0x10000 build/air8607_c3_wifi_bridge.bin
```

Or use the helper:

```bash
./flash_c3.sh /dev/cu.wchusbserialXXXX
```

`idf.py flash` uses the esptool stub; on the tested hub the stub upload failed
with a RAM checksum error, so the helper uses `--no-stub`.  If your board
flashes normally with `idf.py flash`, that is fine too.

## UART protocol

Air8607 → ESP32-C3 (one ASCII command per line):

| Command | Response |
| --- | --- |
| `HELLO` | firmware/version hello |
| `STATUS` | WiFi, local IP, fetch state |
| `FETCH` | cached `netinfo`, or `not_ready` |
| `PING` | `pong` |
| `REBOOT` | `ack`, then restart |

ESP32-C3 → Air8607 (one JSON object per line):

```json
{"type":"netinfo","ok":true,"code":1,"msg":"ok","ip":"180.113.152.47","date":"2026-10-24 11:26:02","time":1792812362,"local_ip":"192.168.1.23"}
```

Before HTTPS, the firmware synchronizes the system clock with SNTP (the API
response is still the time shown on the display).  This is required because a
fresh ESP32-C3 starts at 1970 and a 2026 TLS certificate would look "not yet
valid".  If SNTP times out, the firmware falls back to its build timestamp.

The API request is performed once after a successful WiFi connection:

```text
https://tool.he4966.cn/api/tool/get_my_ip
```

`FETCH` only returns the cached result.  Reboot the ESP32-C3 to fetch again.

## Files

| File | Purpose |
| --- | --- |
| `main/main.c` | WiFi, provisioning HTTP server, HTTPS fetch, UART protocol |
| `partitions.csv` | 4 MB flash layout: 24 KB NVS + 1.9 MB app |
| `sdkconfig.defaults` | ESP32-C3, 4 MB, DIO, certificate bundle, HTTP server limits |
| `flash_c3.sh` | Build and flash helper using the ROM loader (`--no-stub`) |

## Test status

- Firmware builds with ESP-IDF 5.4.3.
- Flashed to ESP32-C3 (QFN32 rev0.3, MAC `60:55:f9:71:d8:e0`, 4 MB MXIC flash).
- Boot log confirms UART1 initialization at GPIO4/5, 115200 8N1.
- With no credentials stored, the provisioning AP `Air8607-C3` starts and the
  HTTP server listens on `192.168.4.1:80`.
- SNTP time sync is included before the HTTPS request for TLS certificate
  validity; a compile-time fallback is used if NTP is blocked.
- End-to-end WiFi/HTTPS check requires joining a real 2.4 GHz WiFi network; use
  the provisioning page above.  The tested Mac was associated to a 5 GHz SSID,
  which the ESP32-C3 cannot join directly.
