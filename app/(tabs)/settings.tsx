import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BLEManager, BLEStatus, BLELogEntry } from '../../utils/BLEManager';

export default function SettingsScreen() {
    // BLE State
    const [bleStatus, setBleStatus] = useState<BLEStatus>({
        isScanning: false,
        isConnected: false,
    });
    const [bleLog, setBleLog] = useState<BLELogEntry[]>([]);
    const [showBleLog, setShowBleLog] = useState(false);

    useEffect(() => {
        // Setup BLE callbacks
        BLEManager.setStatusCallback((status) => {
            setBleStatus(status);
        });

        BLEManager.setLogCallback((log) => {
            setBleLog(prev => [...prev.slice(-9), log]); // Keep last 10 logs
        });

        // Cleanup on unmount
        return () => {
            // Don't destroy BLEManager here as it might be used by home screen
        };
    }, []);

    const handleBLEScan = async () => {
        try {
            await BLEManager.startScan();
        } catch (error) {
            Alert.alert('오류', 'BLE 스캔에 실패했습니다.');
        }
    };

    const handleBLEConnect = async () => {
        if (bleStatus.isConnected) {
            await BLEManager.disconnect();
        } else {
            if (bleStatus.deviceId) {
                await BLEManager.connectToDevice();
            } else {
                Alert.alert('알림', '먼저 ESP32 장치를 검색해주세요.');
            }
        }
    };

    const handleReadBattery = async () => {
        if (!bleStatus.isConnected) {
            Alert.alert('알림', '먼저 ESP32 장치에 연결해주세요.');
            return;
        }
        await BLEManager.readBatteryLevel();
    };

    const handleSendTestData = async () => {
        if (!bleStatus.isConnected) {
            Alert.alert('알림', '먼저 ESP32 장치에 연결해주세요.');
            return;
        }
        await BLEManager.sendTestData();
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Image source={require('../../assets/images/Header.png')} style={styles.logo} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* BLE 연결 테스트 */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>ESP32 BLE 연결 테스트</Text>

                    {/* BLE 상태 카드 */}
                    <View style={styles.bleStatusCard}>
                        <View style={styles.bleStatusHeader}>
                            <View style={styles.bleStatusIndicator}>
                                <View style={[
                                    styles.bleStatusDot,
                                    { backgroundColor: bleStatus.isConnected ? '#89C627' :
                                                       bleStatus.isScanning ? '#ffa500' : '#ff6b6b' }
                                ]} />
                                <Text style={styles.bleStatusText}>
                                    {bleStatus.isConnected ? '연결됨' :
                                     bleStatus.isScanning ? '스캔 중...' : '연결 안됨'}
                                </Text>
                            </View>
                            {bleStatus.deviceName && (
                                <Text style={styles.bleDeviceName}>{bleStatus.deviceName}</Text>
                            )}
                        </View>

                        {bleStatus.batteryLevel !== undefined && (
                            <View style={styles.bleBatteryInfo}>
                                <Ionicons name="battery-charging" size={16} color="#89C627" />
                                <Text style={styles.bleBatteryText}>ESP32 배터리: {bleStatus.batteryLevel}%</Text>
                            </View>
                        )}

                        {bleStatus.lastError && (
                            <View style={styles.bleErrorInfo}>
                                <Ionicons name="warning" size={16} color="#ff6b6b" />
                                <Text style={styles.bleErrorText}>{bleStatus.lastError}</Text>
                            </View>
                        )}
                    </View>

                    {/* BLE 컨트롤 버튼들 */}
                    <View style={styles.bleControlsGrid}>
                        <TouchableOpacity
                            style={[styles.bleButton, bleStatus.isScanning && styles.bleButtonDisabled]}
                            onPress={handleBLEScan}
                            disabled={bleStatus.isScanning}
                        >
                            <Ionicons name="search" size={16} color="#fff" />
                            <Text style={styles.bleButtonText}>
                                {bleStatus.isScanning ? '스캔 중...' : '장치 검색'}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.bleButton,
                                bleStatus.isConnected ? styles.bleButtonSecondary : styles.bleButton,
                                !bleStatus.deviceId && !bleStatus.isConnected && styles.bleButtonDisabled
                            ]}
                            onPress={handleBLEConnect}
                            disabled={!bleStatus.deviceId && !bleStatus.isConnected}
                        >
                            <Ionicons
                                name={bleStatus.isConnected ? "link" : "bluetooth"}
                                size={16}
                                color={bleStatus.isConnected ? "#89C627" : "#fff"}
                            />
                            <Text style={[
                                styles.bleButtonText,
                                bleStatus.isConnected && styles.bleButtonSecondaryText
                            ]}>
                                {bleStatus.isConnected ? '연결 해제' : '연결하기'}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.bleButton, !bleStatus.isConnected && styles.bleButtonDisabled]}
                            onPress={handleReadBattery}
                            disabled={!bleStatus.isConnected}
                        >
                            <Ionicons name="battery-charging" size={16} color="#fff" />
                            <Text style={styles.bleButtonText}>배터리 확인</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.bleButton, !bleStatus.isConnected && styles.bleButtonDisabled]}
                            onPress={handleSendTestData}
                            disabled={!bleStatus.isConnected}
                        >
                            <Ionicons name="send" size={16} color="#fff" />
                            <Text style={styles.bleButtonText}>테스트 전송</Text>
                        </TouchableOpacity>
                    </View>

                    {/* 로그 토글 버튼 */}
                    <TouchableOpacity
                        style={styles.bleLogToggle}
                        onPress={() => setShowBleLog(!showBleLog)}
                    >
                        <Ionicons name={showBleLog ? "chevron-up" : "chevron-down"} size={16} color="#89C627" />
                        <Text style={styles.bleLogToggleText}>
                            {showBleLog ? '로그 숨기기' : '로그 보기'} ({bleLog.length})
                        </Text>
                    </TouchableOpacity>

                    {/* BLE 로그 */}
                    {showBleLog && (
                        <View style={styles.bleLogContainer}>
                            {bleLog.length === 0 ? (
                                <Text style={styles.bleLogEmpty}>로그가 없습니다</Text>
                            ) : (
                                bleLog.map((log, index) => (
                                    <View key={index} style={styles.bleLogEntry}>
                                        <View style={[
                                            styles.bleLogDot,
                                            { backgroundColor:
                                                log.type === 'success' ? '#89C627' :
                                                log.type === 'error' ? '#ff6b6b' : '#6c757d'
                                            }
                                        ]} />
                                        <Text style={styles.bleLogTime}>
                                            {log.timestamp.toLocaleTimeString()}
                                        </Text>
                                        <Text style={styles.bleLogMessage}>{log.message}</Text>
                                    </View>
                                ))
                            )}
                        </View>
                    )}
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f3f3f3',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 5,
    },
    logo: {
        width: '60%',
        resizeMode: 'contain',
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
    },
    section: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#2c3e50',
        marginBottom: 12,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },

    // BLE Styles
    bleStatusCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    bleStatusHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    bleStatusIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    bleStatusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    bleStatusText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#2c3e50',
    },
    bleDeviceName: {
        fontSize: 12,
        color: '#6c757d',
        fontWeight: '500',
    },
    bleBatteryInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    bleBatteryText: {
        fontSize: 12,
        color: '#89C627',
        marginLeft: 4,
        fontWeight: '500',
    },
    bleErrorInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    bleErrorText: {
        fontSize: 12,
        color: '#ff6b6b',
        marginLeft: 4,
    },
    bleControlsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
    },
    bleButton: {
        width: '48%',
        backgroundColor: '#89C627',
        borderRadius: 8,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 1,
    },
    bleButtonSecondary: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#89C627',
    },
    bleButtonDisabled: {
        backgroundColor: '#e9ecef',
        opacity: 0.6,
    },
    bleButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
    },
    bleButtonSecondaryText: {
        color: '#89C627',
    },
    bleLogToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: '#f1f3f4',
    },
    bleLogToggleText: {
        fontSize: 12,
        color: '#89C627',
        marginLeft: 4,
        fontWeight: '500',
    },
    bleLogContainer: {
        backgroundColor: '#f8f9fa',
        borderRadius: 8,
        padding: 12,
        maxHeight: 200,
    },
    bleLogEmpty: {
        textAlign: 'center',
        color: '#6c757d',
        fontSize: 12,
        fontStyle: 'italic',
    },
    bleLogEntry: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 2,
    },
    bleLogDot: {
        width: 4,
        height: 4,
        borderRadius: 2,
        marginRight: 6,
    },
    bleLogTime: {
        fontSize: 10,
        color: '#6c757d',
        width: 60,
        marginRight: 8,
    },
    bleLogMessage: {
        fontSize: 10,
        color: '#2c3e50',
        flex: 1,
    },
});
