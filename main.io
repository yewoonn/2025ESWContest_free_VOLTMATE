#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Adafruit_INA219.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <math.h>
#include "driver/ledc.h" // ESP-IDF LEDC
#include <SparkFun_MAX1704x_Fuel_Gauge_Arduino_Library.h> // ★ MAX17048

// ===== 핀 =====
#define MOTOR_MOSFET_PIN 23
#define CHARGE_MOSFET_PIN 5
#define SWITCH_PIN 4 // 모터 ON/OFF 토글 버튼
#define SPEED_BUTTON_PIN 16 // ★ 속도 단계 토글 버튼 (풀업 사용)

// ===== BLE UUID =====
#define SERVICE_UUID "12345678-1234-1234-1234-123456789abc"
#define BATTERY_CHAR_UUID "12345678-1234-1234-1234-123456789abd"
#define COMMAND_CHAR_UUID "12345678-1234-1234-1234-123456789abe"
#define DATA_CHAR_UUID "12345678-1234-1234-1234-123456789abf"

// ===== LCD / 센서 =====
LiquidCrystal_I2C lcd1(0x27, 16, 2); // 메인
LiquidCrystal_I2C lcd2(0x26, 16, 2); // 보조
Adafruit_INA219 ina219;
SFE_MAX1704X lipo; // MAX17048

// ===== BLE =====
BLECharacteristic* batteryChar;
BLECharacteristic* dataChar;

// ★ 추가: 서버/광고 포인터 + 전송/광고 타이머
BLEServer* gServer = nullptr;
BLEAdvertising* gAdv = nullptr;
unsigned long g_lastNotifyMs = 0;
const uint32_t NOTIFY_INTERVAL_MS = 500; // 0.5s마다 notify
unsigned long g_advWatchMs = 0;

// ===== 상태 =====
bool deviceConnected = false;
bool lastConnectionState = false;
bool motorMosfetOn = false;
bool INA_OK = false;
bool MAX_OK = false;
const float battery_capacity_mAh = 2000.0; // 정격 용량
float cycle_mAh_total = 0.0;
int cycle_count = 0;
const float DISCHARGE_THRESHOLD_mA = 10.0;
unsigned long lastLcdUpdate = 0;
const unsigned long LCD_UPDATE_INTERVAL = 500; // 0.5s

// ===== 버튼 토글: 인터럽트 + 디바운스 + 확인지연/릴리스대기 =====
volatile bool btnEdge = false; // 모터 토글 버튼 엣지(FALLING 감지)
volatile uint32_t lastEdgeMs = 0;
volatile bool spdBtnEdge = false; // 속도 단계 버튼 엣지
volatile uint32_t lastEdgeMsSpd = 0;
const uint32_t ISR_DEBOUNCE_MS = 40; // ISR 최소 간격
const uint32_t PRESS_QUALIFY_MS = 50; // 엣지 후 LOW 유지 확인 시간
const uint32_t SOFT_GUARD_MS = 300; // 연속 토글 보호 구간
bool motorToggle = false; // 사용자 의도 모터 토글(유지)
unsigned long lastUserToggleMs = 0; // 모터 토글 보호구간 타임스탬프
unsigned long lastSpeedStageMs = 0; // 속도 단계 토글 보호구간 타임스탬프
bool btnWaitHigh = false; // 모터 버튼 릴리스 대기
bool spdWaitHigh = false; // 속도 버튼 릴리스 대기

// ===== LEDC PWM 설정 =====
#define LEDC_MODE LEDC_LOW_SPEED_MODE
#define LEDC_TIMER LEDC_TIMER_0
#define LEDC_CHANNEL LEDC_CHANNEL_0
#define LEDC_DUTY_RES LEDC_TIMER_8_BIT
#define LEDC_DUTY_MAX ((1 << LEDC_DUTY_RES) - 1)
uint32_t g_pwmFreqHz = 4000;
bool g_pwmInvert = false;

// ===== 속도제어(거리/직접속도) =====
float userDistanceKm = 0.0f;   // 누적 주행거리 (km)
float maxDistanceKm = 0.05f;   // 목표 총 거리 (km)
bool speedOverride = false;    // true면 시리얼 수동 속도 사용
float overrideSpeed = 0.0f;    // 0.0~1.0

// ===== 표시용 주행 속도(km/h) 환산 =====
float VMAX_KMH = 25.0f;        // duty=1.0일 때 표시 최고 속도
float VSPEED_ALPHA = 1.0f;     // 속도곡률

// ★ 속도 단계 (1~5단계: base~100%를 등분)
uint8_t speedStage = 1; // 시작은 1단계
bool stageMode = false; // ★ 속도 버튼을 누르면 Stage 모드 ON

// ===== 기동 보조/최소속도 =====
float g_minFloor = 0.30f; // 자동모드 최소 스피드 바닥값(Stage 모드에서는 미적용)
uint32_t g_kickMs = 120; // 킥스타트(ms)
float g_lastCmdSp = 0.0f; // 직전 속도

// ===== 필터/내부저항 =====
float v_ema = 0.0f, i_ema = 0.0f;
bool ema_init = false;
const float v_alpha = 0.2f;
const float i_alpha = 0.2f;
float Rint_ohm = 0.08f; // 80 mΩ
float lastV = 0.0f, lastI = 0.0f;
unsigned long lastFGPrint = 0;

// ===== TTE(남은 시간) =====
float avgW = 0.0f;
bool avgInit = false;
const float wAlpha = 0.1f;

// ===== 과전류 제한(소프트 리밋) =====
const float OC_TRIP_mA = 3000.0f;
const float OC_RELEASE_mA = 2500.0f;
bool ocLimited = false;

#define PMOS_GATE_PIN 18
int g_forceSOC = -1;

// 램프다운 상태
bool rampActive = false;
unsigned long rampStartMs = 0;
float rampStartSpeed = 0.0f;

// SoC 15% 이하 지속 확인용
bool soc15Latch = false;
unsigned long soc15EnterMs = 0;
const unsigned long SOC15_HOLD_MS = 200;    // 200ms 지속 확인
const unsigned long RAMP_DURATION_MS = 2500; // 2.5s 램프다운 시간

bool soc15CutOffLatched = false;

// PMOS 게이트를 "오픈드레인"처럼 제어하기 위한 헬퍼
inline void pmos_on()  { pinMode(PMOS_GATE_PIN, OUTPUT); digitalWrite(PMOS_GATE_PIN, LOW); }  // ON
inline void pmos_off() { pinMode(PMOS_GATE_PIN, INPUT); }                                     // OFF(High-Z)

// --- 함수 원형 ---
int estimateBatteryPercent(float voltage);
float estimateBatteryHealth(int cycles);
void handleSerialCommands();
void setMotorSpeed01(float sp01);
void logOncePerSec(int soc, float v, float i_mA, float pW, const char* flow, float sp01);
int computeBatteryError(int soc, bool isCharging);

// ===== 누적거리 자동 계산 추가 =====
unsigned long g_lastDistMs = 0;  // 누적거리 적분용 타임스탬프
bool g_distAuto = true;          // 표시속도 기반 자동 적분 ON/OFF

// ===== 유틸 =====
int estimateBatteryPercent(float v) {
  float soc = (v - 3.30f) / (4.20f - 3.30f) * 100.0f;
  if (soc > 100.0f) soc = 100.0f;
  if (soc < 0.0f) soc = 0.0f;
  return (int)roundf(soc);
}

float estimateBatteryHealth(int cycles) {
  float h = 100.0f - (cycles * 0.05f);
  return (h < 0.0f) ? 0.0f : h;
}

// 배터리 경고 코드 계산 (0~5)
int computeBatteryError(int soc, bool isCharging) {
  if (soc <= 13) return 5;        // 즉시 OFF 권고
  if (soc <= 15) return 4;        // 램프다운 영역
  if (soc <= 20) return 3;        // 50% 고정 영역
  if (isCharging && soc >= 82) return 2; // 과충전 위험
  if (isCharging && soc >= 80) return 1; // 과충전(주의)
  return 0;
}

// ===== BLE 콜백 =====
class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override { deviceConnected = true; }
  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    delay(100);
    if (gAdv) gAdv->start();
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String cmd = String(pCharacteristic->getValue().c_str());
    cmd.trim();
    Serial.print("📥 명령 수신: "); Serial.println(cmd);

    // 앱에서 오는 DIST=<km>도 '목표거리 D'로 취급 (MAXD/D와 동일)
    if (cmd.startsWith("DIST=")) { // "DIST=5.00" 등
      float km = cmd.substring(5).toFloat();
      if (km > 0.0f) {
        maxDistanceKm = km;
        userDistanceKm = 0.0f;     // 누적거리 초기화
        g_lastDistMs = millis();   // 적분 기준 재설정
        Serial.printf("↳ (BLE) DIST set as TARGET: %.2f km, userDistance reset to 0\n", maxDistanceKm);
      } else {
        Serial.println("↳ (BLE) DIST usage: DIST=<km> (target distance)");
      }
    } else if (cmd.startsWith("MAXD=")) { // "MAXD=5.00"
      float km = cmd.substring(5).toFloat();
      if (km > 0.0f) {
        maxDistanceKm = km;
        userDistanceKm = 0.0f;     // 출발 전 초기화
        g_lastDistMs = millis();
        Serial.printf("↳ (BLE) MAXD set: %.2f km, userDistance reset to 0\n", maxDistanceKm);
      }
    } else if (cmd.startsWith("D=")) { // "D=5.00" (MAXD 별칭)
      float km = cmd.substring(2).toFloat();
      if (km > 0.0f) {
        maxDistanceKm = km;
        userDistanceKm = 0.0f;     // 출발 전 누적 0으로 리셋
        g_lastDistMs = millis();   // 적분 기준 재설정
        Serial.printf("↳ (BLE) D set: %.2f km, userDistance reset to 0\n", maxDistanceKm);
       }  
    } else if (cmd.equalsIgnoreCase("DRESET")) {
      userDistanceKm = 0.0f;
      g_lastDistMs = millis();
      Serial.println("↳ (BLE) 누적거리 초기화: D=0.0000 km");
    } else if (cmd.startsWith("DAUTO=")) { // "DAUTO=ON|OFF"
      String v = cmd.substring(6); v.trim(); v.toUpperCase();
      if (v == "ON")  { g_distAuto = true;  Serial.println("↳ (BLE) DAUTO=ON"); }
      if (v == "OFF") { g_distAuto = false; Serial.println("↳ (BLE) DAUTO=OFF"); }
    } else if (cmd == "GET_STATUS") {
      float v = INA_OK ? ina219.getBusVoltage_V() : 0.0;
      float i = INA_OK ? ina219.getCurrent_mA() : 0.0;
      float p = v * i / 1000.0;
      char buffer[64];
      snprintf(buffer, sizeof(buffer), "V:%.2fV I:%.1fmA P:%.2fW", v, i, p);
      dataChar->setValue((uint8_t*)buffer, strlen(buffer));
      if (deviceConnected) dataChar->notify();
    } else if (cmd == "GET_BATTERY") {
      float v = INA_OK ? ina219.getBusVoltage_V() : 0.0;
      int pct = estimateBatteryPercent(v);
      float hl = estimateBatteryHealth(cycle_count);
      char buffer[64];
      snprintf(buffer, sizeof(buffer), "P:%d%% C:%d L:%.0f%%", pct, cycle_count, hl);
      dataChar->setValue((uint8_t*)buffer, strlen(buffer));
      if (deviceConnected) dataChar->notify();
    } else if (cmd == "MOTOR_ON") {
      motorToggle = true;
    } else if (cmd == "MOTOR_OFF") {
      motorToggle = false;
    }
  }
};

// ===== I2C & INA219 =====
void safeInitINA219() {
  Wire.begin(21, 22);
  Wire.setClock(400000);
  Wire.setTimeOut(2000);
  Serial.println("[I2C] start, probing INA219...");
  for (int i = 1; i <= 3; i++) {
    if (ina219.begin()) {
      ina219.setCalibration_16V_400mA();
      INA_OK = true;
      Serial.println("[INA219] OK (16V_400mA)");
      return;
    }
    Serial.printf("[INA219] init fail (%d/3)\n", i);
    delay(200);
  }
  Serial.println("[INA219] not found, continue without sensor");
}

// ★ MAX17048 초기화
void safeInitMAX17048() {
  Serial.println("[I2C] probing MAX17048 (0x36)...");
  for (int i = 1; i <= 3; i++) {
    if (lipo.begin(Wire)) {
      MAX_OK = true;
      Serial.printf("[MAX17048] OK (try %d)\n", i);
      Serial.printf(" ↳ FG_SOC: %.2f%%, FG_Vcell: %.3fV\n", lipo.getSOC(), lipo.getVoltage());
      return;
    }
    Serial.printf("[MAX17048] init fail (%d/3)\n", i);
    delay(200);
  }
  Serial.println("[MAX17048] FAIL (not responding at 0x36)");
}

// ===== 버튼 ISR =====
void IRAM_ATTR onButtonFalling() {
  uint32_t now = millis();
  if (now - lastEdgeMs > ISR_DEBOUNCE_MS) {
    btnEdge = true;
    lastEdgeMs = now;
  }
}
void IRAM_ATTR onSpeedButtonFalling() {
  uint32_t now = millis();
  if (now - lastEdgeMsSpd > ISR_DEBOUNCE_MS) {
    spdBtnEdge = true;
  lastEdgeMsSpd = now;
  }
}

// ===== PWM 적용 함수 =====
void setMotorSpeed01(float sp01) {
  sp01 = constrain(sp01, 0.0f, 1.0f);
  if (g_lastCmdSp <= 0.0f && sp01 > 0.0f && g_kickMs > 0) {
    uint32_t dutyKick = LEDC_DUTY_MAX;
    if (g_pwmInvert) dutyKick = LEDC_DUTY_MAX - dutyKick;
    ledc_set_duty(LEDC_MODE, LEDC_CHANNEL, dutyKick);
    ledc_update_duty(LEDC_MODE, LEDC_CHANNEL);
    delay(g_kickMs);
  }
  uint32_t duty = (uint32_t)roundf(sp01 * LEDC_DUTY_MAX);
  if (g_pwmInvert) duty = LEDC_DUTY_MAX - duty;
  ledc_set_duty(LEDC_MODE, LEDC_CHANNEL, duty);
  ledc_update_duty(LEDC_MODE, LEDC_CHANNEL);
  motorMosfetOn = (sp01 > 0.0f);
  g_lastCmdSp = sp01;
}

// ===== 시리얼 커맨드 =====
void handleSerialCommands() {
  while (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    String up = line; up.toUpperCase();

    // 통합 파서: "키 값" 또는 "키=값" 모두 지원
    int eq = line.indexOf('=');
    int sp = line.indexOf(' ');
    int cut = (eq >= 0) ? eq : (sp >= 0 ? sp : -1);
    String key = (cut >= 0) ? line.substring(0, cut) : line;
    String val = (cut >= 0) ? line.substring(cut + 1) : String("");
    String keyU = key; keyU.toUpperCase(); val.trim();

    Serial.printf("[CMD] raw='%s' key='%s' val='%s'\n", line.c_str(), keyU.c_str(), val.c_str());

    if (keyU == "MAXD") {
      float km = val.toFloat();
      if (val.length() > 0 && km > 0.0f) {
        maxDistanceKm = km;
        userDistanceKm = 0.0f;      // ★ 출발 전 초기화
        g_lastDistMs = millis();    // 적분 기준 재설정
        Serial.printf("↳ MAXD: %.4f km (start reset)\n", maxDistanceKm);
        lastLcdUpdate = 0;
        Serial.printf("[CHK] user=%.4f km / max=%.4f km\n", userDistanceKm, maxDistanceKm);
      } else {
        Serial.println("↳ 사용법: MAXD <km>   예) MAXD 10.0");
      }
    }
    // DIST (누적 주행거리, km)
// DIST (목표거리, km)  ← 시리얼도 BLE와 동일하게 '목표거리'로 통일
    else if (keyU == "DIST") {
      float km = val.toFloat();
      if (val.length() > 0 && km > 0.0f) {
        maxDistanceKm = km;
        userDistanceKm = 0.0f;      // 누적 0으로 리셋
        g_lastDistMs = millis();    // 적분 기준 재설정
        Serial.printf("↳ DIST set (target): %.4f km (start reset)\n", maxDistanceKm);
        lastLcdUpdate = 0;
        Serial.printf("[CHK] D(target)=%.4f km, rem=%.4f km\n",
                      maxDistanceKm, max(0.0f, maxDistanceKm - userDistanceKm));
      } else {
        Serial.println("↳ 사용법: DIST <km>   예) DIST 5.00");
      }
    }

    // D (동일, km)
// D (목표거리, km)  ← MAXD와 동일 동작
    else if (keyU == "D") {
      float km = val.toFloat();
      if (val.length() > 0 && km > 0.0f) {
        maxDistanceKm = km;
        userDistanceKm = 0.0f;      // 출발 전 초기화
        g_lastDistMs = millis();    // 적분 기준 재설정
        Serial.printf("↳ D set (target): %.4f km (start reset)\n", maxDistanceKm);
        lastLcdUpdate = 0;
        Serial.printf("[CHK] D(target)=%.4f km, rem=%.4f km\n", maxDistanceKm, max(0.0f, maxDistanceKm - userDistanceKm));
      } else {
        Serial.println("↳ 사용법: D <km>      예) D 5.00");
      }
    }

    // DRESET: 누적거리 0으로 초기화
    else if (keyU == "DRESET") {
      userDistanceKm = 0.0f;
      g_lastDistMs = millis();
      Serial.println("↳ 누적거리 초기화: D=0.0000 km");
    }
    // DAUTO ON|OFF: 표시속도 기반 자동 적분 켜/끄기
    else if (keyU == "DAUTO") {
      String vu = val; vu.toUpperCase();
      if (vu == "ON")  { g_distAuto = true;  Serial.println("↳ DAUTO=ON (표시속도 기반 누적)"); }
      else if (vu == "OFF") { g_distAuto = false; Serial.println("↳ DAUTO=OFF"); }
      else Serial.println("↳ 사용법: DAUTO ON|OFF");
    }

    // 나머지 기존 명령들
    else if (up.startsWith("SPEED")) {
      int sp = line.indexOf(' ');
      if (sp > 0) {
        String arg = line.substring(sp + 1);
        String argU = arg; argU.toUpperCase();
        if (argU == "OFF") {
          speedOverride = false;
          Serial.println("↳ SPEED OVERRIDE 해제");
        } else {
          float s = arg.toFloat();
          if (s >= 0.0f && s <= 1.0f) {
            speedOverride = true;
            overrideSpeed = s;
            Serial.printf("↳ SPEED=%.2f\n", s);
          } else Serial.println("↳ 사용법: SPEED 0.0~1.0 / SPEED OFF");
        }
      } else Serial.println("↳ 사용법: SPEED <0.0~1.0> / SPEED OFF");
    } else if (up.startsWith("STATUS")) {
      Serial.printf("[STATUS] D=%.4fkm, MAXD=%.4fkm, MODE=%s%s, baseStage=%u, FREQ=%lu, INVERT=%s, MINFLOOR=%.2f, KICK=%lums, DAUTO=%s\n",
        userDistanceKm, maxDistanceKm,
        speedOverride ? "MANUAL" : "AUTO",
        stageMode ? " + STAGE" : "",
        (unsigned)speedStage,
        (unsigned long)g_pwmFreqHz,
        g_pwmInvert ? "ON" : "OFF",
        g_minFloor,
        (unsigned long)g_kickMs,
        g_distAuto ? "ON" : "OFF"
      );
    } else if (up.startsWith("FREQ")) {
      int sp = line.indexOf(' ');
      if (sp > 0) {
        uint32_t f = (uint32_t) line.substring(sp + 1).toInt();
        if (f >= 500 && f <= 40000) {
          g_pwmFreqHz = f;
          ledc_timer_config_t ledc_timer = {
            .speed_mode = LEDC_MODE,
            .duty_resolution = LEDC_DUTY_RES,
            .timer_num = LEDC_TIMER,
            .freq_hz = g_pwmFreqHz,
            .clk_cfg = LEDC_AUTO_CLK
          };
          ledc_timer_config(&ledc_timer);
          Serial.printf("↳ PWM FREQ=%lu Hz\n", (unsigned long)g_pwmFreqHz);
        } else Serial.println("↳ 사용 범위: 500~40000 Hz");
      } else Serial.println("↳ 사용법: FREQ 4000");
    } else if (up.startsWith("INVERT")) {
      int sp = line.indexOf(' ');
      if (sp > 0) {
        String a = line.substring(sp + 1);
        a.toUpperCase();
        if (a == "ON") { g_pwmInvert = true;  Serial.println("↳ INVERT=ON"); }
        else if (a == "OFF") { g_pwmInvert = false; Serial.println("↳ INVERT=OFF"); }
        else Serial.println("↳ 사용법: INVERT ON|OFF");
      } else Serial.println("↳ 사용법: INVERT ON|OFF");
    } else if (up.startsWith("MINFLOOR")) {
      int sp = line.indexOf(' ');
      if (sp > 0) {
        float r = line.substring(sp + 1).toFloat();
        if (r >= 0.0f && r <= 1.0f) {
          g_minFloor = r;
          Serial.printf("↳ MINFLOOR=%.2f\n", g_minFloor);
        } else Serial.println("↳ 사용법: MINFLOOR 0.0~1.0");
      } else Serial.println("↳ 사용법: MINFLOOR 0.30");
    } else if (up.startsWith("KICK")) {
      int sp = line.indexOf(' ');
      if (sp > 0) {
        int ms = line.substring(sp + 1).toInt();
        if (ms >= 0 && ms <= 1000) {
          g_kickMs = (uint32_t)ms;
          Serial.printf("↳ KICK=%lums\n", (unsigned long)g_kickMs);
        } else Serial.println("↳ 사용 범위: 0~1000 ms");
      } else Serial.println("↳ 사용법: KICK 120");
    } else if (keyU == "FORCESOC") {
      if (val.length() == 0) {
        Serial.printf("↳ FORCESOC 현재값: %d ( -1=실센서 )\n", g_forceSOC);
      } else {
        String vu = val; vu.toUpperCase();
        if (vu == "OFF") { g_forceSOC = -1; Serial.println("↳ FORCESOC 해제 (실제 센서값 사용)"); }
        else {
          int f = val.toInt();
          if (f >= 0 && f <= 100) { g_forceSOC = f; Serial.printf("↳ FORCESOC 설정: %d%%\n", g_forceSOC); }
          else Serial.println("↳ 사용법: FORCESOC 0~100 | FORCESOC OFF");
        }
      }
    }
    else {
      Serial.println(
        "↳ 명령: DIST <km> | D <km> | MAXD <km> | DRESET | DAUTO ON|OFF | "
        "SPEED <0.0~1.0> | SPEED OFF | STATUS | "
        "FREQ <500~40000> | INVERT ON|OFF | MINFLOOR <0.0~1.0> | "
        "KICK <0~1000> | FORCESOC 0~100 | FORCESOC OFF"
      );
    }
  }
}

// ===== 1초 단위 로그 =====
void logOncePerSec(int soc, float v, float i_mA, float pW, const char* flow, float sp01) {
  static unsigned long lastLog = 0;
  if (millis() - lastLog >= 1000) {
    lastLog = millis();
    Serial.printf("🔋 SOC:%d%% | V:%.2fV | I:%.1fmA | P:%.2fW | %s | 토글:%s | 스피드:%.2f | D:%.4fkm/MAXD:%.4fkm | FREQ:%luHz | INV:%s | MINFLOOR:%.2f | STAGE:%u%s | DAUTO:%s\n",
      soc, v, i_mA, pW, flow, motorToggle ? "ON" : "OFF", sp01,
      userDistanceKm, maxDistanceKm, (unsigned long)g_pwmFreqHz, g_pwmInvert ? "ON" : "OFF",
      g_minFloor, (unsigned)speedStage, stageMode ? " (ON)" : "", g_distAuto ? "ON" : "OFF");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("=== BOOT ===");

  pinMode(CHARGE_MOSFET_PIN, OUTPUT);
  digitalWrite(CHARGE_MOSFET_PIN, HIGH);

  pinMode(SWITCH_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(SWITCH_PIN), onButtonFalling, FALLING);

  pinMode(SPEED_BUTTON_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(SPEED_BUTTON_PIN), onSpeedButtonFalling, FALLING);

  // I2C / 센서 / LCD
  Wire.begin(21, 22);
  Wire.setClock(400000);
  Wire.setTimeOut(2000);
  safeInitINA219();
  safeInitMAX17048();

  // LCD 초기화
  lcd1.init(); lcd1.backlight(); lcd1.clear();
  lcd1.setCursor(0, 0); lcd1.print("System Boot...");
  lcd1.setCursor(0, 1); lcd1.print("BLE+INA219+MAX17048");

  lcd2.init(); lcd2.backlight(); lcd2.clear();
  lcd2.setCursor(0, 0); lcd2.print("LCD2 Online");
  lcd2.setCursor(0, 1); lcd2.print("SPD & D view");

  pinMode(PMOS_GATE_PIN, INPUT); // 기본은 OFF(High-Z)
  pmos_on(); // 주행 허용

  // LEDC
  ledc_timer_config_t ledc_timer = {
    .speed_mode = LEDC_MODE,
    .duty_resolution = LEDC_DUTY_RES,
    .timer_num = LEDC_TIMER,
    .freq_hz = g_pwmFreqHz,
    .clk_cfg = LEDC_AUTO_CLK
  };
  ledc_timer_config(&ledc_timer);

  ledc_channel_config_t ledc_channel = {
    .gpio_num = MOTOR_MOSFET_PIN,
    .speed_mode = LEDC_MODE,
    .channel = LEDC_CHANNEL,
    .intr_type = LEDC_INTR_DISABLE,
    .timer_sel = LEDC_TIMER,
    .duty = 0,
    .hpoint = 0
  };
  ledc_channel_config(&ledc_channel);

  motorMosfetOn = false;
  g_lastCmdSp = 0.0f;

  // BLE
  BLEDevice::init("ESP32_BLE");
  BLEDevice::setMTU(185);
  gServer = BLEDevice::createServer();
  gServer->setCallbacks(new MyServerCallbacks());

  BLEService* pService = gServer->createService(SERVICE_UUID);

  batteryChar = pService->createCharacteristic(BATTERY_CHAR_UUID, BLECharacteristic::PROPERTY_READ);
  batteryChar->addDescriptor(new BLE2902());

  BLECharacteristic* commandChar = pService->createCharacteristic(COMMAND_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE);
  commandChar->setCallbacks(new CommandCallbacks());
  commandChar->addDescriptor(new BLE2902());

  dataChar = pService->createCharacteristic(DATA_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  dataChar->addDescriptor(new BLE2902());

  pService->start();

  gAdv = BLEDevice::getAdvertising();
  gAdv->addServiceUUID(SERVICE_UUID);
  gAdv->setScanResponse(true);
  gAdv->setMinInterval(0x00A0);
  gAdv->setMaxInterval(0x00F0);
  gAdv->start();

  g_lastDistMs = millis(); // ★ 누적거리 적분 시작점

  Serial.println("✅ 시스템 시작 (BLE advertising started)");
}

void loop() {
  static float voltage = 0.0f, current_mA = 0.0f, power = 0.0f;

  handleSerialCommands();

  // === 모터 버튼 토글 처리 ===
  if (btnEdge) { noInterrupts(); btnEdge = false; interrupts(); }
  unsigned long now = millis();
  if (!btnWaitHigh) {
    if ((now - lastEdgeMs) >= PRESS_QUALIFY_MS && (now - lastUserToggleMs) >= SOFT_GUARD_MS && digitalRead(SWITCH_PIN) == LOW) {
      motorToggle = !motorToggle;
      lastUserToggleMs = now;
      btnWaitHigh = true;
      Serial.printf("🔘 Motor toggle → %s\n", motorToggle ? "ON" : "OFF");
    }
  } else {
    if (digitalRead(SWITCH_PIN) == HIGH) btnWaitHigh = false;
  }

  // === 속도 단계 버튼 ===
  if (spdBtnEdge) { noInterrupts(); spdBtnEdge = false; interrupts(); }
  if (!spdWaitHigh) {
    if ((now - lastEdgeMsSpd) >= PRESS_QUALIFY_MS && (now - lastSpeedStageMs) >= SOFT_GUARD_MS && digitalRead(SPEED_BUTTON_PIN) == LOW) {
      stageMode = true;
      speedStage = (speedStage % 5) + 1;
      lastSpeedStageMs = now;
      spdWaitHigh = true;
      Serial.printf("🚀 Stage mode ON, Stage → %u\n", (unsigned)speedStage);
    }
  } else {
    if (digitalRead(SPEED_BUTTON_PIN) == HIGH) spdWaitHigh = false;
  }

  // ===== 측정 (INA219) + 필터 =====
  if (INA_OK) {
    float v_raw = ina219.getBusVoltage_V();
    float i_raw = ina219.getCurrent_mA();

    if (!ema_init) { v_ema = v_raw; i_ema = i_raw; ema_init = true; }
    else { v_ema += v_alpha * (v_raw - v_ema); i_ema += i_alpha * (i_raw - i_ema); }

    if (fabs(i_ema - lastI) > 50.0f && fabs(v_ema - lastV) > 0.01f) {
      float dV = v_ema - lastV;
      float dI = (i_ema - lastI) / 1000.0f; // A
      float Rnew = fabs(dV / dI); // Ω
      if (Rnew > 0.03f && Rnew < 0.20f) Rint_ohm = 0.9f*Rint_ohm + 0.1f*Rnew;
    }
    lastV = v_ema; lastI = i_ema;
    voltage = v_ema;
    current_mA= i_ema;
    power = voltage * current_mA / 1000.0f;
  }

  // ===== SOC 계산: MAX17048 + OCV 보정 융합 =====
  float OCV = voltage - (current_mA/1000.0f)*Rint_ohm; // V
  int socFromV = estimateBatteryPercent(OCV);

  float fgSOC = -1.0f, fgV = 0.0f;
  bool fgValid = false;
  if (MAX_OK) {
    fgSOC = lipo.getSOC();
    fgV = lipo.getVoltage();
    fgValid = (fgSOC >= 0.0f && fgSOC <= 100.0f && fgV > 2.5f);
    if (fgValid && (fgSOC <= 5.0f) && (fgV >= 3.9f)) fgValid = false;
  }

  static float socFromV_rest = -1.0f;
  static unsigned long restStartMs = 0;
  bool nearRest = fabs(current_mA) < 80.0f;
  if (nearRest) {
    if (millis() - restStartMs > 1200) socFromV_rest = (float) socFromV;
  } else {
    restStartMs = millis();
  }

  float wV  = (nearRest ? 0.10f : 0.00f);
  float wFG = 1.0f - wV;
  float socUsedF_f;
  if (fgValid) {
    float vPart = (socFromV_rest >= 0.0f) ? socFromV_rest : (float)socFromV;
    socUsedF_f = wFG * fgSOC + wV * vPart;
  } else {
    socUsedF_f = (float)socFromV;
  }

  static float socDisp = -1.0f;
  if (socDisp < 0.0f) socDisp = socUsedF_f;
  else                socDisp = 0.9f * socDisp + 0.1f * socUsedF_f;

  float socUsedF = constrain(socDisp, 0.0f, 100.0f);
  int soc = (int)roundf(socUsedF);

  // 테스트 훅
  int soc_eff = (g_forceSOC >= 0 && g_forceSOC <= 100) ? g_forceSOC : soc;

  float health = estimateBatteryHealth(cycle_count);

  // ===== 사이클 누적 =====
  cycle_mAh_total += fabs(current_mA) * (1.0f / 3600.0f);
  if (cycle_mAh_total >= battery_capacity_mAh) {
    cycle_count++;
    cycle_mAh_total -= battery_capacity_mAh;
    Serial.println("🔁 사이클 +1");
  }

  // ===== TTE 누적식 계산 =====
  static bool energyInit = false;
  static float remWh = 0.0f; // 남은 에너지 (Wh)
  static unsigned long lastEnergyMs = millis();
  float battWh_nom = 3.7f * (battery_capacity_mAh / 1000.0f);

  if (!energyInit) { remWh = battWh_nom * (socUsedF / 100.0f); energyInit = true; }
  else {
    float estWhFromSOC = battWh_nom * (socUsedF / 100.0f);
    remWh = 0.95f * remWh + 0.05f * estWhFromSOC;
  }

  unsigned long nowMs_energy = millis();
  float dt_h = (nowMs_energy - lastEnergyMs) / 3600000.0f;
  lastEnergyMs = nowMs_energy;

  float loadW = max(power, 0.0f);
  remWh -= loadW * dt_h;
  if (remWh < 0.0f) remWh = 0.0f;
  if (remWh > battWh_nom) remWh = battWh_nom;

  if (!avgInit) { avgW = loadW; avgInit = true; }
  else { avgW += wAlpha * (loadW - avgW); }

  float refW = (avgW > 0.05f) ? avgW : 0.5f;
  float tte_h = (refW > 0.01f) ? (remWh / refW) : 9999.0f;
  float tte_min = min(tte_h * 60.0f, 9999.0f);

  // ===== 상태 판별 =====
  bool isCharging = current_mA > DISCHARGE_THRESHOLD_mA;
  bool isDischarging = current_mA < -DISCHARGE_THRESHOLD_mA;
  const char* flowStatus = isCharging ? "🔌충전 중" : (isDischarging ? "⚡방전 중" : "유지 상태");
  int batteryErrorRaw = computeBatteryError(soc_eff, isCharging);

// ===== SOC 기반 거버너 (주행거리 영향 X) =====
float dist_rem_km = (maxDistanceKm > userDistanceKm) ? (maxDistanceKm - userDistanceKm) : 0.0f;
float batt_rem = socUsedF / 100.0f;   // 0~1
const float per_km = 0.094f;          // 1km당 예측 소모량(=9.4%)
const float reserve = 0.20f;          // 20% 예비
float ene_need = dist_rem_km * per_km;

float governorScale = 1.0f;
if (ene_need > 0.0f) {
  float usable = max(batt_rem - reserve, 0.0f);
  if (usable < ene_need) {
    // SOC가 부족할 때만 감속 (충분하면 1.0 = 100%)
    governorScale = constrain(usable / ene_need, 0.0f, 1.0f);
  }
}

// 거리 기반 비율 제거 → SOC만 반영
float governedMax01 = constrain(governorScale, 0.0f, 1.0f);

// ===== Stage 모드 속도 =====
float stagedSpeed01 = governedMax01;
if (stageMode) {
  float stageGain = (float)speedStage / 5.0f;   // 1→0.2, 2→0.4, ..., 5→1.0
  stagedSpeed01 = governedMax01 * stageGain;
  stagedSpeed01 = max(stagedSpeed01, 0.55f);    // Stage 최소 55%
  stagedSpeed01 = constrain(stagedSpeed01, 0.0f, 1.0f);
}

// ===== 최종 선택 =====
float autoSpeed01 = governedMax01;
float chosen01 = 0.0f;
if (speedOverride)      chosen01 = constrain(overrideSpeed, 0.0f, 1.0f);
else if (stageMode)     chosen01 = stagedSpeed01;
else                    chosen01 = max(autoSpeed01, g_minFloor);



  // ===== PMOS 기반 저SOC 보호 =====
  float socF = soc_eff;
  const float SPIN_FLOOR = 0.50f;

  if (socF <= 20.0f && socF > 15.0f) {
    rampActive = false;
    chosen01   = SPIN_FLOOR;
    pmos_on();
  }
  if (socF <= 15.0f) {
    if (!soc15Latch) { soc15Latch = true; soc15EnterMs = millis(); }
  } else {
    soc15Latch = false;
    soc15CutOffLatched = false;   // ★ SoC가 15% 넘으면 래치 해제
  }
  if (!rampActive && soc15Latch && (millis() - soc15EnterMs >= SOC15_HOLD_MS)&& !soc15CutOffLatched) {
    rampActive = true;
    rampStartMs = millis();
    rampStartSpeed = SPIN_FLOOR;
    Serial.println("🟡 SoC<=15% 유지: 2.5s에 걸쳐 50%→0% 램프다운 시작");
  }
  if (rampActive) {
  unsigned long el = millis() - rampStartMs;
  if (el >= RAMP_DURATION_MS) {
    chosen01 = 0.0f;
    rampActive = false;
    soc15CutOffLatched = true;     // ★ 램프 완료 → 재시작 금지 래치 ON
    pmos_off();
    motorToggle = false;
    Serial.println("🔴 램프다운 완료: PMOS OFF & 모터 정지");
  } else {
    float remain = 1.0f - (float)el / (float)RAMP_DURATION_MS;
    remain = constrain(remain, 0.0f, 1.0f);
    float target = rampStartSpeed * remain;
    chosen01 = min(chosen01, target);
  }
} else {
  // ★ 램프가 끝났고 아직 SoC<=15%라면 0% 유지 & PMOS 계속 OFF
  if (socF <= 15.0f && soc15CutOffLatched) {
    chosen01 = 0.0f;
    pmos_off();
  } else {
    pmos_on();
  }
}


  // ===== 과전류 소프트 제한 =====
  float absI = fabs(current_mA);
  if (!ocLimited && absI >= OC_TRIP_mA) {
    ocLimited = true;
    Serial.printf("⚠️ 과전류 제한 진입 | I=%.0fmA (trip:%.0fmA)\n", current_mA, OC_TRIP_mA);
  } else if (ocLimited && absI <= OC_RELEASE_mA) {
    ocLimited = false;
    Serial.printf("ℹ️ 과전류 제한 해제 | I=%.0fmA (release:%.0fmA)\n", current_mA, OC_RELEASE_mA);
  }
  if (ocLimited) {
    chosen01 = min(chosen01, 0.40f);
    if (absI > (OC_TRIP_mA + 300.0f)) chosen01 = min(chosen01, 0.30f);
  }

  // ===== 모터 허용 조건 =====
  if (isCharging) { motorToggle = false; }
  bool allowMotor = (soc_eff > 5) && (voltage > 3.0f) && !isCharging;
  bool allowCharge = (soc_eff < 80);
  digitalWrite(CHARGE_MOSFET_PIN, allowCharge ? HIGH : LOW);

  float targetSpeed = (allowMotor && motorToggle) ? chosen01 : 0.0f;
  setMotorSpeed01(targetSpeed);

  // === 경고코드 노출 제어 ===
  bool motorActive = (allowMotor && motorToggle && targetSpeed > 0.0f);
  int batteryErrorApp = batteryErrorRaw;
  const bool HIDE_CODE4_WHEN_MOTOR_OFF = true;
  if (!motorActive) {
    if (batteryErrorApp == 5) batteryErrorApp = 0;
    if (HIDE_CODE4_WHEN_MOTOR_OFF && batteryErrorApp == 4) batteryErrorApp = 0;
  }

  // === 표시용 주행 속도 계산 (km/h) ===
  float duty01 = targetSpeed;                 // 0.0 ~ 1.0
  float shown_kmh = VMAX_KMH * powf(duty01, VSPEED_ALPHA);

  // ===== ★ 표시속도 기반 누적거리 자동 계산 =====
  if (g_distAuto) {
    unsigned long nowDist = millis();
    unsigned long dms = nowDist - g_lastDistMs;
    g_lastDistMs = nowDist;
    if (dms > 500) dms = 500;               // 비정상 큰 간격 클램프
    float dt_h_dist = dms / 3600000.0f;     // h 단위
    if (motorActive && shown_kmh > 0.1f) {
      userDistanceKm += (shown_kmh * dt_h_dist); // km = (km/h) * h
      if (userDistanceKm < 0.0f) userDistanceKm = 0.0f;
    }
  }

  logOncePerSec(soc_eff, voltage, current_mA, power, flowStatus, targetSpeed);

// ===== LCD 업데이트 =====
if (millis() - lastLcdUpdate >= LCD_UPDATE_INTERVAL) {
  lastLcdUpdate = millis();

  // 0x27: SOC / 전압 / 전류
  lcd1.clear();
  lcd1.setCursor(0, 0);
  lcd1.printf("SOC:%d%% V:%.2f", soc_eff, voltage);
  lcd1.setCursor(0, 1);
  lcd1.printf("I:%4.0fmA", current_mA);

  // ---- LCD2: D(남은거리) & C(제어 퍼센트), 그리고 SPD & S(stage) ----
  // 남은거리 = 목표거리(maxDistanceKm) - 누적거리(userDistanceKm)
  float remKm = max(maxDistanceKm - userDistanceKm, 0.0f);

  // 제어 퍼센트 = 최종 듀티 chosen01(0.0~1.0) × 100
  int ctlPct = (int)roundf(chosen01 * 100.0f);
  ctlPct = constrain(ctlPct, 0, 100);

  lcd2.clear();
  delay(2); // 일부 I2C 백팩에서 clear 직후 안정화 필요

  // 1행: 표시 속도(km/h)와 Stage
  lcd2.setCursor(0, 0);
  lcd2.printf("SPD:%4.1f S:", shown_kmh);
  if (stageMode) lcd2.print((unsigned)speedStage);
  else           lcd2.print('-');

  // 2행: D = 남은거리(km),  C = 제어 퍼센트(0~100%)
  lcd2.setCursor(0, 1);
  lcd2.printf("D:%5.2f C:%3d%%", remKm, ctlPct);
}



  // ===== 시리얼: MAX17048 상태 주기 출력 =====
  if (millis() - lastFGPrint >= 5000) {
    if (MAX_OK) {
      Serial.printf("MAX17048 OK | FG_SOC: %.2f%% | FG_Vcell: %.3fV | Rint: %.0f mΩ | OCV: %.3fV | SOC(fused): %d%% | TTE: %.0f min\n",
        lipo.getSOC(), lipo.getVoltage(), Rint_ohm*1000.0f, OCV, soc, tte_min);
    } else {
      Serial.println("MAX17048 FAIL | 0x36 응답 없음 → OCV 기반 SOC만 사용 중");
    }
    lastFGPrint = millis();
  }

  // ===== BLE 전송 부분 =====
  if (deviceConnected) {
    unsigned long nowMs = millis();
    if (nowMs - g_lastNotifyMs >= NOTIFY_INTERVAL_MS) {
      g_lastNotifyMs = nowMs;

      unsigned long uptime_sec = millis() / 1000UL;
      unsigned long hr = uptime_sec / 3600UL;
      unsigned long min = (uptime_sec % 3600UL) / 60UL;

      int batteryStatus = isCharging ? 2 : (isDischarging ? 0 : 1);

      int monthsLeft = (int)(health * 0.36f);
      if (monthsLeft < 3) monthsLeft = 3;
      char rdStr[8]; snprintf(rdStr, sizeof(rdStr), "%d", monthsLeft);

      char ctrStr[16];
      if (isCharging && tte_min < 9999.0f) snprintf(ctrStr, sizeof(ctrStr), "%.0fm", tte_min);
      else snprintf(ctrStr, sizeof(ctrStr), "-");

      char speedStr[16]; snprintf(speedStr, sizeof(speedStr), "%.1fW", power);
      char utStr[16];    snprintf(utStr, sizeof(utStr), "%luh%lum", hr, min);

      const int total_packets = 5;

      char p1[32];
      snprintf(p1, sizeof(p1), "p1t%d%s%d%s%d", total_packets, "bl", soc_eff, "bs", batteryStatus);
      dataChar->setValue((uint8_t*)p1, strlen(p1)); dataChar->notify(); delay(30);

      char p2[32];
      snprintf(p2, sizeof(p2), "p2t%d%s%d%s%d", total_packets, "cc", cycle_count, "bh", (int)roundf(health));
      dataChar->setValue((uint8_t*)p2, strlen(p2)); dataChar->notify(); delay(30);

      char p3[32];
      snprintf(p3, sizeof(p3), "p3t%d%s%s%s%s", total_packets, "cs", speedStr, "ctr", ctrStr);
      dataChar->setValue((uint8_t*)p3, strlen(p3)); dataChar->notify(); delay(30);

      char p4[32];
      snprintf(p4, sizeof(p4), "p4t%d%s%lu%lu%s%s", total_packets, "ut", hr, min, "rd", rdStr);
      dataChar->setValue((uint8_t*)p4, strlen(p4)); dataChar->notify(); delay(30);

      char p5[24];
      snprintf(p5, sizeof(p5), "p5t%d%s%d", total_packets, "be", batteryErrorApp);
      dataChar->setValue((uint8_t*)p5, strlen(p5)); dataChar->notify();
    }
  }

  // READ 특성(배터리 %)
  {
    char socbuf[8];
    snprintf(socbuf, sizeof(socbuf), "%d", soc_eff);
    batteryChar->setValue((uint8_t*)socbuf, strlen(socbuf));
  }

  if (deviceConnected != lastConnectionState) {
    Serial.println(deviceConnected ? "✅ BLE 연결됨" : "🔌 BLE 연결 끊김");
    lastConnectionState = deviceConnected;
  }

  // ★ Advertising 워치독
  if (!deviceConnected) {
    unsigned long nowMs = millis();
    if (nowMs - g_advWatchMs > 3000) {
      g_advWatchMs = nowMs;
      if (gAdv) gAdv->start();
    }
  }

  delay(10);
}

