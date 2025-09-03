// screens/RouteSettingScreen.tsx
import React from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Image, TextInput} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function RouteSettingScreen() {
    const router = useRouter();
    const [isRoundTrip, setIsRoundTrip] = React.useState(false);
    const [startingPoint, setStartingPoint] = React.useState('');
    const [destination, setDestination] = React.useState('');
    const [waypoints, setWaypoints] = React.useState<string[]>([]);

    const addWaypoint = () => {
        setWaypoints([...waypoints, '']);
    };

    const removeWaypoint = (index: number) => {
        setWaypoints(waypoints.filter((_, i) => i !== index));
    };

    const updateWaypoint = (index: number, value: string) => {
        const newWaypoints = [...waypoints];
        newWaypoints[index] = value;
        setWaypoints(newWaypoints);
    };

    const handleSearch = () => {
        const routeData = {
            startingPoint,
            waypoints: JSON.stringify(waypoints.filter(wp => wp.trim() !== '')),
            destination,
            isRoundTrip: isRoundTrip.toString()
        };

        router.push({
            pathname: '/route-results',
            params: routeData
        });
    };

    // Seoul coordinates for the routes
    const homeCoordinate = { latitude: 37.5665, longitude: 126.9780 };
    const universityCoordinate = { latitude: 37.5583, longitude: 126.9942 };

    return (
        <SafeAreaView style={styles.container}>
            {/* Title */}
            <View style={styles.header}>
                <Image source={require('../../assets/images/Header.png')} style={styles.logo} />
            </View>
            <View style={styles.body}>
                <Text style={styles.sectionTitle}>주행 경로 설정</Text>
                <Text style={styles.subtitle}>이동할 경로를 설정하여 적정량만큼 배터리를 사용할 수 있어요!</Text>
                <View style={styles.infoRow}>
                    <Ionicons name="information-circle-outline" size={16} color="gray" />
                    <Text style={styles.infoText}>적정량만큼 배터리를 사용해야 하는 이유가 뭔가요?</Text>
                </View>
                {/* Route Search */}
                {/* Starting Point Input */}
                <View style={styles.inputContainer}>
                    <View style={styles.inputIconContainer}>
                        <Ionicons name="radio-button-on" size={20} color="#89C627" />
                    </View>
                    <TextInput
                        style={styles.textInput}
                        placeholder="출발지를 입력하세요"
                        placeholderTextColor="#999"
                        value={startingPoint}
                        onChangeText={setStartingPoint}
                    />
                    <TouchableOpacity style={styles.clearButton}>
                        <Ionicons name="close-circle" size={20} color="#ccc" />
                    </TouchableOpacity>
                </View>

                {/* Dynamic Waypoints */}
                {waypoints.map((waypoint, index) => (
                    <View key={index} style={styles.waypointContainer}>
                        <View style={styles.inputContainer}>
                            <View style={styles.inputIconContainer}>
                                <Ionicons name="flag" size={20} color="#ffa500" />
                            </View>
                            <TextInput
                                style={styles.textInput}
                                placeholder={`경유지 ${index + 1}을 입력하세요`}
                                placeholderTextColor="#999"
                                value={waypoint}
                                onChangeText={(value) => updateWaypoint(index, value)}
                            />
                            <TouchableOpacity
                                style={styles.removeButton}
                                onPress={() => removeWaypoint(index)}
                            >
                                <Ionicons name="close" size={20} color="#ff6b6b" />
                            </TouchableOpacity>
                        </View>
                    </View>
                ))}

                {/* Destination Input */}
                <View style={styles.inputContainer}>
                    <View style={styles.inputIconContainer}>
                        <Ionicons name="location" size={20} color="#ff6b6b" />
                    </View>
                    <TextInput
                        style={styles.textInput}
                        placeholder="도착지를 입력하세요"
                        placeholderTextColor="#999"
                        value={destination}
                        onChangeText={setDestination}
                    />
                    <TouchableOpacity style={styles.clearButton}>
                        <Ionicons name="close-circle" size={20} color="#ccc" />
                    </TouchableOpacity>
                </View>

                {/* Add Waypoint Button */}
                <TouchableOpacity style={styles.addWaypointButton} onPress={addWaypoint}>
                    <Ionicons name="add" size={20} color="#89C627" />
                    <Text style={styles.addWaypointText}>경유지 추가</Text>
                </TouchableOpacity>

                {/* Search Options */}
                <View style={styles.optionsContainer}>
                    <Text style={styles.optionsTitle}>경로 유형</Text>

                    <TouchableOpacity
                        style={[styles.checkpointOption, !isRoundTrip && styles.checkpointOptionSelected]}
                        onPress={() => setIsRoundTrip(false)}
                    >
                        <View style={[styles.checkbox, !isRoundTrip && styles.checkboxSelected]}>
                            {!isRoundTrip && <Ionicons name="checkmark" size={16} color="#fff" />}
                        </View>
                        <Ionicons name="arrow-forward" size={18} color="#6c757d" style={styles.optionIcon} />
                        <Text style={styles.optionText}>직행 경로</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.checkpointOption, isRoundTrip && styles.checkpointOptionSelected]}
                        onPress={() => setIsRoundTrip(true)}
                    >
                        <View style={[styles.checkbox, isRoundTrip && styles.checkboxSelected]}>
                            {isRoundTrip && <Ionicons name="checkmark" size={16} color="#fff" />}
                        </View>
                        <Ionicons name="swap-horizontal" size={18} color="#6c757d" style={styles.optionIcon} />
                        <Text style={styles.optionText}>왕복 경로</Text>
                    </TouchableOpacity>
                </View>

                {/* Search Button */}
                <TouchableOpacity style={styles.searchButton} activeOpacity={0.8} onPress={handleSearch}>
                    <Ionicons name="calculator" size={20} color="#fff" style={styles.buttonIcon} />
                    <Text style={styles.searchButtonText}>주행 거리 및 배터리 사용량 계산</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

// ====== Styles ======
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
    body: {
        paddingHorizontal: 20,
        paddingBottom: 10,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#2c3e50',
        marginBottom: 20,
    },
    subtitle: {
        fontSize: 12,
        color: '#6c757d',
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 8,
        borderRadius: 8,
        alignContent: 'center',
    },
    infoText: {
        marginLeft: 6,
        color: '#999',
        fontSize: 12,
    },

    // Input Components
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 12,
        marginVertical: 3,
        paddingHorizontal: 4,
        borderWidth: 1,
        borderColor: '#e9ecef',
    },
    inputIconContainer: {
        marginRight: 12,
    },
    textInput: {
        flex: 1,
        fontSize: 16,
        color: '#2c3e50',
        paddingVertical: 12,
    },
    clearButton: {
        padding: 4,
    },

    // Waypoint Components
    addWaypointButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8f9fa',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#89C627',
        borderStyle: 'dashed',
        paddingVertical: 12,
        paddingHorizontal: 16,
        marginVertical: 8,
    },
    addWaypointText: {
        marginLeft: 8,
        fontSize: 16,
        color: '#89C627',
        fontWeight: '600',
    },
    waypointContainer: {
        marginVertical: 4,
    },
    removeButton: {
        padding: 4,
    },
    swapContainer: {
        alignItems: 'center',
        marginVertical: 8,
    },
    swapButton: {
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 8,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },

    // Options
    optionsContainer: {
        marginVertical: 16,
    },
    optionsTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2c3e50',
        marginBottom: 12,
    },
    checkpointOption: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f8f9fa',
        borderRadius: 12,
        padding: 16,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#e9ecef',
    },
    checkpointOptionSelected: {
        backgroundColor: '#e8f5e8',
        borderColor: '#89C627',
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: '#ccc',
        marginRight: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxSelected: {
        backgroundColor: '#89C627',
        borderColor: '#89C627',
    },
    optionIcon: {
        marginRight: 8,
    },
    optionText: {
        fontSize: 16,
        color: '#2c3e50',
        fontWeight: '500',
    },
    // Search Button
    searchButton: {
        backgroundColor: '#89C627',
        paddingVertical: 8,
        paddingHorizontal: 8,
        borderRadius: 16,
        marginTop: 4,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        elevation: 4,
        shadowColor: '#89C627',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    buttonIcon: {
        marginRight: 8,
    },
    searchButtonText: {
        color: '#fff',
        fontWeight: '600',
        letterSpacing: 0.5,
    },
});
