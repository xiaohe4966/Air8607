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

### ESP32-C3 SuperMini

The pin names are the same; on the SuperMini board (USB-C at the top) the two
pins are on opposite sides:

| SuperMini pin | Position | Connect to |
| --- | --- | --- |
| `GPIO4` | left column, 4th from the top (below `3V3`) | Air8607 J110 pin 5 `RX2` |
| `GPIO5` | right column, top pin | Air8607 J110 pin 6 `TX2` |
| `GND` | left column, 2nd from the top | Air8607 J110 pin 3 or 7 `GND` |

- Follow the silkscreen, not the counting: clone boards sometimes swap the two
  columns.
- Power the SuperMini from its own USB-C port.  The two on-board buttons are
  `BOOT` (GPIO9) and `RST`.
- The SuperMini has no auto-reset circuit, so esptool cannot always restart it
  into download mode: hold `BOOT`, plug in USB (or press `RST`), release `BOOT`,
  then flash.
- The native USB port is `/dev/cu.usbmodem*` (no CH343 involved); the firmware
  console is mirrored on USB-Serial-JTAG, so a normal `idf.py -p <port> monitor`
  shows the boot log.

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
| `HELLO` | firmware/version hello (`proto` 3) |
| `STATUS` | WiFi, local IP, fetch state |
| `FETCH` | cached `netinfo`, or `not_ready` |
| `PING` | `pong` |
| `LIST <seq> <after_id> <limit> <filter>` | `list` header, N × `item`, `list_end` |
| `PHOTO <seq> <id>` | photo header, then JPEG bytes |
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

## Photo proxy (firmware 1.2.x)

The bridge can also fetch photos for the Air8607 album.  The token is compiled
in rather than sent over UART, and it is only ever used as the `X-API-Key`
request header — it never appears in a URL or in a log line:

```bash
cd main
cp secrets.h.example secrets.h
# edit secrets.h: #define PHOTO_TOKEN "..."
```

`main/secrets.h` is git-ignored.  If it is missing or empty, photo commands
answer `{"type":"photo","ok":false,"err":"no_token"}` and the rest of the
bridge (IP/time, provisioning) still works.

### Photo index (`GET /api/photo/list`)

1. Air8607 sends `LIST <seq> <after_id> <limit> <filter>`.  `limit` is clamped
   to 1…25 (the JSON body is parsed in one 32 KB buffer, so a bigger page
   would risk the ~150 KB of internal RAM); `filter` is the API's
   `like_state`: `1` liked, `0` unmarked, `-1` disliked, `-2` (or anything out
   of range) = no filter.
2. ESP32-C3 performs `GET http://img.he66.cn/api/photo/list?limit=…&after_id=…`
   (plus `&like_state=…` unless the filter is "no filter") with a 30 s timeout
   and forwards one line per photo, keeping each line short enough for the
   Air8607 line reader:

```json
{"type":"list","ok":true,"seq":4,"total":229,"has_more":true,"next_after_id":15351}
{"type":"item","seq":4,"id":15221,"key":"9f1c…","lk":1,"t":"2026-08-12 09:41:03"}
{"type":"list_end","seq":4,"count":25}
```

`key` is the de-duplication key: the photo's `content_hash`, falling back to
`file_id` when the server has no hash.  `count` is what the C3 actually
forwarded, so the Air8607 notices a truncated page.  The `list` header is sent
before the loop and the body buffer is freed before parsing, so only one JSON
tree is alive at a time.

### Photo bytes (`GET /api/photo/show`)

1. Air8607 sends `PHOTO <seq> <id>` (`seq` is echoed back).
2. ESP32-C3 performs `GET http://img.he66.cn/api/photo/show?id=…` with a 30 s
   timeout, reads `Content-Length`, and captures `X-Photo-Id` /
   `X-Photo-Width` / `X-Photo-Height` from the response headers in the
   `HTTP_EVENT_ON_HEADER` callback (`esp_http_client_get_header` only exposes
   *request* headers).
3. It sends one JSON line, then exactly `len` raw JPEG bytes:

```json
{"type":"photo","ok":true,"seq":7,"id":15221,"len":120533,"w":1024,"h":600}
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
commands are ignored except `PHOTO …`, `LIST …` and `REACT …`; `HELLO`/`STATUS`
are remembered and answered immediately after the transfer, so they never
inject a JSON line into the JPEG body.

Only one photo/index request is in flight at a time: a new `PHOTO`/`LIST`
cancels the transfer in flight and drops queued photo commands.  This prevents
stale frames queued in an earlier Air8607 session from being replayed.

The UART reader ignores bytes below `0x20` and above `0x7e`.  The Air8607
drives the line low while it resets, which otherwise filled the 512-byte
command buffer with `0x00` glitches and made the C3 answer `line_too_long` for
the first real command after a reboot.

Likes use `POST http://img.he66.cn/api/photo/react` with
`id=<file_id>&action=<like|dislike|none>` in the body:

```json
{"type":"react","ok":true,"seq":3,"id":15221,"state":1}
```

`state` is the server's `like_state`: `1` liked, `-1` disliked, `0` none.

Requests run on a dedicated `photo_task` (queue length 4, 8 KB stack) so the
UART reader never blocks on TLS.  Photo, index and react requests are refused
with `wifi_not_ready` while the provisioning AP is active.

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

- Firmware 1.2.1 builds with ESP-IDF 5.4.4 (`idf.py build`, app image
  1012160 bytes, about half of the 1.9 MB factory partition free).
- Flashed to ESP32-C3 (QFN32 rev0.3, MAC `60:55:f9:71:d8:e0`, 4 MB MXIC flash);
  boot log confirms UART1 GPIO4/5 at 115200 8N1, WiFi connected
  (`172.22.22.199`) and `Air8607 ESP32-C3 WiFi bridge 1.2.1`.
- Provisioning AP `Air8607-C3` (HTTP on `192.168.4.1:80`), SNTP clock sync and
  the HTTPS public-IP request were verified on the same board.
- End-to-end with the album (2026-11-01): `HELLO` answered
  `hello 1.2.1 3 list=1`, `LIST 1 0 25 1` returned the `list` head
  (`total=229`, `next_after_id`, `has_more`) plus 25 `item` lines and
  `list_end count=25`; `PHOTO <seq> <id>` then streamed the matching JPEG
  (74–218 KB observed) with the correct `id/len/w/h`, and the Air8607 wrote it
  to `/sd/album/album_a.jpg`, validated and displayed it.  Paging to the tail of
  the liked set (`after_id=29803`) returned 13 items with `has_more=false`, and
  pages past the end return 0 items with `next_after_id` equal to the requested
  cursor — the album uses that to stop a stalled cursor instead of re-reading the
  same page.
- HTTP timeouts are now 30 s for both photo and index requests (was 600 s), and
  the transfer is checked for `PHOTO CANCEL` between chunks, so a stuck server no
  longer blocks `HELLO`/`STATUS` keepalive.
- The UART reader only accepts printable ASCII (0x20–0x7E).  Without this, the
  Air8607's RTS reset pulse drags the C3 RX line low and the firmware collected
  hundreds of `0x00` into the command buffer and answered `line_too_long`, which
  cost the album its first index page.
- `REACT` parsed `{"code":0,"data":{"like_state":…}}` and returned
  `{"type":"react","ok":true,...}` (verified against the live API in an earlier
  session; the like state was restored afterwards).
- Response headers are captured via the event callback; request-header lookup
  (`esp_http_client_get_header`) returns `id=0`, which broke likes before 1.1.1.
- Photos served to the device are 1024×600; the height is not a multiple of 16,
  so AirUI logs `skip HW, risky jpeg … not 16-aligned` and decodes them in
  software.  Images whose width/height are multiples of 16 use the hardware
  decoder.
