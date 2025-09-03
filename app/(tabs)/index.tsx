import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { BLEManager, BLEStatus, BLELogEntry } from '../../utils/BLEManager';

export default function HomeScreen() {
    // BLE State
    const [bleStatus, setBleStatus] = useState<BLEStatus>({
        isScanning: false,
        isConnected: false,
    });
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('기기 검색 중...');
    const [countdown, setCountdown] = useState(10);
    const hasTriedConnection = useRef(false);

    // Dynamic data based on BLE connection
    const batteryLevel = bleStatus.batteryLevel || '-'; // Use BLE data or fallback
    const chargingCycles = bleStatus.chargingCycles ?? (bleStatus.isConnected ? 342 : '-');
    const chargingSpeed = bleStatus.chargingSpeed || (bleStatus.isConnected ? '45W 고속충전' : '-');
    const batteryHealth = bleStatus.batteryHealth || (bleStatus.isConnected ? '87% (매우 양호)' : '-');
    const usageTime = bleStatus.usageTime || (bleStatus.isConnected ? '2년 3개월' : '-');
    const replacementDate = bleStatus.replacementDate || (bleStatus.isConnected ? '약 3주 후' : '-');
    const chargingTimeRemaining = bleStatus.chargingTimeRemaining || '-';
    const batteryStatus = bleStatus.batteryStatus ?? 1; // 0=방전(주행), 1=유지, 2=충전

    let StatusText = '';
    switch (batteryStatus) {
        case 0:
            StatusText = '🔴 주행 중';
            break;
        case 1:
            StatusText = '⚪ 대기 중';
            break;
        case 2:
            StatusText = '🟢 충전 중';
            break;
        default:
            StatusText = '⚪ 연결 불가';
    }
    const chargingTimeText = batteryStatus === 2 ? `예상 완료: ${chargingTimeRemaining}` : ' ';

    useEffect(() => {
        // Setup BLE callbacks
        BLEManager.setStatusCallback((status) => {
            setBleStatus(status);
            console.log("📊 Updated BLE Status:", status);

            if (status.isConnected) {
                setIsConnecting(false);
            }
        });

        // Setup device found callback for immediate connection
        BLEManager.setDeviceFoundCallback(async (deviceId) => {
            console.log('Device found, attempting immediate connection:', deviceId);
            setConnectionStatus('기기 연결 중...');
            try {
                await BLEManager.connectToDevice(deviceId);
                if (BLEManager.getStatus().isConnected) {
                    setConnectionStatus('데이터 수신 중...');
                    await BLEManager.readBatteryLevel();
                }
            } catch (error) {
                console.log('Auto connection failed:', error);
            }
        });

        // Initial auto connect only once
        if (!hasTriedConnection.current) {
            hasTriedConnection.current = true;
            autoConnect();
        }

        // Cleanup on unmount
        return () => {
            // Don't destroy BLEManager here as it might be used by settings
        };
    }, []);

    // Auto connect function
    const autoConnect = async () => {
        try {
            setIsConnecting(true);
            setConnectionStatus('기기 검색 중...');

            await BLEManager.startScan();

            // Auto timeout after 10 seconds for development
            setCountdown(10);
            const countdownInterval = setInterval(() => {
                setCountdown(prev => {
                    if (prev <= 1) {
                        clearInterval(countdownInterval);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            const timeoutId = setTimeout(() => {
                console.log('BLE connection timeout - proceeding without device');
                clearInterval(countdownInterval);
                setIsConnecting(false);
            }, 10000); // 10 seconds

        } catch (error) {
            console.log('Auto connection failed:', error);
            setIsConnecting(false);
        }
    };

    // Focus effect - do nothing, only initial connection on app launch
    useFocusEffect(
        useCallback(() => {
            // Do nothing on focus - only connect once on initial load
        }, [])
    );

    // Loading screen component
    if (isConnecting) {
        return (
            <View style={styles.loadingContainer}>
                <Image source={require('../../assets/images/Header.png')} style={styles.loadingLogo} />
                <ActivityIndicator size="large" color="#89C627" style={styles.loadingSpinner} />
                <Text style={styles.loadingText}>{connectionStatus}</Text>
                <Text style={styles.loadingSubtext}>기기에서 데이터 받아오는 중입니다...</Text>
                <View style={styles.countdownContainer}>
                    <Text style={styles.countdownText}>{countdown}초 후 자동으로 계속됩니다</Text>
                </View>
                <View style={styles.connectionStatusIndicator}>
                    <View style={[styles.connectionDot, { backgroundColor: '#89C627' }]} />
                    <Text style={styles.connectionStatusText}>
                        {bleStatus.isConnected ? '연결됨' : '연결 중...'}
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            {/* 로고 */}
            <View style={styles.header}>
                <Image source={require('../../assets/images/Header.png')} style={styles.logo} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* 현재 배터리 상태 */}
                <View style={styles.mainStatusCard}>
                    <View style={styles.batteryDisplay}>
                        <View style={styles.batteryIconContainer}>
                            <Text>배터리 현 상태</Text>
                            <Text style={styles.batteryPercentage}>{batteryLevel}%</Text>
                        </View>
                        <View style={styles.batteryInfo}>
                            <Text style={styles.chargingStatus}>{StatusText}</Text>
                            <Text style={styles.chargingTime}>{chargingTimeText}</Text>
                        </View>
                    </View>
                </View>

                {/* 빠른 통계 */}
                <View style={styles.quickStats}>
                    <View style={styles.statCard}>
                        <Ionicons name="flash" size={20} color="#89C627" />
                        <Text style={styles.statValue}>{batteryLevel}%</Text>
                        <Text style={styles.statLabel}>배터리 상태</Text>
                    </View>
                    <View style={styles.statCard}>
                        <Ionicons name="repeat" size={20} color="#4b324d" />
                        <Text style={styles.statValue}>{chargingCycles}</Text>
                        <Text style={styles.statLabel}>충전 사이클</Text>
                    </View>
                </View>

                {/* 배터리 상세 정보 */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>배터리 상세 정보</Text>
                    <View style={styles.detailsGrid}>
                        <View style={styles.detailCard}>
                            <View style={styles.detailHeader}>
                                <Ionicons name="heart" size={16} color="#89C627" />
                                <Text style={styles.detailTitle}>배터리 수명</Text>
                            </View>
                            <Text style={styles.detailValue}>{batteryHealth}</Text>
                        </View>
                        <View style={styles.detailCard}>
                            <View style={styles.detailHeader}>
                                <Ionicons name="time" size={16} color="#4b324d" />
                                <Text style={styles.detailTitle}>사용 시간</Text>
                            </View>
                            <Text style={styles.detailValue}>{usageTime}</Text>
                        </View>
                        <View style={styles.detailCard}>
                            <View style={styles.detailHeader}>
                                <Ionicons name="speedometer" size={16} color="#ffa500" />
                                <Text style={styles.detailTitle}>충전 속도</Text>
                            </View>
                            <Text style={styles.detailValue}>{chargingSpeed}</Text>
                        </View>
                        <View style={styles.detailCard}>
                            <View style={styles.detailHeader}>
                                <Ionicons name="calendar" size={16} color="#6c757d" />
                                <Text style={styles.detailTitle}>교체 예정</Text>
                            </View>
                            <Text style={styles.detailValue}>{replacementDate}개월 후</Text>
                        </View>
                    </View>
                </View>

                {/* 연결 상태 표시 */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>기기 연결 상태</Text>
                    <View style={styles.connectionCard}>
                        <View style={styles.connectionHeader}>
                            <View style={styles.connectionIndicator}>
                                <View style={[
                                    styles.connectionDot,
                                    { backgroundColor: bleStatus.isConnected ? '#89C627' : '#ff6b6b' }
                                ]} />
                                <Text style={styles.connectionText}>
                                    {bleStatus.isConnected ? 'ESP32 연결됨' : '기기 연결 안됨'}
                                </Text>
                            </View>
                            {bleStatus.deviceName && (
                                <Text style={styles.deviceName}>{bleStatus.deviceName}</Text>
                            )}
                        </View>
                        {!bleStatus.isConnected && (
                            <Text style={styles.connectionSubtext}>
                                Settings 탭에서 수동으로 연결하거나 앱을 재시작하세요.
                            </Text>
                        )}
                    </View>
                </View>

                {/* 배터리 관리 팁 */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>배터리 관리 팁</Text>
                    <View style={styles.tipCard}>
                        <View style={styles.tipIcon}>
                            <Ionicons name="bulb" size={20} color="#89C627" />
                        </View>
                        <View style={styles.tipContent}>
                            <Text style={styles.tipTitle}>최적 충전 범위</Text>
                            <Text style={styles.tipText}>배터리 수명을 위해 20-80% 범위에서 사용하세요.</Text>
                        </View>
                    </View>
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
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
        resizeMode: 'contain'
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
    },

    // Main Status Card
    mainStatusCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    batteryDisplay: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    batteryIconContainer: {
        alignItems: 'flex-start',
    },
    batteryPercentage: {
        fontSize: 24,
        fontWeight: '700',
        color: '#2c3e50',
        marginTop: 8,
    },
    batteryInfo: {
        alignItems: 'flex-end',
    },
    chargingStatus: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    chargingTime: {
        fontSize: 14,
        color: '#6c757d',
    },
    progressContainer: {
        marginTop: 8,
    },
    progressBar: {
        height: 8,
        backgroundColor: '#e9ecef',
        borderRadius: 4,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#89C627',
        borderRadius: 4,
    },
    progressText: {
        fontSize: 12,
        color: '#6c757d',
        marginTop: 8,
        textAlign: 'center',
    },

    // Quick Stats
    quickStats: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 16,
        gap: 12,
    },
    statCard: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    statValue: {
        fontSize: 18,
        fontWeight: '700',
        color: '#2c3e50',
        marginTop: 8,
    },
    statLabel: {
        fontSize: 11,
        color: '#6c757d',
        marginTop: 4,
        textAlign: 'center',
    },

    // Section
    section: {
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#2c3e50',
        marginBottom: 12,
    },

    // Details Grid
    detailsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    detailCard: {
        width: '48%',
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    detailHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    detailTitle: {
        fontSize: 12,
        color: '#6c757d',
        marginLeft: 6,
        fontWeight: '500',
    },
    detailValue: {
        fontSize: 14,
        color: '#2c3e50',
        fontWeight: '600',
    },

    // Charging History
    chargingHistory: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    historyItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f3f4',
    },
    historyIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f8f9fa',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    historyInfo: {
        flex: 1,
    },
    historyTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#2c3e50',
    },
    historyTime: {
        fontSize: 12,
        color: '#6c757d',
        marginTop: 2,
    },
    historyValue: {
        fontSize: 14,
        fontWeight: '600',
        color: '#89C627',
    },

    // Tip Card
    tipCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    tipIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#e8f5e8',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    tipContent: {
        flex: 1,
    },
    tipTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#2c3e50',
        marginBottom: 4,
    },
    tipText: {
        fontSize: 12,
        color: '#6c757d',
        lineHeight: 18,
    },

    // Quick Actions
    quickActions: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 20,
    },
    actionButton: {
        flex: 1,
        backgroundColor: '#89C627',
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 3,
        shadowColor: '#89C627',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    actionButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    actionButtonSecondary: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#89C627',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    actionButtonSecondaryText: {
        color: '#89C627',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },

    // BLE Styles
    bleStatusCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
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
    // Loading screen styles
    loadingContainer: {
        flex: 1,
        backgroundColor: '#f3f3f3',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    loadingLogo: {
        width: '60%',
        resizeMode: 'contain',
        marginBottom: 40,
    },
    loadingSpinner: {
        marginBottom: 20,
    },
    loadingText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#2c3e50',
        marginBottom: 8,
        textAlign: 'center',
    },
    loadingSubtext: {
        fontSize: 14,
        color: '#6c757d',
        textAlign: 'center',
        marginBottom: 20,
    },
    connectionStatusIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    connectionStatusText: {
        fontSize: 14,
        color: '#89C627',
        marginLeft: 6,
        fontWeight: '500',
    },
    countdownContainer: {
        padding: 12,
        marginVertical: 16,
        elevation: 2,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    countdownText: {
        fontSize: 14,
        color: '#000000',
        textAlign: 'center',
        fontWeight: '500',
    },

    // Connection card styles
    connectionCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    connectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    connectionIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    connectionDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    connectionText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#2c3e50',
    },
    deviceName: {
        fontSize: 12,
        color: '#6c757d',
        fontWeight: '500',
    },
    connectionSubtext: {
        fontSize: 12,
        color: '#6c757d',
        fontStyle: 'italic',
    },
});
