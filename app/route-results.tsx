import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Geocoding from 'react-native-geocoding';
import { getDistance } from 'geolib';
import { BLEManager } from '../utils/BLEManager';

// Initialize Geocoding with Google Maps API key
const GOOGLE_MAPS_API_KEY = 'AIzaSyAJ9tX3V3pZfVN0h3tCoybeypOr3XgKQGg';
Geocoding.init(GOOGLE_MAPS_API_KEY);

// Function to get cycling distance between two points using Google Directions API
const getCyclingDistance = async (origin: {latitude: number, longitude: number}, destination: {latitude: number, longitude: number}): Promise<number> => {
    try {
        const originStr = `${origin.latitude},${origin.longitude}`;
        const destinationStr = `${destination.latitude},${destination.longitude}`;

        const response = await fetch(
            `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destinationStr}&mode=bicycling&key=${GOOGLE_MAPS_API_KEY}`
        );

        const data = await response.json();

        if (data.status === 'OK' && data.routes.length > 0) {
            const route = data.routes[0];
            const distanceInMeters = route.legs.reduce((total: number, leg: any) => total + leg.distance.value, 0);
            return distanceInMeters / 1000; // Convert to kilometers
        } else {
            console.warn('Directions API error:', data.status, 'Using direct distance as fallback');
            // Fallback to direct distance if API fails
            return getDistance(origin, destination) / 1000;
        }
    } catch (error) {
        console.error('Error fetching cycling route:', error);
        // Fallback to direct distance if network error
        return getDistance(origin, destination) / 1000;
    }
};

export default function RouteResultsScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();

    const routeData = {
        startingPoint: params.startingPoint || '',
        waypoints: params.waypoints ? JSON.parse(params.waypoints as string) : [],
        destination: params.destination || '',
        isRoundTrip: params.isRoundTrip === 'true'
    };

    // State for coordinates and calculations
    const [coordinates, setCoordinates] = useState<Array<{latitude: number, longitude: number}>>([]);
    const [totalDistance, setTotalDistance] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Calculated values based on distance
    const totalBatteryConsumption = Math.round(totalDistance * 9.4); // 9.4% per km
    const usageTimeHours = totalDistance / 7.2; // 7.2 km/h
    const usageTimeMinutes = Math.round(usageTimeHours * 60); // Convert to minutes
    const minChargeLevel = Math.min(100, totalBatteryConsumption + 10); // Consumption + 15% safety margin

    // Default coordinates for fallback
    const defaultCoordinates = [
        { latitude: 37.5665, longitude: 126.9780 },
        { latitude: 37.5583, longitude: 126.9942 }
    ];

    // MapView reference for fitToCoordinates
    const mapRef = useRef<MapView>(null);

    // Geocode addresses to coordinates
    useEffect(() => {
        const geocodeAddresses = async () => {
            try {
                setLoading(true);
                const coords = [];

                console.log('Starting geocoding process...');
                console.log('Route data:', {
                    startingPoint: routeData.startingPoint,
                    waypoints: routeData.waypoints,
                    destination: routeData.destination,
                    isRoundTrip: routeData.isRoundTrip
                });

                // Geocode starting point
                if (routeData.startingPoint) {
                    try {
                        // Add Korean region context to improve geocoding accuracy
                        const searchQuery = `${routeData.startingPoint}, 서울, 대한민국`;
                        const startResult = await Geocoding.from(searchQuery);
                        const startCoord = startResult.results[0].geometry.location;
                        coords.push({ latitude: startCoord.lat, longitude: startCoord.lng });
                        console.log('Added starting point:', routeData.startingPoint, '→', { lat: startCoord.lat, lng: startCoord.lng });
                    } catch (err) {
                        console.warn('Failed to geocode starting point:', err);
                        coords.push(defaultCoordinates[0]);
                        console.log('Used default starting point:', defaultCoordinates[0]);
                    }
                } else {
                    coords.push(defaultCoordinates[0]);
                    console.log('No starting point provided, using default:', defaultCoordinates[0]);
                }

                // Geocode waypoints in order
                console.log('Processing waypoints:', routeData.waypoints);
                for (let i = 0; i < routeData.waypoints.length; i++) {
                    const waypoint = routeData.waypoints[i];
                    if (waypoint && waypoint.trim()) {
                        try {
                            const waypointQuery = `${waypoint}, 서울, 대한민국`;
                            const waypointResult = await Geocoding.from(waypointQuery);
                            const waypointCoord = waypointResult.results[0].geometry.location;
                            coords.push({ latitude: waypointCoord.lat, longitude: waypointCoord.lng });
                            console.log(`Added waypoint ${i + 1}:`, waypoint, '→', { lat: waypointCoord.lat, lng: waypointCoord.lng });
                        } catch (err) {
                            console.warn('Failed to geocode waypoint:', waypoint, err);
                        }
                    }
                }

                // Geocode destination
                if (routeData.destination) {
                    try {
                        const destQuery = `${routeData.destination}, 서울, 대한민국`;
                        const destResult = await Geocoding.from(destQuery);
                        const destCoord = destResult.results[0].geometry.location;
                        coords.push({ latitude: destCoord.lat, longitude: destCoord.lng });
                        console.log('Added destination:', routeData.destination, '→', { lat: destCoord.lat, lng: destCoord.lng });
                    } catch (err) {
                        console.warn('Failed to geocode destination:', err);
                        coords.push(defaultCoordinates[1]);
                        console.log('Used default destination:', defaultCoordinates[1]);
                    }
                } else {
                    coords.push(defaultCoordinates[1]);
                    console.log('No destination provided, using default:', defaultCoordinates[1]);
                }

                // Calculate total distance using direct distance between coordinates
                let distance = 0;

                // Calculate distance for consecutive waypoints using direct distance
                for (let i = 0; i < coords.length - 1; i++) {
                    distance += getDistance(coords[i], coords[i + 1]) / 1000; // Convert to km
                }

                // Add return trip distance if round trip
                if (routeData.isRoundTrip && coords.length >= 2) {
                    distance += getDistance(coords[coords.length - 1], coords[0]) / 1000;
                }

                setCoordinates(coords);
                setTotalDistance(Math.round(distance * 10) / 10); // Round to 1 decimal
                setError('');

                console.log('Final coordinates array (in route order):', coords);
                console.log('Total distance calculated:', Math.round(distance * 10) / 10, 'km');
            } catch (err) {
                console.error('Geocoding error:', err);
                setError('주소를 찾을 수 없습니다. 기본 경로를 표시합니다.');
                setCoordinates(defaultCoordinates);
                setTotalDistance(8.5); // Default distance between Seoul coords
            } finally {
                setLoading(false);
            }
        };

        geocodeAddresses();
    }, [routeData.startingPoint, routeData.destination, JSON.stringify(routeData.waypoints), routeData.isRoundTrip]);

    const renderRouteStep = (step: string, index: number, icon: string, color: string) => (
        <View key={index} style={styles.routeStep}>
            <View style={[styles.routeStepIcon, { backgroundColor: color }]}>
                <Ionicons name={icon as any} size={16} color="#fff" />
            </View>
            <Text style={styles.routeStepText}>{step}</Text>
        </View>
    );

    const handleStartCharging = async () => {
        try {
            // BLE로 거리 데이터 전송 (소수점 포함)
            await BLEManager.sendDistance(totalDistance);

            Alert.alert(
                "주행 경로 전송 완료",
                `지정된 경로 설정이 완료되었으니 기기의 주행 속도 제어 버튼을 클릭해주세요!`,
                [
                    {
                        text: "확인",
                        onPress: () => router.push('/'),
                    }
                ]
            );
        } catch (error) {
            Alert.alert(
                "전송 실패",
                "기기에 거리 정보를 전송하는데 실패했습니다. 기기 연결을 확인해주세요.",
                [
                    {
                        text: "확인",
                    }
                ]
            );
        }
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#2c3e50" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>경로 결과</Text>
                <View style={styles.headerRight} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Route Overview */}
                <View style={styles.routeOverview}>
                    <Text style={styles.sectionTitle}>경로 요약</Text>
                    <View style={styles.routeSteps}>
                        {renderRouteStep((routeData.startingPoint as string) || '출발지', 0, 'radio-button-on', '#89C627')}
                        {routeData.waypoints.map((waypoint: string, index: number) =>
                            renderRouteStep(waypoint, index + 1, 'flag', '#ffa500')
                        )}
                        {renderRouteStep((routeData.destination as string) || '도착지', -1, 'location', '#ff6b6b')}
                        {routeData.isRoundTrip && renderRouteStep((routeData.startingPoint as string) || '출발지로 복귀', -2, 'radio-button-on', '#89C627')}
                    </View>
                </View>

                {/* Map Display */}
                <View style={styles.mapContainer}>
                    {loading ? (
                        <View style={[styles.map, styles.loadingContainer]}>
                            <ActivityIndicator size="large" color="#89C627" />
                            <Text style={styles.loadingText}>경로를 검색하는 중...</Text>
                        </View>
                    ) : (
                        <MapView
                            ref={mapRef}
                            style={styles.map}
                            initialRegion={{
                                latitude: coordinates[0]?.latitude || 37.5665,
                                longitude: coordinates[0]?.longitude || 126.9780,
                                latitudeDelta: 0.02,
                                longitudeDelta: 0.02,
                            }}
                            onMapReady={() => {
                                // Fit map to show all coordinates after map is ready
                                if (coordinates.length > 1 && mapRef.current) {
                                    // Include all coordinates for fitting
                                    const allCoords = routeData.isRoundTrip && coordinates.length >= 2
                                        ? [...coordinates, coordinates[0]]
                                        : coordinates;

                                    setTimeout(() => {
                                        mapRef.current?.fitToCoordinates(allCoords, {
                                            edgePadding: {
                                                top: 50,
                                                right: 50,
                                                bottom: 50,
                                                left: 50
                                            },
                                            animated: true
                                        });
                                    }, 500); // Delay to ensure map is fully rendered
                                }
                            }}
                        >
                            {/* Render markers in route order: start → waypoints → destination */}
                            {coordinates.map((coord, index) => {
                                let pinColor = '#89C627'; // Default green for start
                                let title = '출발지';

                                if (index === coordinates.length - 1) {
                                    pinColor = '#ff6b6b'; // Red for destination
                                    title = '도착지';
                                } else if (index > 0 && index < coordinates.length - 1) {
                                    pinColor = '#ffa500'; // Orange for waypoints
                                    title = `경유지 ${index}`;
                                }

                                return (
                                    <Marker
                                        key={index}
                                        coordinate={coord}
                                        pinColor={pinColor}
                                        title={title}
                                    />
                                );
                            })}

                            {/* Render polyline connecting all points in order: start → waypoints → destination */}
                            {coordinates.length > 1 && (
                                <Polyline
                                    coordinates={coordinates}
                                    strokeColor="#89C627"
                                    strokeWidth={4}
                                />
                            )}

                            {/* Render return trip line if round trip */}
                            {routeData.isRoundTrip && coordinates.length >= 2 && (
                                <Polyline
                                    coordinates={[coordinates[coordinates.length - 1], coordinates[0]]}
                                    strokeColor="#89C627"
                                    strokeWidth={4}
                                    lineDashPattern={[5, 5]}
                                />
                            )}
                        </MapView>
                    )}
                    {error && (
                        <View style={styles.errorContainer}>
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    )}
                </View>

                {/* Battery Analysis */}
                <View style={styles.batteryAnalysis}>
                    <Text style={styles.sectionTitle}>배터리 사용량 측정</Text>
                    <View style={styles.metricsGrid}>
                        <View style={styles.metricCard}>
                            <Ionicons name="battery-charging" size={24} color="#89C627" />
                            <Text style={styles.metricValue}>{totalBatteryConsumption}%</Text>
                            <Text style={styles.metricLabel}>총 배터리 소모량</Text>
                        </View>
                        <View style={styles.metricCard}>
                            <Ionicons name="time" size={24} color="#4b324d" />
                            <Text style={styles.metricValue}>{usageTimeMinutes}분</Text>
                            <Text style={styles.metricLabel}>사용 시간</Text>
                        </View>
                        <View style={styles.metricCard}>
                            <Ionicons name="flash" size={24} color="#ff6b6b" />
                            <Text style={styles.metricValue}>{minChargeLevel}%</Text>
                            <Text style={styles.metricLabel}>최소 충전량</Text>
                        </View>
                        <View style={styles.metricCard}>
                            <Ionicons name="speedometer" size={24} color="#6c757d" />
                            <Text style={styles.metricValue}>{totalDistance}km</Text>
                            <Text style={styles.metricLabel}>총 거리</Text>
                        </View>
                    </View>
                </View>

                {/* Recommendations */}
                <View style={styles.recommendations}>
                    <Text style={styles.sectionTitle}>주행 속도 안내</Text>
                    <View style={styles.recommendationCard}>
                        <View style={styles.recommendationIcon}>
                            <Ionicons name="warning" size={20} color="#ffa500" />
                        </View>
                        <View style={styles.recommendationContent}>
                            <Text style={styles.recommendationTitle}>배터리 과방전 방지</Text>
                            <Text style={styles.recommendationText}>
                                전원 및 속도 버튼을 제어하여 주행 중 과방전을 방지합니다.
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Action Buttons */}
                <View style={styles.actionButtons}>
                    <TouchableOpacity style={styles.startChargingButton} onPress={handleStartCharging}>
                        <Ionicons name="flash" size={20} color="#fff" style={styles.buttonIcon} />
                        <Text style={styles.startChargingText}>주행 설정하기</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 50,
        paddingBottom: 15,
        backgroundColor: '#fff',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#2c3e50',
    },
    headerRight: {
        width: 40,
    },
    content: {
        flex: 1,
        padding: 20,
    },

    // Route Overview
    routeOverview: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        marginBottom: 20,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#2c3e50',
        marginBottom: 16,
    },
    routeSteps: {
        gap: 12,
    },
    routeStep: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    routeStepIcon: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    routeStepText: {
        fontSize: 16,
        color: '#2c3e50',
        fontWeight: '500',
    },

    // Map
    mapContainer: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 8,
        marginBottom: 20,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    map: {
        width: '100%',
        height: 200,
        borderRadius: 12,
    },
    loadingContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f8f9fa',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 14,
        color: '#6c757d',
    },
    errorContainer: {
        position: 'absolute',
        bottom: 10,
        left: 10,
        right: 10,
        backgroundColor: '#ff6b6b',
        borderRadius: 8,
        padding: 8,
    },
    errorText: {
        color: '#fff',
        fontSize: 12,
        textAlign: 'center',
    },

    // Battery Analysis
    batteryAnalysis: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        marginBottom: 20,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    metricsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 12,
    },
    metricCard: {
        width: '48%',
        backgroundColor: '#f8f9fa',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
    },
    metricValue: {
        fontSize: 20,
        fontWeight: '700',
        color: '#2c3e50',
        marginTop: 8,
    },
    metricLabel: {
        fontSize: 12,
        color: '#6c757d',
        marginTop: 4,
        textAlign: 'center',
    },

    // Recommendations
    recommendations: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        marginBottom: 20,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    recommendationCard: {
        flexDirection: 'row',
        backgroundColor: '#f8f9fa',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    recommendationIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#e8f5e8',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    recommendationContent: {
        flex: 1,
    },
    recommendationTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2c3e50',
        marginBottom: 4,
    },
    recommendationText: {
        fontSize: 14,
        color: '#6c757d',
        lineHeight: 20,
    },

    // Action Buttons
    actionButtons: {
        gap: 4,
        marginBottom: 30,
    },
    startChargingButton: {
        backgroundColor: '#89C627',
        borderRadius: 16,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 4,
        shadowColor: '#89C627',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    startChargingText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 8,
    },
    saveRouteButton: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#89C627',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    saveRouteText: {
        color: '#89C627',
        fontSize: 18,
        fontWeight: '600',
        marginLeft: 8,
    },
    buttonIcon: {
        marginRight: 4,
    },
});
