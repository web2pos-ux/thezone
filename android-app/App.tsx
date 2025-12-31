/**
 * WEB2POS Table Order App
 * Android Native App with WebView
 * 
 * 주요 기능:
 * - 디바이스 고유 ID 생성 및 POS 자동 등록
 * - 30초마다 Heartbeat 전송
 * - POS에서 배정한 테이블 자동 수신
 * - WebView로 테이블 오더 페이지 표시
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StatusBar,
  BackHandler,
  Alert,
  ActivityIndicator,
  AppState,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage Keys
const STORAGE_KEY = '@table_order_config';
const DEVICE_ID_KEY = '@device_unique_id';

// Heartbeat 간격 (30초)
const HEARTBEAT_INTERVAL = 30000;

// 설정 동기화 간격 (10초)
const CONFIG_SYNC_INTERVAL = 10000;

interface Config {
  posHost: string;
  storeId: string;
  tableId: string;
  configured: boolean;
  deviceId?: string;
  autoAssigned?: boolean; // POS에서 자동 배정 받았는지
}

interface DeviceInfo {
  device_id: string;
  device_name: string;
  assigned_table_id: string | null;
  assigned_table_label: string | null;
  status: string;
}

const defaultConfig: Config = {
  posHost: '',
  storeId: 'default',
  tableId: '',
  configured: false,
  autoAssigned: false,
};

// UUID 생성 함수
const generateUUID = (): string => {
  return 'TABLET-' + 'xxxxxxxx'.replace(/[x]/g, () => {
    return Math.floor(Math.random() * 16).toString(16).toUpperCase();
  });
};

const App = () => {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [deviceId, setDeviceId] = useState<string>('');
  const [showSetup, setShowSetup] = useState(true);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState<'none' | 'registering' | 'registered' | 'error'>('none');
  const [assignedFromPOS, setAssignedFromPOS] = useState<string | null>(null);
  
  const webviewRef = useRef<WebView>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const configSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const appStateRef = useRef(AppState.currentState);

  // ==================== 디바이스 ID 관리 ====================
  
  // 디바이스 고유 ID 로드 또는 생성
  const getOrCreateDeviceId = useCallback(async (): Promise<string> => {
    try {
      let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = generateUUID();
        await AsyncStorage.setItem(DEVICE_ID_KEY, id);
        console.log('[Device] New device ID created:', id);
      } else {
        console.log('[Device] Existing device ID loaded:', id);
      }
      return id;
    } catch (e) {
      console.error('[Device] Failed to get/create device ID:', e);
      return generateUUID();
    }
  }, []);

  // ==================== POS 등록 및 Heartbeat ====================
  
  // POS에 디바이스 등록
  const registerDevice = useCallback(async (host: string, devId: string) => {
    if (!host || !devId) return;
    
    setRegistrationStatus('registering');
    
    try {
      const response = await fetch(`${host}/api/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: devId,
          device_name: `Table Tablet ${devId.slice(-4)}`,
          device_type: 'table_order',
          app_version: '1.0.0',
          os_version: Platform.OS + ' ' + Platform.Version,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('[Device] Registration successful:', data);
        setRegistrationStatus('registered');
        
        // 이미 테이블이 배정되어 있으면 자동 적용
        if (data.device?.assigned_table_id) {
          setAssignedFromPOS(data.device.assigned_table_id);
        }
        
        return data;
      } else {
        throw new Error('Registration failed');
      }
    } catch (e) {
      console.error('[Device] Registration error:', e);
      setRegistrationStatus('error');
      return null;
    }
  }, []);
  
  // Heartbeat 전송
  const sendHeartbeat = useCallback(async (host: string, devId: string) => {
    if (!host || !devId) return;
    
    try {
      const response = await fetch(`${host}/api/devices/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: devId,
          battery_level: null, // TODO: 배터리 정보 추가 (react-native-device-info 필요)
          is_charging: false,
          app_version: '1.0.0',
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('[Heartbeat] Sent successfully');
        
        // POS에서 테이블 배정이 변경되었는지 확인
        if (data.assigned_table_id && data.assigned_table_id !== config.tableId) {
          console.log('[Heartbeat] Table assignment changed:', data.assigned_table_id);
          setAssignedFromPOS(data.assigned_table_id);
        }
      }
    } catch (e) {
      console.error('[Heartbeat] Error:', e);
    }
  }, [config.tableId]);
  
  // 설정 동기화 (POS에서 배정된 테이블 확인)
  const syncConfigFromPOS = useCallback(async (host: string, devId: string) => {
    if (!host || !devId) return;
    
    try {
      const response = await fetch(`${host}/api/devices/${devId}/config`);
      
      if (response.ok) {
        const data = await response.json();
        const posConfig = data.config;
        
        // POS에서 테이블이 배정되었으면 자동 적용
        if (posConfig.assigned_table_id && posConfig.status === 'active') {
          if (posConfig.assigned_table_id !== config.tableId || !config.configured) {
            console.log('[ConfigSync] Auto-applying table from POS:', posConfig.assigned_table_id);
            
            const newConfig: Config = {
              ...config,
              posHost: host,
              tableId: posConfig.assigned_table_id,
              storeId: posConfig.store_id || 'default',
              configured: true,
              deviceId: devId,
              autoAssigned: true,
            };
            
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
            setConfig(newConfig);
            setShowSetup(false);
          }
        }
      }
    } catch (e) {
      console.error('[ConfigSync] Error:', e);
    }
  }, [config]);
  
  // Heartbeat 시작
  const startHeartbeat = useCallback((host: string, devId: string) => {
    // 기존 interval 정리
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
    
    // 즉시 한 번 전송
    sendHeartbeat(host, devId);
    
    // 주기적으로 전송
    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeat(host, devId);
    }, HEARTBEAT_INTERVAL);
    
    console.log('[Heartbeat] Started with interval:', HEARTBEAT_INTERVAL);
  }, [sendHeartbeat]);
  
  // 설정 동기화 시작
  const startConfigSync = useCallback((host: string, devId: string) => {
    if (configSyncIntervalRef.current) {
      clearInterval(configSyncIntervalRef.current);
    }
    
    configSyncIntervalRef.current = setInterval(() => {
      syncConfigFromPOS(host, devId);
    }, CONFIG_SYNC_INTERVAL);
    
    console.log('[ConfigSync] Started with interval:', CONFIG_SYNC_INTERVAL);
  }, [syncConfigFromPOS]);
  
  // 모든 interval 정리
  const stopAllIntervals = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (configSyncIntervalRef.current) {
      clearInterval(configSyncIntervalRef.current);
      configSyncIntervalRef.current = null;
    }
  }, []);

  // ==================== 앱 생명주기 관리 ====================
  
  // 앱 상태 변경 감지
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // 앱이 포그라운드로 돌아옴
        console.log('[AppState] App has come to foreground');
        if (config.posHost && deviceId) {
          sendHeartbeat(config.posHost, deviceId);
          syncConfigFromPOS(config.posHost, deviceId);
        }
      }
      appStateRef.current = nextAppState;
    });
    
    return () => {
      subscription.remove();
    };
  }, [config.posHost, deviceId, sendHeartbeat, syncConfigFromPOS]);

  // ==================== 초기화 ====================
  
  // 초기 로드
  useEffect(() => {
    const initialize = async () => {
      try {
        // 1. 디바이스 ID 로드/생성
        const devId = await getOrCreateDeviceId();
        setDeviceId(devId);
        
        // 2. 저장된 설정 로드
        const savedConfig = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedConfig) {
          const parsed = JSON.parse(savedConfig);
          setConfig({ ...parsed, deviceId: devId });
          
          if (parsed.configured && parsed.posHost && parsed.tableId) {
            // 3. POS에 등록
            await registerDevice(parsed.posHost, devId);
            
            // 4. Heartbeat 및 설정 동기화 시작
            startHeartbeat(parsed.posHost, devId);
            startConfigSync(parsed.posHost, devId);
            
            setShowSetup(false);
          } else if (parsed.posHost) {
            // POS 주소만 있으면 등록하고 설정 동기화 시작
            await registerDevice(parsed.posHost, devId);
            startConfigSync(parsed.posHost, devId);
          }
        }
      } catch (e) {
        console.error('[Init] Failed to initialize:', e);
      } finally {
        setLoading(false);
      }
    };
    
    initialize();
    
    return () => {
      stopAllIntervals();
    };
  }, []);

  // ==================== 이벤트 핸들러 ====================
  
  // Back 버튼 처리
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!showSetup && webviewRef.current) {
        webviewRef.current.goBack();
        return true;
      }
      return false;
    });

    return () => backHandler.remove();
  }, [showSetup]);

  // 연결 테스트
  const testConnection = async () => {
    setConnectionStatus('testing');
    try {
      const response = await fetch(`${config.posHost}/api/business-profile`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        setConnectionStatus('success');
        
        // 연결 성공 시 디바이스 등록
        if (deviceId) {
          await registerDevice(config.posHost, deviceId);
          startConfigSync(config.posHost, deviceId);
        }
      } else {
        throw new Error('Server error');
      }
    } catch (error) {
      setConnectionStatus('error');
      Alert.alert('Connection Failed', 'Cannot connect to POS server. Check the IP address.');
    }
  };

  // 설정 저장
  const saveConfig = async () => {
    if (!config.posHost || !config.tableId) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    const configToSave: Config = { 
      ...config, 
      configured: true,
      deviceId: deviceId,
      autoAssigned: false,
    };
    
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(configToSave));
      setConfig(configToSave);
      
      // POS에 등록 및 Heartbeat 시작
      await registerDevice(config.posHost, deviceId);
      startHeartbeat(config.posHost, deviceId);
      startConfigSync(config.posHost, deviceId);
      
      setShowSetup(false);
    } catch (e) {
      Alert.alert('Error', 'Failed to save configuration');
    }
  };

  // POS에서 배정받은 테이블로 자동 시작
  const useAssignedTable = async () => {
    if (!assignedFromPOS || !config.posHost) return;
    
    const configToSave: Config = {
      ...config,
      tableId: assignedFromPOS,
      configured: true,
      deviceId: deviceId,
      autoAssigned: true,
    };
    
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(configToSave));
      setConfig(configToSave);
      startHeartbeat(config.posHost, deviceId);
      setShowSetup(false);
      setAssignedFromPOS(null);
    } catch (e) {
      Alert.alert('Error', 'Failed to apply configuration');
    }
  };

  // 설정 리셋
  const resetConfig = () => {
    Alert.alert('Reset', 'Reset all settings?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          stopAllIntervals();
          await AsyncStorage.removeItem(STORAGE_KEY);
          // 디바이스 ID는 유지
          setConfig({ ...defaultConfig, deviceId });
          setConnectionStatus('idle');
          setRegistrationStatus('none');
          setAssignedFromPOS(null);
          setShowSetup(true);
        },
      },
    ]);
  };

  // 설정 화면 열기
  const openSettings = () => {
    setShowSetup(true);
  };

  // ==================== 렌더링 ====================
  
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#f59e0b" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // Setup Screen
  if (showSetup) {
    return (
      <SafeAreaView style={styles.setupContainer}>
        <StatusBar backgroundColor="#f59e0b" barStyle="light-content" />
        
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerIcon}>🍽️</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Table Order Setup</Text>
            <Text style={styles.headerSubtitle}>Configure this device</Text>
          </View>
          {/* 디바이스 ID 표시 */}
          <View style={styles.deviceIdBadge}>
            <Text style={styles.deviceIdText}>{deviceId.slice(-6)}</Text>
          </View>
        </View>

        {/* POS에서 배정된 테이블 알림 */}
        {assignedFromPOS && (
          <View style={styles.assignmentBanner}>
            <Text style={styles.assignmentText}>
              ✨ POS에서 테이블 <Text style={styles.assignmentTable}>{assignedFromPOS}</Text>이(가) 배정되었습니다
            </Text>
            <TouchableOpacity 
              style={styles.useAssignedButton}
              onPress={useAssignedTable}
            >
              <Text style={styles.useAssignedButtonText}>사용하기</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Form */}
        <View style={styles.form}>
          {/* POS Host */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>📡 POS Server Address</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={config.posHost}
                onChangeText={(text) => setConfig({ ...config, posHost: text })}
                placeholder="http://192.168.1.100:3088"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.testButton}
                onPress={testConnection}
                disabled={connectionStatus === 'testing'}
              >
                <Text style={styles.testButtonText}>
                  {connectionStatus === 'testing' ? '...' : 
                   connectionStatus === 'success' ? '✓' :
                   connectionStatus === 'error' ? '✗' : 'Test'}
                </Text>
              </TouchableOpacity>
            </View>
            {connectionStatus === 'success' && (
              <Text style={styles.successText}>✅ Connected to POS</Text>
            )}
            {connectionStatus === 'error' && (
              <Text style={styles.errorText}>❌ Connection failed</Text>
            )}
          </View>

          {/* 등록 상태 */}
          {registrationStatus !== 'none' && (
            <View style={styles.registrationStatus}>
              {registrationStatus === 'registering' && (
                <Text style={styles.registeringText}>📡 Registering with POS...</Text>
              )}
              {registrationStatus === 'registered' && (
                <Text style={styles.registeredText}>✅ Registered with POS</Text>
              )}
              {registrationStatus === 'error' && (
                <Text style={styles.registerErrorText}>⚠️ Registration failed</Text>
              )}
            </View>
          )}

          {/* Table ID */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}># Table Number {assignedFromPOS ? '(or use assigned)' : '(Required)'}</Text>
            <TextInput
              style={styles.inputLarge}
              value={config.tableId}
              onChangeText={(text) => setConfig({ ...config, tableId: text.toUpperCase() })}
              placeholder={assignedFromPOS || "T1, T2, A1, B3..."}
              placeholderTextColor="#9ca3af"
              autoCapitalize="characters"
            />
            <Text style={styles.hint}>
              {assignedFromPOS 
                ? `POS assigned: ${assignedFromPOS} - you can use this or enter different` 
                : 'Enter the table ID exactly as shown in POS'}
            </Text>
          </View>

          {/* Advanced Settings */}
          <TouchableOpacity
            style={styles.advancedToggle}
            onPress={() => setShowAdvanced(!showAdvanced)}
          >
            <Text style={styles.advancedToggleText}>
              ⚙️ {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
            </Text>
          </TouchableOpacity>

          {showAdvanced && (
            <View style={styles.advancedSection}>
              <Text style={styles.label}>Store ID</Text>
              <TextInput
                style={styles.input}
                value={config.storeId}
                onChangeText={(text) => setConfig({ ...config, storeId: text })}
                placeholder="default"
                placeholderTextColor="#9ca3af"
              />
              <Text style={[styles.label, { marginTop: 12 }]}>Device ID</Text>
              <Text style={styles.deviceIdDisplay}>{deviceId}</Text>
            </View>
          )}

          {/* Buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.resetButton} onPress={resetConfig}>
              <Text style={styles.resetButtonText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.saveButton,
                (!config.posHost || !config.tableId) && styles.saveButtonDisabled,
              ]}
              onPress={saveConfig}
              disabled={!config.posHost || !config.tableId}
            >
              <Text style={styles.saveButtonText}>💾 Save & Start</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>WEB2POS Table Order System</Text>
          <Text style={styles.footerDeviceId}>Device: {deviceId}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // WebView Screen
  const tableOrderUrl = `${config.posHost}/table-order/${config.storeId}/${config.tableId}`;

  return (
    <SafeAreaView style={styles.webviewContainer}>
      <StatusBar backgroundColor="#f59e0b" barStyle="light-content" />
      
      <WebView
        ref={webviewRef}
        source={{ uri: tableOrderUrl }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
        renderLoading={() => (
          <View style={styles.webviewLoading}>
            <ActivityIndicator size="large" color="#f59e0b" />
            <Text style={styles.loadingText}>Loading Table Order...</Text>
          </View>
        )}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          Alert.alert('Error', `Failed to load page: ${nativeEvent.description}`, [
            { text: 'Retry', onPress: () => webviewRef.current?.reload() },
            { text: 'Settings', onPress: openSettings },
          ]);
        }}
      />

      {/* Settings Button (Hidden, long press to show) */}
      <TouchableOpacity
        style={styles.settingsButton}
        onLongPress={openSettings}
        delayLongPress={3000}
      >
        <Text style={styles.settingsButtonText}>⚙️</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#78716c',
  },

  // Setup Screen
  setupContainer: {
    flex: 1,
    backgroundColor: '#fffbeb',
  },
  header: {
    backgroundColor: '#f59e0b',
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerIcon: {
    fontSize: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 12,
    borderRadius: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#fef3c7',
  },
  deviceIdBadge: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  deviceIdText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  
  // Assignment Banner
  assignmentBanner: {
    backgroundColor: '#ecfdf5',
    borderBottomWidth: 1,
    borderBottomColor: '#a7f3d0',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  assignmentText: {
    flex: 1,
    color: '#065f46',
    fontSize: 14,
  },
  assignmentTable: {
    fontWeight: 'bold',
    color: '#047857',
  },
  useAssignedButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 12,
  },
  useAssignedButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  
  // Registration Status
  registrationStatus: {
    paddingVertical: 8,
  },
  registeringText: {
    color: '#6b7280',
    fontSize: 14,
  },
  registeredText: {
    color: '#16a34a',
    fontSize: 14,
  },
  registerErrorText: {
    color: '#dc2626',
    fontSize: 14,
  },
  
  form: {
    flex: 1,
    padding: 24,
    gap: 20,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  inputLarge: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  testButton: {
    backgroundColor: '#e5e7eb',
    paddingHorizontal: 20,
    borderRadius: 12,
    justifyContent: 'center',
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  successText: {
    color: '#16a34a',
    fontSize: 14,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
  },
  hint: {
    color: '#6b7280',
    fontSize: 12,
  },
  advancedToggle: {
    paddingVertical: 8,
  },
  advancedToggleText: {
    color: '#6b7280',
    fontSize: 14,
  },
  advancedSection: {
    backgroundColor: '#f3f4f6',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  deviceIdDisplay: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 14,
    color: '#374151',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  resetButton: {
    backgroundColor: '#e5e7eb',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#f59e0b',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  footer: {
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  footerText: {
    color: '#6b7280',
    fontSize: 12,
  },
  footerDeviceId: {
    color: '#9ca3af',
    fontSize: 10,
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // WebView Screen
  webviewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
  },
  webviewLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
  },
  settingsButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.1,
  },
  settingsButtonText: {
    fontSize: 20,
  },
});

export default App;
