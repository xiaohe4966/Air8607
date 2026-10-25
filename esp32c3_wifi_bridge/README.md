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

The AP is not always on: it starts only when no credentials are stored, or when
joining the saved network fails (30 s timeout / 5 retries).  While the C3 is
connected as a station, `Air8607-C3` will not appear in a WiFi scan — that is
expected.  To reconfigure an already-connected C3 you currently need to erase
its NVS (or add a “reset WiFi” command).

## Build and flash

Requirements: ESP-IDF 5.4 (or a compatible 5.x release).  The firmware was
built and tested with ESP-IDF 5.4.4 on macOS 15 (Python 3.9 venv).

Before building, enable the photo proxy by copying the token template:

```bash
cp main/secrets.h.example main/secrets.h   # then fill in PHOTO_TOKEN
```

If `export.sh` picks the wrong Python (Homebrew 3.14 instead of the 3.9 venv
created by `install.sh`), put `/usr/bin` first on `PATH` before sourcing it:

```bash
cd esp32c3_wifi_bridge
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
source ~/esp/v5.4/esp-idf/export.sh
idf.py set-target esp32c3
idf.py build
```

On the tested board the ESP32-C3 (QFN32 rev0.3) sits behind a CH343 USB-UART
bridge and enumerates as `/dev/cu.usbmodemXXXX`.  The rev0.3 ROM on this link
rejects 0x400-byte `FLASH_DATA` packets (checksum / message-format errors), so
the helper splits every ROM block into 256-byte packets:

```bash
./flash_c3.sh /dev/cu.usbmodemXXXX
```

The split lives in [`esptool_256.py`](./esptool_256.py) and is used
with `--no-stub`.  It is slower (~114 s for the 1 MB app) but reliable.  If
your board accepts `idf.py flash`, use that instead.

## UART protocol

Air8607 → ESP32-C3 (one ASCII command per line):

| Command | Response |
| --- | --- |
| `HELLO` | firmware/version hello |
| `STATUS` | WiFi, local IP, fetch state |
| `FETCH` | cached `netinfo`, or `not_ready` |
| `PING` | `pong` |
| `PHOTO RANDOM <seq>` | photo header, then JPEG bytes |
| `PHOTO LIKED <seq>` | photo header, then JPEG bytes |
| `PHOTO CANCEL` | cancels the photo in flight |
| `REACT <seq> <id> <like\|dislike\|none>` | react result |
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

## Photo proxy (firmware 1.1.0+)

The bridge can also download photos for the Air8607 album.  The token is
compiled in rather than sent over UART:

```bash
cd main
cp secrets.h.example secrets.h
# edit secrets.h: #define PHOTO_TOKEN "..."
```

`main/secrets.h` is git-ignored.  If it is missing or empty, photo commands
answer `{"type":"photo","ok":false,"err":"no_token"}` and the rest of the
bridge (IP/time, provisioning) still works.

Photo flow:

1. Air8607 sends `PHOTO RANDOM 7` or `PHOTO LIKED 7` (`seq` is echoed back).
2. ESP32-C3 performs `GET http://img.he66.cn/api/photo/{random,liked}?token=…`
   with a 600 s timeout, reads `Content-Length`, and captures
   `X-Photo-Id` / `X-Photo-Width` / `X-Photo-Height` from the response headers
   in the `HTTP_EVENT_ON_HEADER` callback (`esp_http_client_get_header` only
   exposes *request* headers).
3. It sends one JSON line, then exactly `len` raw JPEG bytes:

```json
{"type":"photo","ok":true,"seq":7,"id":8190,"len":210348,"w":1024,"h":1365,"src":"random"}
```

4. Errors before the byte stream starts look like
   `{"type":"photo","ok":false,"seq":7,"err":"wifi_not_ready"}`.  If the
   transfer is cancelled after bytes have started, the firmware ends the
   partial stream with `{"type":"photo","ok":false,"seq":7,"err":"cancelled"}`
   so the Air8607 can resynchronise to line mode.  A truncated transfer (socket
   error) sends no trailing JSON; the Air8607 detects the stall after 15 s and
   retries.

`PHOTO CANCEL` sets a flag checked between 4 KB chunks, and `s_uart_tx_lock`
keeps the header + JPEG contiguous.  While a photo is streaming, other
commands are ignored except `PHOTO …` and `REACT …`; `HELLO`/`STATUS` are
remembered and answered immediately after the transfer, so they never inject a
JSON line into the JPEG body.

Only the newest photo request matters: a new `PHOTO RANDOM/LIKED` cancels the
transfer in flight, drops queued photo commands, and then starts the new one.
This prevents stale frames queued in an earlier Air8607 session from being
replayed.

Likes use `POST http://img.he66.cn/api/photo/react` with
`id=<file_id>&action=<like|dislike|none>`:

```json
{"type":"react","ok":true,"seq":3,"id":8190,"state":1}
```

`state` is the server's `like_state`: `1` liked, `-1` disliked, `0` none.

Requests run on a dedicated `photo_task` (queue length 4, 8 KB stack) so the
UART reader never blocks on TLS.  Photo and react requests are refused with
`wifi_not_ready` while the provisioning AP is active.

## Files

| File | Purpose |
| --- | --- |
| `main/main.c` | WiFi, provisioning HTTP server, HTTPS fetch, photo proxy, UART protocol |
| `main/secrets.h.example` | Template for `PHOTO_TOKEN` (copy to `secrets.h`, git-ignored) |
| `partitions.csv` | 4 MB flash layout: 24 KB NVS + 1.9 MB app |
| `sdkconfig.defaults` | ESP32-C3, 4 MB, DIO, certificate bundle, HTTP server limits |
| `flash_c3.sh` | Build and flash helper using the ROM loader (`--no-stub`) |
| `esptool_256.py` | esptool wrapper that writes 256-byte ROM packets (rev0.3 + CH343 workaround) |

## Test status

- Firmware 1.1.1 builds with ESP-IDF 5.4.4 (`idf.py build`, app 0xf6780 bytes,
  50% of the 1.9 MB partition free).
- Flashed to ESP32-C3 (QFN32 rev0.3, MAC `60:55:f9:71:d8:e0`, 4 MB MXIC flash);
  boot log confirms UART1 GPIO4/5 at 115200 8N1, WiFi connected
  (`172.22.22.119`) and `Air8607 ESP32-C3 WiFi bridge 1.1.1`.
- Provisioning AP `Air8607-C3` (HTTP on `192.168.4.1:80`), SNTP clock sync and
  the HTTPS public-IP request were verified on the same board.
- End-to-end with the album (2026-10-25): the C3 downloaded 100–470 KB JPEGs
  with the correct `X-Photo-Id`/width/height, the Air8607 wrote them to
  `/ram/album_a.jpg` / `album_b.jpg`, decoded and displayed them, prefetched
  the next photo and advanced after the 60 s interval.
- `REACT` parsed `{"code":0,"data":{"like_state":…}}` and returned
  `{"type":"react","ok":true,...}` (verified against the live API in an earlier
  session; the like state was restored afterwards).
- Response headers are captured via the event callback; request-header lookup
  (`esp_http_client_get_header`) returns `id=0`, which broke likes before 1.1.1.
- Photo sizes like 1024×1365 are not 16-aligned; AirUI logs
  `skip HW, risky jpeg … not 16-aligned` and decodes them in software.  Images
  whose width/height are multiples of 16 use the hardware decoder.
