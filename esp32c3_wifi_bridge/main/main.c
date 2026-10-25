/*
 * Air8607 ESP32-C3 WiFi bridge
 *
 * The ESP32-C3 joins a WiFi network and exposes a tiny line-oriented JSON
 * protocol on UART1.  The Air8607 sends commands and receives the public IP
 * and server time fetched once at boot from:
 *
 *     https://tool.he4966.cn/api/tool/get_my_ip
 *
 * Wiring (ESP32-C3 -> Air8607 J110):
 *     GPIO4  UART1_TX -> J110 pin 5  RX2
 *     GPIO5  UART1_RX <- J110 pin 6  TX2
 *     GND              -> GND
 *
 * The ESP32-C3 is powered from its own USB/3.3V supply during development.
 * Do not power it from Air1603 VDD_EXT (that pin is intended for pull-ups).
 */

#include <ctype.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

#include "cJSON.h"
#include "driver/gpio.h"
#include "driver/uart.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_sntp.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"

#if defined(__has_include)
#if __has_include("secrets.h")
#include "secrets.h"
#endif
#endif

#ifndef PHOTO_TOKEN
#define PHOTO_TOKEN ""
#endif

#define TAG "air8607-c3"

#define UART_PORT       UART_NUM_1
#define UART_TX_GPIO    GPIO_NUM_4
#define UART_RX_GPIO    GPIO_NUM_5
#define UART_BAUD       115200
#define UART_RX_BUF     4096
#define UART_TX_BUF     8192

#define API_URL         "https://tool.he4966.cn/api/tool/get_my_ip"
#define API_HOST        "tool.he4966.cn"
#define AP_SSID         "Air8607-C3"
#define AP_PASS         "air8607wifi"
#define FW_VERSION      "1.1.1"
#define NVS_NAMESPACE   "air8607"
#define STA_MAX_RETRY   5

#define PHOTO_BASE      "http://img.he66.cn/api/photo"
#define PHOTO_TIMEOUT_MS 600000
#define PHOTO_BUF_SIZE  4096
#define PHOTO_QUEUE_LEN 4

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

typedef struct {
    bool sta_connected;
    bool ap_mode;
    bool fetch_done;
    bool fetch_ok;
    int  api_code;
    char api_msg[48];
    char public_ip[48];
    char server_time[24];
    char server_date[24];
    char local_ip[16];
    char error[96];
} bridge_state_t;

typedef struct {
    bool ok;
    int  code;
    char msg[48];
    char ip[48];
    char time[24];
    char date[24];
    char error[96];
} fetch_result_t;

#define PHOTO_CMD_RANDOM 0
#define PHOTO_CMD_LIKED  1
#define PHOTO_CMD_REACT  2

typedef struct {
    uint8_t kind;
    int seq;
    long id;
    char action[8];
} photo_cmd_t;

static const char *PROV_HTML =
    "<!doctype html><html><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<title>Air8607 WiFi</title>"
    "<style>"
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
    "background:#07111f;color:#e6eefc;margin:0;padding:28px}"
    ".card{max-width:420px;margin:0 auto;background:#0f1e31;border:1px solid #203550;"
    "border-radius:14px;padding:24px}"
    "h1{font-size:22px;margin:0 0 8px}p{color:#7f98b8;font-size:14px;line-height:1.55}"
    "label{display:block;margin:18px 0 6px;font-size:14px;color:#b9cbe4}"
    "input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:8px;"
    "border:1px solid #2a4562;background:#0b1727;color:#e6eefc;font-size:16px}"
    "button{width:100%;margin-top:22px;padding:12px;border:0;border-radius:8px;"
    "background:#1e6bff;color:#fff;font-size:16px;font-weight:600}"
    "code{color:#22d3ee}.hint{margin-top:18px;font-size:12px}"
    "</style></head><body><div class=\"card\">"
    "<h1>Air8607 WiFi 配网</h1>"
    "<p>ESP32-C3 将连接下面的 WiFi，并为 Air8607 提供网络。</p>"
    "<form method=\"post\" action=\"/save\">"
    "<label>WiFi 名称 (SSID)</label>"
    "<input name=\"ssid\" maxlength=\"32\" required autofocus>"
    "<label>WiFi 密码</label>"
    "<input name=\"pass\" type=\"password\" maxlength=\"64\">"
    "<button type=\"submit\">保存并重启</button></form>"
    "<p class=\"hint\">配网热点：<code>Air8607-C3</code> / <code>air8607wifi</code><br>"
    "配置地址：<code>http://192.168.4.1/</code></p>"
    "</div></body></html>";

static bridge_state_t s_state;
static SemaphoreHandle_t s_state_lock;
static SemaphoreHandle_t s_uart_tx_lock;
static EventGroupHandle_t s_wifi_events;
static httpd_handle_t s_httpd;
static int s_retry_num;
static volatile bool s_sntp_synced;
static QueueHandle_t s_photo_queue;
static volatile bool s_photo_busy;
static volatile bool s_photo_cancel;
static volatile bool s_hello_pending;
static volatile bool s_status_pending;

static void state_snapshot(bridge_state_t *out)
{
    xSemaphoreTake(s_state_lock, portMAX_DELAY);
    *out = s_state;
    xSemaphoreGive(s_state_lock);
}

static void state_set_wifi(bool connected, const char *ip, bool ap_mode)
{
    xSemaphoreTake(s_state_lock, portMAX_DELAY);
    s_state.sta_connected = connected;
    s_state.ap_mode = ap_mode;
    if (ip) {
        snprintf(s_state.local_ip, sizeof(s_state.local_ip), "%s", ip);
    } else {
        s_state.local_ip[0] = '\0';
    }
    xSemaphoreGive(s_state_lock);
}

static void state_set_error(const char *error)
{
    xSemaphoreTake(s_state_lock, portMAX_DELAY);
    snprintf(s_state.error, sizeof(s_state.error), "%s", error ? error : "");
    xSemaphoreGive(s_state_lock);
}

static void state_set_fetch_result(const fetch_result_t *result)
{
    xSemaphoreTake(s_state_lock, portMAX_DELAY);
    s_state.fetch_done = true;
    s_state.fetch_ok = result->ok;
    s_state.api_code = result->code;
    snprintf(s_state.api_msg, sizeof(s_state.api_msg), "%s", result->msg);
    snprintf(s_state.public_ip, sizeof(s_state.public_ip), "%s", result->ip);
    snprintf(s_state.server_time, sizeof(s_state.server_time), "%s", result->time);
    snprintf(s_state.server_date, sizeof(s_state.server_date), "%s", result->date);
    snprintf(s_state.error, sizeof(s_state.error), "%s", result->ok ? "" : result->error);
    xSemaphoreGive(s_state_lock);
}

static esp_err_t nvs_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    return err;
}

static bool load_wifi_config(char *ssid, size_t ssid_len, char *pass, size_t pass_len)
{
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle) != ESP_OK) {
        return false;
    }

    size_t len = ssid_len;
    esp_err_t err = nvs_get_str(handle, "ssid", ssid, &len);
    if (err == ESP_OK) {
        len = pass_len;
        err = nvs_get_str(handle, "pass", pass, &len);
    }
    nvs_close(handle);

    if (err != ESP_OK || ssid[0] == '\0') {
        ssid[0] = '\0';
        pass[0] = '\0';
        return false;
    }
    return true;
}

static esp_err_t save_wifi_config(const char *ssid, const char *pass)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }
    err = nvs_set_str(handle, "ssid", ssid);
    if (err == ESP_OK) {
        err = nvs_set_str(handle, "pass", pass);
    }
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    nvs_close(handle);
    return err;
}

static void uart_send_json(cJSON *object)
{
    char *text = cJSON_PrintUnformatted(object);
    if (text) {
        xSemaphoreTake(s_uart_tx_lock, portMAX_DELAY);
        uart_write_bytes(UART_PORT, text, strlen(text));
        uart_write_bytes(UART_PORT, "\n", 1);
        uart_wait_tx_done(UART_PORT, pdMS_TO_TICKS(100));
        xSemaphoreGive(s_uart_tx_lock);
        cJSON_free(text);
    }
    cJSON_Delete(object);
}

static void uart_send_hello(void)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "hello");
    cJSON_AddStringToObject(root, "fw", FW_VERSION);
    cJSON_AddNumberToObject(root, "proto", 2);
    uart_send_json(root);
}

static void uart_send_status(void)
{
    bridge_state_t state;
    state_snapshot(&state);

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "status");
    cJSON_AddBoolToObject(root, "wifi", state.sta_connected);
    cJSON_AddStringToObject(root, "mode", state.ap_mode ? "ap" : "sta");
    cJSON_AddStringToObject(root, "local_ip", state.local_ip);
    cJSON_AddBoolToObject(root, "fetch_done", state.fetch_done);
    cJSON_AddBoolToObject(root, "fetch_ok", state.fetch_ok);
    cJSON_AddNumberToObject(root, "code", state.api_code);
    cJSON_AddStringToObject(root, "msg", state.api_msg);
    cJSON_AddStringToObject(root, "date", state.server_date);
    cJSON_AddStringToObject(root, "ip", state.public_ip);
    cJSON_AddStringToObject(root, "err", state.error);
    uart_send_json(root);
}

static void uart_send_netinfo(void)
{
    bridge_state_t state;
    state_snapshot(&state);

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "netinfo");
    cJSON_AddBoolToObject(root, "fetch_done", state.fetch_done);
    cJSON_AddBoolToObject(root, "ok", state.fetch_ok);
    cJSON_AddNumberToObject(root, "code", state.api_code);
    cJSON_AddStringToObject(root, "msg", state.api_msg);
    cJSON_AddStringToObject(root, "local_ip", state.local_ip);
    cJSON_AddStringToObject(root, "date", state.server_date);
    cJSON_AddStringToObject(root, "ip", state.public_ip);
    if (!state.fetch_ok) {
        cJSON_AddStringToObject(root, "err",
                                state.error[0] ? state.error : "not_ready");
    }

    if (state.server_time[0]) {
        bool digits = true;
        for (const char *p = state.server_time; *p; p++) {
            if (!isdigit((unsigned char)*p)) {
                digits = false;
                break;
            }
        }
        if (digits) {
            cJSON_AddNumberToObject(root, "time",
                                    (double)strtoll(state.server_time, NULL, 10));
        } else {
            cJSON_AddStringToObject(root, "time", state.server_time);
        }
    }

    uart_send_json(root);
}

static void uart_send_error(const char *message)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "error");
    cJSON_AddStringToObject(root, "err", message ? message : "error");
    uart_send_json(root);
}

static bool wifi_is_ready(void)
{
    bridge_state_t state;
    state_snapshot(&state);
    return state.sta_connected && !state.ap_mode;
}

typedef struct {
    long id;
    int  w;
    int  h;
} photo_meta_t;

static esp_err_t photo_http_event(esp_http_client_event_t *ev)
{
    if (ev->event_id != HTTP_EVENT_ON_HEADER || !ev->user_data) {
        return ESP_OK;
    }
    photo_meta_t *meta = ev->user_data;
    if (strcasecmp(ev->header_key, "X-Photo-Id") == 0) {
        meta->id = atol(ev->header_value);
    } else if (strcasecmp(ev->header_key, "X-Photo-Width") == 0) {
        meta->w = atoi(ev->header_value);
    } else if (strcasecmp(ev->header_key, "X-Photo-Height") == 0) {
        meta->h = atoi(ev->header_value);
    }
    return ESP_OK;
}

static void photo_send_error(int seq, const char *err)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "photo");
    cJSON_AddBoolToObject(root, "ok", false);
    cJSON_AddNumberToObject(root, "seq", seq);
    cJSON_AddStringToObject(root, "err", err ? err : "error");
    uart_send_json(root);
}

static void photo_send_react(int seq, bool ok, long id, int state, const char *err)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "react");
    cJSON_AddBoolToObject(root, "ok", ok);
    cJSON_AddNumberToObject(root, "seq", seq);
    cJSON_AddNumberToObject(root, "id", (double)id);
    if (ok) {
        cJSON_AddNumberToObject(root, "state", state);
    } else {
        cJSON_AddStringToObject(root, "err", err ? err : "react_failed");
    }
    uart_send_json(root);
}

static void photo_fetch(photo_cmd_t *cmd)
{
    if (!wifi_is_ready()) {
        photo_send_error(cmd->seq, "wifi_not_ready");
        return;
    }
    if (PHOTO_TOKEN[0] == '\0') {
        photo_send_error(cmd->seq, "no_token");
        return;
    }

    char url[256];
    snprintf(url, sizeof(url), PHOTO_BASE "/%s?token=%s",
             cmd->kind == PHOTO_CMD_LIKED ? "liked" : "random", PHOTO_TOKEN);

    photo_meta_t meta = {0};
    esp_http_client_config_t config = {
        .url = url,
        .timeout_ms = PHOTO_TIMEOUT_MS,
        .buffer_size = 2048,
        .buffer_size_tx = 512,
        .event_handler = photo_http_event,
        .user_data = &meta,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        photo_send_error(cmd->seq, "http_init");
        return;
    }

    esp_http_client_set_header(client, "User-Agent", "Air8607-C3-Bridge/1.1");
    esp_err_t err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "photo open failed: %s", esp_err_to_name(err));
        esp_http_client_cleanup(client);
        photo_send_error(cmd->seq, "http_open");
        return;
    }

    int content_length = esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);
    ESP_LOGI(TAG, "photo %s status=%d len=%d", url, status, content_length);

    if (status != 200 || content_length <= 0) {
        char why[32];
        if (status != 200) {
            snprintf(why, sizeof(why), "http_status_%d", status);
        } else {
            snprintf(why, sizeof(why), "no_length");
        }
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        photo_send_error(cmd->seq, why);
        return;
    }

    if (s_photo_cancel) {
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        ESP_LOGI(TAG, "photo seq %d cancelled before body", cmd->seq);
        return;
    }

    long photo_id = meta.id;
    int photo_w = meta.w;
    int photo_h = meta.h;

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "photo");
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddNumberToObject(root, "seq", cmd->seq);
    cJSON_AddNumberToObject(root, "id", (double)photo_id);
    cJSON_AddNumberToObject(root, "len", content_length);
    cJSON_AddNumberToObject(root, "w", photo_w);
    cJSON_AddNumberToObject(root, "h", photo_h);
    cJSON_AddStringToObject(root, "src",
                            cmd->kind == PHOTO_CMD_LIKED ? "liked" : "random");
    char *text = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    uint8_t *buf = malloc(PHOTO_BUF_SIZE);
    if (!text || !buf) {
        if (text) cJSON_free(text);
        free(buf);
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        photo_send_error(cmd->seq, "no_memory");
        return;
    }

    /* 头部和 JPEG 必须连续发送，不能插入状态 JSON */
    xSemaphoreTake(s_uart_tx_lock, portMAX_DELAY);
    uart_write_bytes(UART_PORT, text, strlen(text));
    uart_write_bytes(UART_PORT, "\n", 1);
    cJSON_free(text);

    int total = 0;
    bool cancelled = false;
    bool failed = false;
    while (total < content_length) {
        if (s_photo_cancel) {
            cancelled = true;
            break;
        }
        int read = esp_http_client_read(client, (char *)buf, PHOTO_BUF_SIZE);
        if (read < 0) {
            failed = true;
            break;
        }
        if (read == 0) {
            break;
        }
        uart_write_bytes(UART_PORT, (const char *)buf, read);
        total += read;
    }
    xSemaphoreGive(s_uart_tx_lock);

    free(buf);
    esp_http_client_close(client);
    esp_http_client_cleanup(client);

    if (cancelled) {
        ESP_LOGW(TAG, "photo cancelled at %d/%d", total, content_length);
        /* 用一行 JSON 结束半截字节流，让 Air8607 能重新对齐到行模式 */
        photo_send_error(cmd->seq, "cancelled");
    } else if (failed || total != content_length) {
        ESP_LOGE(TAG, "photo truncated %d/%d", total, content_length);
    } else {
        ESP_LOGI(TAG, "photo ok id=%ld bytes=%d", photo_id, total);
    }
    /* 字节流已经开始，失败时不再补 JSON；Air8607 15 秒收不到数据会自行中止 */
}

static void photo_react(photo_cmd_t *cmd)
{
    if (!wifi_is_ready()) {
        photo_send_react(cmd->seq, false, cmd->id, 0, "wifi_not_ready");
        return;
    }
    if (PHOTO_TOKEN[0] == '\0') {
        photo_send_react(cmd->seq, false, cmd->id, 0, "no_token");
        return;
    }
    if (strcasecmp(cmd->action, "like") != 0 &&
        strcasecmp(cmd->action, "dislike") != 0 &&
        strcasecmp(cmd->action, "none") != 0) {
        photo_send_react(cmd->seq, false, cmd->id, 0, "bad_action");
        return;
    }

    char url[256];
    snprintf(url, sizeof(url), PHOTO_BASE "/react?token=%s", PHOTO_TOKEN);
    char body[64];
    snprintf(body, sizeof(body), "id=%ld&action=%s", cmd->id, cmd->action);

    esp_http_client_config_t config = {
        .url = url,
        .timeout_ms = 30000,
        .buffer_size = 1024,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        photo_send_react(cmd->seq, false, cmd->id, 0, "http_init");
        return;
    }
    esp_http_client_set_method(client, HTTP_METHOD_POST);
    esp_http_client_set_header(client, "Content-Type", "application/x-www-form-urlencoded");
    esp_http_client_set_post_field(client, body, strlen(body));

    esp_err_t err = esp_http_client_open(client, strlen(body));
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "react open failed: %s", esp_err_to_name(err));
        esp_http_client_cleanup(client);
        photo_send_react(cmd->seq, false, cmd->id, 0, "http_open");
        return;
    }
    esp_http_client_write(client, body, strlen(body));
    esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);

    char resp[512];
    int n = 0;
    while (n < (int)sizeof(resp) - 1) {
        int read = esp_http_client_read(client, resp + n, sizeof(resp) - 1 - n);
        if (read <= 0) break;
        n += read;
    }
    resp[n] = '\0';
    esp_http_client_close(client);
    esp_http_client_cleanup(client);

    ESP_LOGI(TAG, "react id=%ld action=%s status=%d body=%s",
             cmd->id, cmd->action, status, resp);

    if (status != 200) {
        char why[32];
        snprintf(why, sizeof(why), "http_status_%d", status);
        photo_send_react(cmd->seq, false, cmd->id, 0, why);
        return;
    }

    int state = 0;
    bool ok = false;
    cJSON *root = cJSON_Parse(resp);
    if (root) {
        cJSON *code = cJSON_GetObjectItemCaseSensitive(root, "code");
        cJSON *data = cJSON_GetObjectItemCaseSensitive(root, "data");
        cJSON *like_state = data ? cJSON_GetObjectItemCaseSensitive(data, "like_state") : NULL;
        if (cJSON_IsNumber(code) && code->valueint == 0) {
            ok = true;
        }
        if (cJSON_IsNumber(like_state)) {
            state = like_state->valueint;
        }
        cJSON_Delete(root);
    }
    photo_send_react(cmd->seq, ok, cmd->id, state, ok ? NULL : "json_parse");
}

static void photo_task(void *arg)
{
    photo_cmd_t cmd;
    while (true) {
        if (xQueueReceive(s_photo_queue, &cmd, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        s_photo_busy = true;
        s_photo_cancel = false;
        if (cmd.kind == PHOTO_CMD_REACT) {
            photo_react(&cmd);
        } else {
            photo_fetch(&cmd);
        }
        s_photo_busy = false;
        if (s_hello_pending) {
            s_hello_pending = false;
            uart_send_hello();
        }
        if (s_status_pending) {
            s_status_pending = false;
            uart_send_status();
        }
    }
}

static void photo_enqueue(photo_cmd_t *cmd)
{
    if (!s_photo_queue || xQueueSend(s_photo_queue, cmd, 0) != pdTRUE) {
        if (cmd->kind == PHOTO_CMD_REACT) {
            photo_send_react(cmd->seq, false, cmd->id, 0, "busy");
        } else {
            photo_send_error(cmd->seq, "busy");
        }
    }
}

/* 相册只关心最新一次请求：新请求到来时取消在传的图片并丢弃排队项 */
static void photo_drop_pending(void)
{
    if (s_photo_busy) {
        s_photo_cancel = true;
    }
    if (s_photo_queue) {
        xQueueReset(s_photo_queue);
    }
}

static void handle_uart_line(char *line)
{
    while (*line == ' ' || *line == '\t') {
        line++;
    }
    size_t len = strlen(line);
    while (len > 0 && isspace((unsigned char)line[len - 1])) {
        line[--len] = '\0';
    }
    if (len == 0) {
        return;
    }

    static uint32_t rx_lines;
    rx_lines++;
    if (rx_lines <= 3 || (rx_lines % 10) == 0) {
        ESP_LOGI(TAG, "UART RX[%lu]: %s", (unsigned long)rx_lines, line);
    }

    if (s_photo_busy) {
        if (strncasecmp(line, "PHOTO", 5) != 0 &&
            strncasecmp(line, "REACT", 5) != 0) {
            /* 正在发送 JPEG，插一行 JSON 会破坏数据流；HELLO/STATUS 等发完再补 */
            if (strcasecmp(line, "HELLO") == 0) {
                s_hello_pending = true;
            } else if (strcasecmp(line, "STATUS") == 0) {
                s_status_pending = true;
            }
            return;
        }
    }

    if (strcasecmp(line, "PING") == 0) {
        cJSON *root = cJSON_CreateObject();
        cJSON_AddStringToObject(root, "type", "pong");
        cJSON_AddStringToObject(root, "fw", FW_VERSION);
        uart_send_json(root);
    } else if (strcasecmp(line, "HELLO") == 0) {
        uart_send_hello();
    } else if (strcasecmp(line, "STATUS") == 0) {
        uart_send_status();
    } else if (strcasecmp(line, "FETCH") == 0) {
        bridge_state_t state;
        state_snapshot(&state);
        if (state.fetch_done) {
            uart_send_netinfo();
        } else {
            cJSON *root = cJSON_CreateObject();
            cJSON_AddStringToObject(root, "type", "netinfo");
            cJSON_AddBoolToObject(root, "ok", false);
            cJSON_AddStringToObject(root, "err", "not_ready");
            cJSON_AddBoolToObject(root, "wifi", state.sta_connected);
            cJSON_AddStringToObject(root, "mode", state.ap_mode ? "ap" : "sta");
            cJSON_AddStringToObject(root, "local_ip", state.local_ip);
            uart_send_json(root);
        }
    } else if (strncasecmp(line, "PHOTO", 5) == 0 &&
               (line[5] == ' ' || line[5] == '\0')) {
        char kind[16] = {0};
        int pseq = 0;
        int parsed = sscanf(line + 5, "%15s %d", kind, &pseq);
        if (parsed >= 1 && strcasecmp(kind, "CANCEL") == 0) {
            s_photo_cancel = true;
        } else if (parsed >= 1) {
            photo_cmd_t cmd = {0};
            cmd.seq = pseq;
            if (strcasecmp(kind, "RANDOM") == 0) {
                cmd.kind = PHOTO_CMD_RANDOM;
            } else if (strcasecmp(kind, "LIKED") == 0) {
                cmd.kind = PHOTO_CMD_LIKED;
            } else {
                photo_send_error(pseq, "bad_kind");
                return;
            }
            photo_drop_pending();
            photo_enqueue(&cmd);
        } else {
            uart_send_error("bad_photo");
        }
    } else if (strncasecmp(line, "REACT", 5) == 0 &&
               (line[5] == ' ' || line[5] == '\0')) {
        int pseq = 0;
        long pid = 0;
        char action[8] = {0};
        if (sscanf(line + 5, "%d %ld %7s", &pseq, &pid, action) == 3 && pid > 0) {
            photo_cmd_t cmd = {0};
            cmd.kind = PHOTO_CMD_REACT;
            cmd.seq = pseq;
            cmd.id = pid;
            snprintf(cmd.action, sizeof(cmd.action), "%s", action);
            photo_enqueue(&cmd);
        } else {
            uart_send_error("bad_react");
        }
    } else if (strcasecmp(line, "REBOOT") == 0) {
        cJSON *root = cJSON_CreateObject();
        cJSON_AddStringToObject(root, "type", "ack");
        cJSON_AddStringToObject(root, "cmd", "reboot");
        uart_send_json(root);
        vTaskDelay(pdMS_TO_TICKS(200));
        esp_restart();
    } else {
        uart_send_error("unknown_command");
    }
}

static void uart_bridge_task(void *arg)
{
    uint8_t chunk[256];
    char line[512];
    size_t line_len = 0;

    while (true) {
        int read = uart_read_bytes(UART_PORT, chunk, sizeof(chunk),
                                   pdMS_TO_TICKS(100));
        for (int i = 0; i < read; i++) {
            char ch = (char)chunk[i];
            if (ch == '\n') {
                line[line_len] = '\0';
                handle_uart_line(line);
                line_len = 0;
            } else if (ch != '\r') {
                if (line_len < sizeof(line) - 1) {
                    line[line_len++] = ch;
                } else {
                    line_len = 0;
                    uart_send_error("line_too_long");
                }
            }
        }
    }
}

static void uart_bridge_start(void)
{
    s_uart_tx_lock = xSemaphoreCreateMutex();
    configASSERT(s_uart_tx_lock);

    const uart_config_t config = {
        .baud_rate = UART_BAUD,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    ESP_ERROR_CHECK(uart_driver_install(UART_PORT, UART_RX_BUF, UART_TX_BUF,
                                        0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(UART_PORT, &config));
    ESP_ERROR_CHECK(uart_set_pin(UART_PORT, UART_TX_GPIO, UART_RX_GPIO,
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
    gpio_set_pull_mode(UART_RX_GPIO, GPIO_PULLUP_ONLY);

    xTaskCreate(uart_bridge_task, "uart_bridge", 4096, NULL, 5, NULL);
    vTaskDelay(pdMS_TO_TICKS(100));
    uart_send_hello();
    ESP_LOGI(TAG, "UART%d ready: TX=GPIO%d RX=GPIO%d %d 8N1",
             UART_PORT, UART_TX_GPIO, UART_RX_GPIO, UART_BAUD);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT &&
               event_id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *event =
            (wifi_event_sta_disconnected_t *)event_data;
        ESP_LOGW(TAG, "STA disconnected, reason=%d", event ? event->reason : -1);
        state_set_wifi(false, NULL, false);
        if (s_retry_num < STA_MAX_RETRY) {
            s_retry_num++;
            esp_wifi_connect();
        } else {
            xEventGroupSetBits(s_wifi_events, WIFI_FAIL_BIT);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        char ip[16];
        snprintf(ip, sizeof(ip), IPSTR, IP2STR(&event->ip_info.ip));
        ESP_LOGI(TAG, "got IP: %s", ip);
        s_retry_num = 0;
        state_set_wifi(true, ip, false);
        state_set_error("");
        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
    }
}

static esp_err_t wifi_hw_init(void)
{
    s_wifi_events = xEventGroupCreate();
    if (!s_wifi_events) {
        return ESP_ERR_NO_MEM;
    }

    ESP_ERROR_CHECK(esp_netif_init());
    esp_err_t err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }
    esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();

    wifi_init_config_t init_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_config));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, NULL));
    return ESP_OK;
}

static void copy_cstr(uint8_t *dst, size_t dst_size, const char *src)
{
    size_t len = strlen(src);
    if (len >= dst_size) {
        len = dst_size - 1;
    }
    memcpy(dst, src, len);
    dst[len] = '\0';
}

static esp_err_t wifi_start_sta(const char *ssid, const char *pass)
{
    wifi_config_t config = {0};
    copy_cstr(config.sta.ssid, sizeof(config.sta.ssid), ssid);
    copy_cstr(config.sta.password, sizeof(config.sta.password), pass);
    config.sta.threshold.authmode =
        pass[0] ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    config.sta.pmf_cfg.capable = true;
    config.sta.pmf_cfg.required = false;

    s_retry_num = 0;
    xEventGroupClearBits(s_wifi_events, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT);
    esp_wifi_stop();

    esp_err_t err = esp_wifi_set_mode(WIFI_MODE_STA);
    if (err != ESP_OK) {
        return err;
    }
    err = esp_wifi_set_config(WIFI_IF_STA, &config);
    if (err != ESP_OK) {
        return err;
    }
    err = esp_wifi_start();
    if (err != ESP_OK) {
        return err;
    }

    EventBits_t bits = xEventGroupWaitBits(
        s_wifi_events, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
        pdFALSE, pdFALSE, pdMS_TO_TICKS(30000));
    if (bits & WIFI_CONNECTED_BIT) {
        return ESP_OK;
    }
    ESP_LOGE(TAG, "STA connect failed (ssid=%s)", ssid);
    return ESP_FAIL;
}

static esp_err_t wifi_start_ap(void)
{
    wifi_config_t config = {0};
    copy_cstr(config.ap.ssid, sizeof(config.ap.ssid), AP_SSID);
    config.ap.ssid_len = strlen(AP_SSID);
    copy_cstr(config.ap.password, sizeof(config.ap.password), AP_PASS);
    config.ap.max_connection = 4;
    config.ap.authmode = WIFI_AUTH_WPA2_PSK;
    config.ap.channel = 6;

    esp_wifi_stop();
    esp_err_t err = esp_wifi_set_mode(WIFI_MODE_AP);
    if (err != ESP_OK) {
        return err;
    }
    err = esp_wifi_set_config(WIFI_IF_AP, &config);
    if (err != ESP_OK) {
        return err;
    }
    err = esp_wifi_start();
    if (err != ESP_OK) {
        return err;
    }

    state_set_wifi(false, NULL, true);
    state_set_error("wifi_config_required");
    ESP_LOGI(TAG, "provisioning AP: SSID=%s password=%s http://192.168.4.1/",
             AP_SSID, AP_PASS);
    return ESP_OK;
}

static void url_decode(const char *src, char *dst, size_t dst_len)
{
    size_t out = 0;
    for (size_t i = 0; src[i] && out + 1 < dst_len; i++) {
        if (src[i] == '%' && isxdigit((unsigned char)src[i + 1]) &&
            isxdigit((unsigned char)src[i + 2])) {
            char hex[3] = {src[i + 1], src[i + 2], '\0'};
            dst[out++] = (char)strtol(hex, NULL, 16);
            i += 2;
        } else if (src[i] == '+') {
            dst[out++] = ' ';
        } else {
            dst[out++] = src[i];
        }
    }
    dst[out] = '\0';
}

static bool form_get(const char *body, const char *key, char *out,
                     size_t out_len)
{
    const char *item = body;
    size_t key_len = strlen(key);

    while (item && *item) {
        const char *amp = strchr(item, '&');
        size_t item_len = amp ? (size_t)(amp - item) : strlen(item);
        const char *eq = memchr(item, '=', item_len);
        if (eq) {
            size_t name_len = (size_t)(eq - item);
            if (name_len == key_len && strncmp(item, key, key_len) == 0) {
                size_t value_len = item_len - name_len - 1;
                char raw[160];
                if (value_len >= sizeof(raw)) {
                    value_len = sizeof(raw) - 1;
                }
                memcpy(raw, eq + 1, value_len);
                raw[value_len] = '\0';
                url_decode(raw, out, out_len);
                return true;
            }
        }
        item = amp ? amp + 1 : NULL;
    }
    out[0] = '\0';
    return false;
}

static void restart_task(void *arg)
{
    vTaskDelay(pdMS_TO_TICKS(1200));
    esp_restart();
}

static esp_err_t root_get_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, PROV_HTML, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t save_post_handler(httpd_req_t *req)
{
    char body[512];
    int received = httpd_req_recv(req, body, sizeof(body) - 1);
    if (received == HTTPD_SOCK_ERR_TIMEOUT) {
        httpd_resp_send_408(req);
        return ESP_FAIL;
    }
    if (received <= 0) {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    body[received] = '\0';

    char ssid[33] = {0};
    char pass[65] = {0};
    if (!form_get(body, "ssid", ssid, sizeof(ssid)) || ssid[0] == '\0') {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "SSID is required");
        return ESP_FAIL;
    }
    form_get(body, "pass", pass, sizeof(pass));
    if (pass[0] != '\0' && strlen(pass) < 8) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                            "WPA2 password must be at least 8 characters");
        return ESP_FAIL;
    }

    esp_err_t err = save_wifi_config(ssid, pass);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "save WiFi config failed: %s", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR,
                            "Failed to save configuration");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "WiFi config saved: ssid=%s", ssid);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_send(req,
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>Air8607 WiFi</title></head><body style=\"font-family:sans-serif;"
        "background:#07111f;color:#e6eefc;padding:32px\">"
        "<h2>配置已保存</h2><p>ESP32-C3 正在重启并连接 WiFi。</p>"
        "<p>请重新连接原 WiFi，Air8607 会自动获取 IP 和时间。</p></body></html>",
        HTTPD_RESP_USE_STRLEN);

    xTaskCreate(restart_task, "restart", 2048, NULL, 5, NULL);
    return ESP_OK;
}

static void prov_http_start(void)
{
    if (s_httpd) {
        return;
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 4;
    config.stack_size = 8192;
    config.lru_purge_enable = true;

    esp_err_t err = httpd_start(&s_httpd, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "httpd_start failed: %s", esp_err_to_name(err));
        s_httpd = NULL;
        return;
    }

    const httpd_uri_t root_uri = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = root_get_handler,
        .user_ctx = NULL,
    };
    const httpd_uri_t save_uri = {
        .uri = "/save",
        .method = HTTP_POST,
        .handler = save_post_handler,
        .user_ctx = NULL,
    };
    httpd_register_uri_handler(s_httpd, &root_uri);
    httpd_register_uri_handler(s_httpd, &save_uri);
    ESP_LOGI(TAG, "provisioning web server listening on http://192.168.4.1/");
}

static void start_provisioning(void)
{
    esp_err_t err = wifi_start_ap();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to start provisioning AP: %s",
                 esp_err_to_name(err));
        return;
    }
    prov_http_start();
}

static void normalize_date(const char *raw, char *out, size_t out_len)
{
    if (!raw) {
        out[0] = '\0';
        return;
    }

    int year, month, day, hour, minute, second;
    if (sscanf(raw, "%4d%2d%2d %2d:%2d:%2d",
               &year, &month, &day, &hour, &minute, &second) == 6) {
        snprintf(out, out_len, "%04d-%02d-%02d %02d:%02d:%02d",
                 year, month, day, hour, minute, second);
    } else {
        snprintf(out, out_len, "%s", raw);
    }
}

static esp_err_t http_fetch_once(fetch_result_t *result)
{
    memset(result, 0, sizeof(*result));

    char *body = calloc(1, 2048);
    if (!body) {
        snprintf(result->error, sizeof(result->error), "no_memory");
        return ESP_ERR_NO_MEM;
    }

    esp_http_client_config_t config = {
        .url = API_URL,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .timeout_ms = 20000,
        .buffer_size = 1024,
        .buffer_size_tx = 512,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        snprintf(result->error, sizeof(result->error), "http_client_init");
        free(body);
        return ESP_FAIL;
    }

    esp_http_client_set_header(client, "User-Agent", "Air8607-C3-Bridge/1.0");
    esp_http_client_set_header(client, "Accept", "application/json");

    ESP_LOGI(TAG, "GET %s", API_URL);
    esp_err_t err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        snprintf(result->error, sizeof(result->error), "http_open:%s",
                 esp_err_to_name(err));
        ESP_LOGE(TAG, "%s", result->error);
        esp_http_client_cleanup(client);
        free(body);
        return err;
    }

    int content_length = esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);
    ESP_LOGI(TAG, "HTTP status=%d content_length=%d", status, content_length);

    if (status != 200) {
        snprintf(result->error, sizeof(result->error), "http_status_%d", status);
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        free(body);
        return ESP_FAIL;
    }

    int total = 0;
    while (total < (int)2048 - 1) {
        int read = esp_http_client_read(client, body + total,
                                        2047 - total);
        if (read < 0) {
            snprintf(result->error, sizeof(result->error), "http_read:%s",
                     esp_err_to_name(read));
            break;
        }
        if (read == 0) {
            break;
        }
        total += read;
    }
    body[total] = '\0';

    esp_http_client_close(client);
    esp_http_client_cleanup(client);

    if (result->error[0]) {
        ESP_LOGE(TAG, "%s", result->error);
        free(body);
        return ESP_FAIL;
    }
    if (content_length > 0 && total < content_length) {
        snprintf(result->error, sizeof(result->error), "http_truncated_%d_of_%d",
                 total, content_length);
        free(body);
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "HTTP body: %s", body);

    cJSON *root = cJSON_Parse(body);
    if (!root) {
        snprintf(result->error, sizeof(result->error), "json_parse");
        free(body);
        return ESP_FAIL;
    }

    cJSON *json_code = cJSON_GetObjectItemCaseSensitive(root, "code");
    cJSON *json_msg = cJSON_GetObjectItemCaseSensitive(root, "msg");
    cJSON *json_ip = cJSON_GetObjectItemCaseSensitive(root, "data");
    cJSON *json_time = cJSON_GetObjectItemCaseSensitive(root, "time");
    cJSON *json_date = cJSON_GetObjectItemCaseSensitive(root, "date");

    if (cJSON_IsNumber(json_code)) {
        result->code = json_code->valueint;
    } else if (cJSON_IsString(json_code)) {
        result->code = atoi(json_code->valuestring);
    }
    if (cJSON_IsString(json_msg) && json_msg->valuestring) {
        snprintf(result->msg, sizeof(result->msg), "%s", json_msg->valuestring);
    }
    if (cJSON_IsString(json_ip) && json_ip->valuestring) {
        snprintf(result->ip, sizeof(result->ip), "%s", json_ip->valuestring);
    }
    if (cJSON_IsString(json_time) && json_time->valuestring) {
        snprintf(result->time, sizeof(result->time), "%s", json_time->valuestring);
    } else if (cJSON_IsNumber(json_time)) {
        snprintf(result->time, sizeof(result->time), "%.0f", json_time->valuedouble);
    }
    if (cJSON_IsString(json_date) && json_date->valuestring) {
        normalize_date(json_date->valuestring, result->date, sizeof(result->date));
    }

    result->ok = (result->code == 1 && result->ip[0] != '\0');
    if (!result->ok) {
        snprintf(result->error, sizeof(result->error), "%s",
                 result->msg[0] ? result->msg : "api_error");
    }

    cJSON_Delete(root);
    free(body);
    return result->ok ? ESP_OK : ESP_FAIL;
}

static void sntp_sync_cb(struct timeval *tv)
{
    s_sntp_synced = true;
}

/*
 * HTTPS certificate validation needs a plausible wall clock.  A freshly
 * booted ESP32-C3 starts at 1970, which makes a 2026 Let's Encrypt
 * certificate look "not yet valid".  Sync time with SNTP before the first
 * HTTPS request; the API response is still the source shown on the display.
 */
static void set_build_time_fallback(void)
{
    struct tm build_tm = {0};
    if (strptime(__DATE__ " " __TIME__, "%b %d %Y %H:%M:%S", &build_tm) != NULL) {
        time_t build_time = mktime(&build_tm);
        struct timeval tv = {.tv_sec = build_time, .tv_usec = 0};
        settimeofday(&tv, NULL);
        ESP_LOGW(TAG, "using firmware build time as TLS fallback");
    }
}

static bool sync_time_for_tls(void)
{
    s_sntp_synced = false;
    esp_sntp_setoperatingmode(ESP_SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "ntp.aliyun.com");
    esp_sntp_setservername(1, "cn.pool.ntp.org");
    esp_sntp_setservername(2, "pool.ntp.org");
    sntp_set_time_sync_notification_cb(sntp_sync_cb);
    esp_sntp_init();

    for (int i = 0; i < 150 && !s_sntp_synced; i++) {
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    esp_sntp_stop();

    if (!s_sntp_synced) {
        ESP_LOGW(TAG, "SNTP sync timed out; HTTPS may fail certificate time check");
        set_build_time_fallback();
        return false;
    }

    time_t now = time(NULL);
    struct tm tm_now;
    localtime_r(&now, &tm_now);
    ESP_LOGI(TAG, "SNTP time: %04d-%02d-%02d %02d:%02d:%02d",
             tm_now.tm_year + 1900, tm_now.tm_mon + 1, tm_now.tm_mday,
             tm_now.tm_hour, tm_now.tm_min, tm_now.tm_sec);
    return true;
}

static void fetch_task(void *arg)
{
    vTaskDelay(pdMS_TO_TICKS(800));
    sync_time_for_tls();

    fetch_result_t result = {0};
    for (int attempt = 1; attempt <= 3; attempt++) {
        esp_err_t err = http_fetch_once(&result);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "network info: ip=%s date=%s time=%s",
                     result.ip, result.date, result.time);
            break;
        }
        ESP_LOGW(TAG, "fetch attempt %d/3 failed: %s", attempt,
                 result.error[0] ? result.error : esp_err_to_name(err));
        if (attempt < 3) {
            vTaskDelay(pdMS_TO_TICKS(3000));
        }
    }

    if (!result.ok && result.error[0] == '\0') {
        snprintf(result.error, sizeof(result.error), "fetch_failed");
    }
    state_set_fetch_result(&result);
    uart_send_netinfo();
    vTaskDelete(NULL);
}

void app_main(void)
{
    ESP_LOGI(TAG, "Air8607 ESP32-C3 WiFi bridge %s", FW_VERSION);
    ESP_LOGI(TAG, "UART bridge: GPIO%d TX -> Air8607 RX2, GPIO%d RX <- Air8607 TX2",
             UART_TX_GPIO, UART_RX_GPIO);

    ESP_ERROR_CHECK(nvs_init());
    s_state_lock = xSemaphoreCreateMutex();
    configASSERT(s_state_lock);
    memset(&s_state, 0, sizeof(s_state));

    s_photo_queue = xQueueCreate(PHOTO_QUEUE_LEN, sizeof(photo_cmd_t));
    configASSERT(s_photo_queue);

    uart_bridge_start();
    xTaskCreate(photo_task, "photo", 8192, NULL, 4, NULL);
    ESP_ERROR_CHECK(wifi_hw_init());

    char ssid[33] = {0};
    char pass[65] = {0};
    if (!load_wifi_config(ssid, sizeof(ssid), pass, sizeof(pass))) {
        ESP_LOGW(TAG, "no WiFi credentials; starting provisioning AP");
        start_provisioning();
        return;
    }

    ESP_LOGI(TAG, "connecting to WiFi SSID '%s'", ssid);
    state_set_error("wifi_connecting");
    esp_err_t err = wifi_start_sta(ssid, pass);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "WiFi connected, local IP=%s", s_state.local_ip);
        xTaskCreate(fetch_task, "fetch", 8192, NULL, 5, NULL);
    } else {
        ESP_LOGE(TAG, "WiFi connect failed; starting provisioning AP");
        start_provisioning();
    }
}
