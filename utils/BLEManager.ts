import { BleManager, Device, Service, Characteristic, Subscription } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform, Alert, Vibration } from 'react-native';
import { encode as btoa, decode as atob } from 'base-64';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';

// ESP32 BLE Service and Characteristic UUIDs
const ESP32_SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const BATTERY_CHARACTERISTIC_UUID = '12345678-1234-1234-1234-123456789abd';
const COMMAND_CHARACTERISTIC_UUID = '12345678-1234-1234-1234-123456789abe';
const DATA_CHARACTERISTIC_UUID = '12345678-1234-1234-1234-123456789abf';

export interface BLEStatus {
  batteryStatus: number;
  isScanning: boolean;
  isConnected: boolean;
  deviceName?: string;
  deviceId?: string;
  batteryLevel?: number;
  lastError?: string;
  temperature?: number | string;
  chargingCycles?: number | string;
  chargingSpeed?: string;
  batteryHealth?: string;
  usageTime?: string;
  replacementDate?: string;
  isCharging?: boolean;
  chargingTimeRemaining?: string;
  batteryError?: number;
}

export interface BLELogEntry {
  timestamp: Date;
  type: 'info' | 'error' | 'success';
  message: string;
}

class BLEManagerClass {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private statusCallback?: (status: BLEStatus) => void;
  private logCallback?: (log: BLELogEntry) => void;
  private deviceFoundCallback?: (deviceId: string) => void;
  private dataSubscription: Subscription | null = null;
  private packetBuffer: { [key: number]: any } = {}; // 분할 패킷 버퍼
  private expectedTotalPackets: number = 0; // 예상되는 총 패킷 수
  private lastShownAlert: number | null = null; // 마지막으로 표시된 알림 상태
  private criticalAlertShown: boolean = false; // 위험 상태 알림 표시 여부
  private vibrationInterval: NodeJS.Timeout | null = null; // 연속 진동 인터벌
  private audioInterval: NodeJS.Timeout | null = null; // 연속 사운드 인터벌

  private currentStatus: BLEStatus = {
    batteryStatus: 1,
    isScanning: false,
    isConnected: false,
  };

  constructor() {
    this.manager = new BleManager();
    this.initializeBLE();
    this.initializeAudio();
  }

  private async initializeAudio() {
    try {
      // Android에서 오디오 재생을 위한 설정
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      this.addLog('info', '오디오 모드 초기화 완료');
    } catch (error) {
      this.addLog('error', `오디오 모드 초기화 실패: ${error}`);
    }
  }

  private async initializeBLE() {
    const subscription = this.manager.onStateChange((state) => {
      this.addLog('info', `BLE State: ${state}`);
      if (state === 'PoweredOn') {
        this.addLog('success', 'BLE 초기화 완료');
      }
    }, true);
  }

  private addLog(type: 'info' | 'error' | 'success', message: string) {
    const logEntry: BLELogEntry = {
      timestamp: new Date(),
      type,
      message,
    };
    console.log(`[BLE ${type.toUpperCase()}] ${message}`);
    this.logCallback?.(logEntry);
  }

  private updateStatus(updates: Partial<BLEStatus>) {
    this.currentStatus = { ...this.currentStatus, ...updates };
    this.statusCallback?.(this.currentStatus);

    // 배터리 에러 상태에 따른 알림 표시
    if (updates.batteryError !== undefined) {
      this.showBatteryErrorAlert(updates.batteryError);
    }
  }

  private showBatteryErrorAlert(batteryError: number) {
    // 정상 상태로 돌아온 경우 위험 상태 알림 해제
    if (batteryError === 0) {
      if (this.criticalAlertShown) {
        this.criticalAlertShown = false;
        // 연속 진동/사운드 중지
        this.stopContinuousVibration();
        this.stopContinuousSound();
        // 정상 복구 햅틱 피드백 및 사운드
        this.safeHapticFeedback('success');
        this.safeAudioAlert('success');
        // 정상 복구 알림 표시
        Alert.alert('배터리 정상 복구 완료', '배터리 상태가 정상으로 돌아왔습니다.', [{ text: '확인', style: 'default' }]);
        this.addLog('info', '배터리 상태가 정상으로 돌아왔습니다.');
      }
      this.lastShownAlert = null;
      return;
    }

    // 같은 알림이 이미 표시된 경우 중복 표시 방지
    if (this.lastShownAlert === batteryError) {
      return;
    }

    let title = '';
    let message = '';
    const isCritical = batteryError === 2 || batteryError === 5; // 과충전 위험, 과방전 위험

    switch (batteryError) {
      case 1:
        title = '과충전 경고';
        message = '하드웨어에 의해서 배터리 충전이 제한됩니다.';
        break;
      case 2:
        title = '과충전 위험';
        message = '배터리가 82% 이상입니다. 즉시 배터리 연결을 제거하세요.';
        break;
      case 3:
        title = '과방전 경고';
        message = '배터리가 15~20% 수준입니다. 하드웨어에 의해 속도가 50%로 제한됩니다.';
        break;
      case 4:
        title = '완전 과방전 경고';
        message = '배터리가 위험 수준입니다. 하드웨어에 의해 속도가 점진적으로 줄어들어 0이 됩니다.';
        break;
      case 5:
        title = '과방전 위험';
        message = '배터리가 13% 이하입니다. 즉시 모터를 OFF 해주세요.';
        break;
      default:
        this.addLog('error', `알 수 없는 배터리 에러 코드: ${batteryError}`);
        return;
    }

    // 햅틱 피드백 및 진동 처리
    if (isCritical) {
      // 위험 상태: 연속 진동 시작
      this.startContinuousVibration();
      Alert.alert(title, message, [], { cancelable: false });
      this.criticalAlertShown = true;
    } else {
      // 경고 상태: 1번 경고 진동 및 사운드
      this.safeHapticFeedback('warning');
      this.safeAudioAlert('warning');
      Alert.alert(title, message, [{ text: '확인', style: 'default' }]);
    }

    this.lastShownAlert = batteryError;
    this.addLog('error', `${title}: ${message}`);
  }

  private startContinuousVibration() {
    // 기존 진동/사운드가 있다면 중지
    this.stopContinuousVibration();
    this.stopContinuousSound();

    // 즉시 한 번 진동 및 사운드
    this.safeHapticFeedback('error');
    this.safeAudioAlert('error');

    // 2초마다 반복 진동
    this.vibrationInterval = setInterval(() => {
      this.safeHapticFeedback('error');
    }, 2000);

    // 2초마다 반복 사운드
    this.audioInterval = setInterval(() => {
      this.safeAudioAlert('error');
    }, 2000);

    this.addLog('info', '위험 상태 연속 진동/사운드 시작');
  }

  private stopContinuousVibration() {
    if (this.vibrationInterval) {
      clearInterval(this.vibrationInterval);
      this.vibrationInterval = null;
      this.addLog('info', '위험 상태 연속 진동 중지');
    }
  }

  private stopContinuousSound() {
    if (this.audioInterval) {
      clearInterval(this.audioInterval);
      this.audioInterval = null;
      this.addLog('info', '위험 상태 연속 사운드 중지');
    }
  }

  private async safeAudioAlert(type: 'success' | 'warning' | 'error') {
    // 웹 플랫폼에서는 Web Audio API 사용
    if (Platform.OS === 'web') {
      try {
        // Web Audio API로 간단한 비프음 생성
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // 주파수와 지속시간 설정
        const frequency = type === 'error' ? 800 : type === 'warning' ? 600 : 400;
        const duration = type === 'error' ? 0.3 : type === 'warning' ? 0.2 : 0.15;

        oscillator.frequency.value = frequency;
        oscillator.type = 'square';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);

        this.addLog('info', `웹 사운드 알림 재생: ${type} (${frequency}Hz)`);
      } catch (error) {
        this.addLog('error', `웹 사운드 알림 실패: ${error}`);
      }
      return;
    }

    // iOS/Android에서는 프로그래밍으로 사운드 생성
    try {
      this.addLog('info', `사운드 알림 시도: ${type}`);
      
      // Audio 상태 초기화
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        interruptionModeIOS: 1,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        interruptionModeAndroid: 1,
        playThroughEarpieceAndroid: false
      });

      // 간단한 비프음 생성을 위한 base64 인코딩된 짧은 WAV 파일
      const getBeepData = (frequency: number, duration: number) => {
        // 매우 간단한 사인파 WAV 데이터 (44.1kHz, 16bit, mono)
        const sampleRate = 8000; // 낮은 샘플레이트로 파일 크기 줄임
        const samples = Math.floor(sampleRate * duration / 1000);
        const buffer = new ArrayBuffer(44 + samples * 2);
        const view = new DataView(buffer);

        // WAV 헤더
        const writeString = (offset: number, string: string) => {
          for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, samples * 2, true);

        // 사인파 데이터 생성
        for (let i = 0; i < samples; i++) {
          const t = i / sampleRate;
          const amplitude = Math.sin(2 * Math.PI * frequency * t) * 0.3;
          const sample = Math.round(amplitude * 32767);
          view.setInt16(44 + i * 2, sample, true);
        }

        // Base64 인코딩
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      };

      const frequency = type === 'error' ? 800 : type === 'warning' ? 600 : 400;
      const duration = type === 'error' ? 300 : type === 'warning' ? 200 : 150;

      const sound = new Audio.Sound();
      const beepData = getBeepData(frequency, duration);
      const dataUri = `data:audio/wav;base64,${beepData}`;

      await sound.loadAsync({ uri: dataUri }, { shouldPlay: true, volume: 0.3 });
      this.addLog('info', `사운드 재생 성공: ${type} (${frequency}Hz)`);

      // 재생 완료 후 정리
      setTimeout(() => {
        sound.unloadAsync().catch(() => {});
      }, duration + 100);

    } catch (error) {
      this.addLog('error', `사운드 생성 실패, 진동으로 대체: ${error}`);

      // 사운드 실패시 진동 패턴으로 폴백
      const pattern = type === 'error' ? [0, 100, 100, 100] :
                     type === 'warning' ? [0, 150, 50, 150] :
                     [0, 200];
      Vibration.vibrate(pattern);
      this.addLog('info', `폴백 진동 패턴 실행: ${type}`);
    }
  }

  private async safeHapticFeedback(type: 'success' | 'warning' | 'error') {
    // 웹 플랫폼에서는 햅틱 지원하지 않음
    if (Platform.OS === 'web') {
      this.addLog('info', '웹 플랫폼에서는 햅틱 피드백을 지원하지 않습니다');
      return;
    }

    try {
      this.addLog('info', `햅틱 피드백 시도: ${type}`);

      switch (type) {
        case 'success':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        case 'warning':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          break;
        case 'error':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          break;
      }

      this.addLog('info', `햅틱 피드백 성공: ${type}`);
    } catch (error) {
      this.addLog('error', `햅틱 피드백 실패: ${error}`);

      // 폴백: React Native Vibration API 사용
      try {
        if (Platform.OS === 'android' || Platform.OS === 'ios') {
          const duration = type === 'error' ? 20000 : type === 'warning' ? 10000 : 5000;
          Vibration.vibrate(duration);
          this.addLog('info', `폴백 진동 성공: ${duration}ms`);
        }
      } catch (vibrationError) {
        this.addLog('error', `폴백 진동도 실패: ${vibrationError}`);
      }
    }
  }

  setStatusCallback(callback: (status: BLEStatus) => void) {
    this.statusCallback = callback;
    callback(this.currentStatus);
  }

  setLogCallback(callback: (log: BLELogEntry) => void) {
    this.logCallback = callback;
  }

  setDeviceFoundCallback(callback: (deviceId: string) => void) {
    this.deviceFoundCallback = callback;
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true;
    }

    try {
      const permissions: (keyof typeof PermissionsAndroid.PERMISSIONS)[] = [];

      if (Platform.Version >= 31) {
        permissions.push(
            'BLUETOOTH_SCAN' as keyof typeof PermissionsAndroid.PERMISSIONS,
            'BLUETOOTH_CONNECT' as keyof typeof PermissionsAndroid.PERMISSIONS
        );
      } else {
        permissions.push(
            'BLUETOOTH' as keyof typeof PermissionsAndroid.PERMISSIONS,
            'BLUETOOTH_ADMIN' as keyof typeof PermissionsAndroid.PERMISSIONS
        );
      }

      permissions.push('ACCESS_FINE_LOCATION' as keyof typeof PermissionsAndroid.PERMISSIONS);

      const permissionValues = permissions.map(p => PermissionsAndroid.PERMISSIONS[p]);
      const granted = await PermissionsAndroid.requestMultiple(permissionValues);

      const allGranted = Object.values(granted).every(
          result => result === PermissionsAndroid.RESULTS.GRANTED
      );

      if (allGranted) {
        this.addLog('success', '모든 권한이 승인되었습니다');
        return true;
      } else {
        this.addLog('error', '일부 권한이 거부되었습니다');
        this.updateStatus({ lastError: '권한이 필요합니다' });
        return false;
      }
    } catch (error) {
      this.addLog('error', `권한 요청 실패: ${error}`);
      this.updateStatus({ lastError: '권한 요청 실패' });
      return false;
    }
  }

  async startScan(): Promise<void> {
    try {
      const hasPermissions = await this.requestPermissions();
      if (!hasPermissions) {
        return;
      }

      this.addLog('info', 'ESP32 장치 검색 시작...');
      this.updateStatus({ isScanning: true, lastError: undefined });

      // Stop any existing scan
      this.manager.stopDeviceScan();

      this.manager.startDeviceScan(null, null, (error, device) => {
        this.addLog('info', '📡 스캔 콜백 도착');
        if (error) {
          this.addLog('error', `스캔 에러: ${error.message}`);
          this.updateStatus({
            isScanning: false,
            lastError: error.message
          });
          return;
        }

        if (device) {
          const info = `🔍 발견된 기기 → Name: ${device.name || 'N/A'}, ID: ${device.id}, LocalName: ${device.localName || 'N/A'}`;
          this.addLog('info', info);
        }

        // 기존 필터링 로직 (ESP32_BLE만 잡을 경우)
        if (device && device.name === 'ESP32_BLE') {
          this.addLog('success', `✅ ESP32 장치 발견: ${device.name} (${device.id})`);
          this.manager.stopDeviceScan();
          this.updateStatus({
            isScanning: false,
            deviceName: device.name,
            deviceId: device.id
          });

          // Trigger auto-connect callback if set
          if (this.deviceFoundCallback) {
            this.deviceFoundCallback(device.id);
          }
        }
      });

      // Stop scan after 10 seconds if no device found
      setTimeout(() => {
        if (this.currentStatus.isScanning) {
          this.manager.stopDeviceScan();
          this.addLog('info', '스캔 시간 초과 - ESP32 장치를 찾을 수 없습니다');
          this.updateStatus({
            isScanning: false,
            lastError: 'ESP32 장치를 찾을 수 없습니다'
          });
        }
      }, 10000);

    } catch (error) {
      this.addLog('error', `스캔 시작 실패: ${error}`);
      this.updateStatus({
        isScanning: false,
        lastError: '스캔 시작 실패'
      });
    }
  }

  async connectToDevice(deviceId?: string): Promise<void> {
    try {
      const targetDeviceId = deviceId || this.currentStatus.deviceId;
      if (!targetDeviceId) {
        this.addLog('error', '연결할 장치가 선택되지 않았습니다');
        return;
      }

      this.addLog('info', `장치 연결 시도: ${targetDeviceId}`);

      const device = await this.manager.connectToDevice(targetDeviceId);
      const deviceWithServices = await device.discoverAllServicesAndCharacteristics();

      this.connectedDevice = deviceWithServices;
      this.updateStatus({
        isConnected: true,
        deviceName: device.name || 'ESP32_BLE',
        deviceId: device.id,
        lastError: undefined
      });

      this.addLog('success', `장치 연결 성공: ${device.name}`);

      // Setup disconnect monitoring
      device.onDisconnected((error, device) => {
        this.addLog('info', `장치 연결 해제: ${device?.name}`);
        this.connectedDevice = null;
        this.updateStatus({
          isConnected: false,
          batteryLevel: undefined
        });
      });

      // Read initial battery level
      await this.readBatteryLevel();

      // Start monitoring data characteristic
      this.startDataMonitoring();

    } catch (error) {
      this.addLog('error', `연결 실패: ${error}`);
      this.updateStatus({
        isConnected: false,
        lastError: '연결 실패'
      });
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.stopDataMonitoring();
      this.stopContinuousVibration(); // 진동 중지
      this.stopContinuousSound(); // 사운드 중지
      if (this.connectedDevice) {
        await this.manager.cancelDeviceConnection(this.connectedDevice.id);
        this.connectedDevice = null;
        this.updateStatus({
          isConnected: false,
          batteryLevel: undefined
        });
        this.addLog('info', '장치 연결이 해제되었습니다');
      }
    } catch (error) {
      this.addLog('error', `연결 해제 실패: ${error}`);
    }
  }

  async readBatteryLevel(): Promise<number | null> {
    try {
      if (!this.connectedDevice) {
        this.addLog('error', '연결된 장치가 없습니다');
        return null;
      }

      this.addLog('info', '배터리 레벨 읽는 중...');

      const characteristic = await this.connectedDevice.readCharacteristicForService(
          ESP32_SERVICE_UUID,
          BATTERY_CHARACTERISTIC_UUID
      );
      const decoded = atob(characteristic.value || '');
      const batteryLevel = parseInt(decoded, 10);
      this.updateStatus({ batteryLevel });
      this.addLog('success', `배터리 레벨: ${batteryLevel}%`);
      return batteryLevel;
    } catch (error) {
      this.addLog('error', `배터리 레벨 읽기 실패: ${error}`);
      return null;
    }
  }

  async sendCommand(command: string): Promise<void> {
    try {
      if (!this.connectedDevice) {
        this.addLog('error', '연결된 장치가 없습니다');
        return;
      }

      this.addLog('info', `명령 전송: ${command}`);

      // Convert string to base64
      const base64Command = btoa(command);

      await this.connectedDevice.writeCharacteristicWithResponseForService(
          ESP32_SERVICE_UUID,
          COMMAND_CHARACTERISTIC_UUID,
          base64Command
      );

      this.addLog('success', `명령 전송 완료: ${command}`);
    } catch (error) {
      this.addLog('error', `명령 전송 실패: ${error}`);
    }
  }

  async sendDistance(distanceKm: number): Promise<void> {
    try {
      if (!this.connectedDevice) {
        this.addLog('error', '연결된 장치가 없습니다');
        return;
      }

      // 거리를 소수점 2자리까지 포함하여 전송 (예: DIST=12.54)
      const distanceCommand = `DIST=${distanceKm.toFixed(2)}`;
      this.addLog('info', `거리 전송: ${distanceCommand}`);

      // Convert to base64
      const base64Command = btoa(distanceCommand);

      await this.connectedDevice.writeCharacteristicWithResponseForService(
          ESP32_SERVICE_UUID,
          COMMAND_CHARACTERISTIC_UUID,
          base64Command
      );

      this.addLog('success', `거리 전송 완료: ${distanceKm.toFixed(1)}km`);
    } catch (error) {
      this.addLog('error', `거리 전송 실패: ${error}`);
    }
  }

  startDataMonitoring(): void {
    if (!this.connectedDevice) {
      this.addLog('error', '연결된 장치가 없습니다');
      return;
    }

    this.addLog('info', 'BLE 데이터 모니터링 시작...');

    this.stopDataMonitoring(); // 기존 구독 해제

    // ★ packetBuffer 및 expectedTotalPackets 초기화
    this.packetBuffer = {};
    this.expectedTotalPackets = 0;

    this.dataSubscription = this.connectedDevice.monitorCharacteristicForService(
        ESP32_SERVICE_UUID,
        DATA_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            this.addLog('error', `데이터 모니터링 에러: ${error.message}`);
            return;
          }

          if (characteristic?.value) {
            try {
              const dataString = atob(characteristic.value); // Base64 디코딩
              this.addLog('info', `📨 수신된 문자열 패킷: "${dataString}"`);

              // ★ 문자열 파싱 함수 호출
              const parsedPacket = this.parsePacketString(dataString);

              if (parsedPacket) {
                const { p: packetNumber, t: totalPackets, data: packetData } = parsedPacket;

                if (totalPackets && totalPackets > 0) {
                  this.expectedTotalPackets = totalPackets;
                }

                if (packetNumber >= 1 && packetNumber <= this.expectedTotalPackets) {
                  this.packetBuffer[packetNumber] = packetData;
                  this.addLog('info', `패킷 ${packetNumber}/${this.expectedTotalPackets} 수신 완료`);

                  // 모든 패킷이 도착했는지 확인
                  const allPacketsReceived = Object.keys(this.packetBuffer).length === this.expectedTotalPackets;

                  if (allPacketsReceived) {
                    // 모든 패킷의 데이터 조합
                    const completeData: Partial<BLEStatus> = {
                      batteryLevel: this.packetBuffer[1]?.bl,
                      batteryStatus: this.packetBuffer[1]?.bs,
                      chargingCycles: this.packetBuffer[2]?.cc,
                      batteryHealth: this.packetBuffer[2]?.bh ? `${this.packetBuffer[2].bh}%` : '-', // 아두이노에서 숫자만 보냄
                      chargingSpeed: this.packetBuffer[3]?.cs || '-',
                      chargingTimeRemaining: this.packetBuffer[3]?.ctr || '-',
                      usageTime: this.packetBuffer[4]?.ut || '-',
                      replacementDate: this.packetBuffer[4]?.rd || '-',
                      batteryError: this.packetBuffer[5]?.be,
                    };

                    this.addLog('success', '✅ 모든 패킷 수신 완료, 데이터 업데이트');
                    this.updateStatus(completeData);

                    // 패킷 버퍼 초기화
                    this.packetBuffer = {};
                    this.expectedTotalPackets = 0;
                  }
                } else {
                  this.addLog('error', `잘못된 패킷 번호 또는 예상치 못한 패킷: ${packetNumber} (총 패킷: ${this.expectedTotalPackets})`);
                }
              } else {
                this.addLog('error', `문자열 파싱 실패: "${dataString}"`);
              }
            } catch (decodeError) {
              this.addLog('error', `Base64 디코딩 실패: ${decodeError.message}, 원시 데이터: ${characteristic.value}`);
            }
          }
        }
    );
  }

  stopDataMonitoring(): void {
    if (this.dataSubscription) {
      this.dataSubscription.remove();
      this.dataSubscription = null;
      this.addLog('info', 'BLE 데이터 모니터링 중단');
    }
  }

  // ★ 문자열 파싱 헬퍼 함수
  private parsePacketString(packetString: string): { p: number, t: number, data: any } | null {
    // 예시 포맷: "p1t4bl85bs1"
    // p<packet_num>t<total_packets><key1><value1><key2><value2>...

    const packetRegex = /^p(\d+)t(\d+)(.*)$/;
    const match = packetString.match(packetRegex);

    if (!match) {
      this.addLog('error', `문자열 포맷 불일치: "${packetString}"`);
      return null;
    }

    const packetNumber = parseInt(match[1], 10);
    const totalPackets = parseInt(match[2], 10);
    let payload = match[3]; // "bl85bs1"

    let data: any = {};

    switch (packetNumber) {
      case 1: // p1t5bl<배터리레벨>bs<배터리상태>
        const p1Match = payload.match(/^bl(\d+)bs(\d+)$/);
        if (p1Match) {
          data.bl = parseInt(p1Match[1], 10);
          data.bs = parseInt(p1Match[2], 10);
        }
        break;
      case 2: // p2t5cc<충전사이클>bh<배터리건강도>
        const p2Match = payload.match(/^cc(\d+)bh(\d+)$/);
        if (p2Match) {
          data.cc = parseInt(p2Match[1], 10);
          data.bh = parseInt(p2Match[2], 10); // 건강도는 정수로 받음
        }
        break;
      case 3: // p3t5cs<충전속도>ctr<남은시간>
        // cs는 "3.2W" 형태, ctr은 "10m" 형태
        const p3Match = payload.match(/^cs([-?\d.]+[W])ctr(.+)$/); // ★ 정규 표현식 수정
        if (p3Match) {
          data.cs = p3Match[1];
          data.ctr = p3Match[2];
        }
        break;
      case 4: // p4t5ut<사용시간>rd<교체예정>
        // ut는 2 3 형태, rd는 "3w" 또는 "-" 형태
        const p4Match = payload.match(/^ut(\d+)(\d+)rd(.+)$/);
        if (p4Match) {
          const hr = p4Match[1];
          const min = p4Match[2];
          const rd = p4Match[3];

          data.ut = `${hr}H ${min}M`;
          data.rd = rd; // rd 값은 그대로 할당
        }
        break;
      case 5: // p5t5be<배터리에러코드>
        const p5Match = payload.match(/^be(\d+)$/);
        if (p5Match) {
          data.be = parseInt(p5Match[1], 10);
        }
        break;
      default:
        this.addLog('error', `알 수 없는 패킷 번호: ${packetNumber}`);
        return null;
    }

    // 모든 데이터가 성공적으로 파싱되었는지 확인 (간단한 검증)
    if (Object.keys(data).length === 0) {
      this.addLog('error', `페이로드 파싱 실패: "${payload}" for packet ${packetNumber}`);
      return null;
    }

    return { p: packetNumber, t: totalPackets, data };
  }

  async sendTestData(): Promise<void> {
    const testCommands = [
      'GET_STATUS',
      'GET_BATTERY',
      'SET_LED_ON',
      'SET_LED_OFF'
    ];

    for (const command of testCommands) {
      await this.sendCommand(command);
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 간격
    }
  }

  getStatus(): BLEStatus {
    return this.currentStatus;
  }

  destroy() {
    this.manager.stopDeviceScan();
    if (this.connectedDevice) {
      this.manager.cancelDeviceConnection(this.connectedDevice.id);
    }
    this.manager.destroy();
  }
}

// Singleton instance
export const BLEManager = new BLEManagerClass();
