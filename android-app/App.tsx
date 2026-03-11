/**
 * WEB2POS Table Order App
 * Android Native App with WebView
 * 
 * 주요 기능:
 * - 페어링코드 기반 POS 인증 → 토큰 발급
 * - 토큰 암호화 저장 (매장 직원 접근 불가)
 * - Firebase 페어링코드 변경 시 즉시 재페어링
 * - 30초마다 Heartbeat 전송 (토큰 검증 포함)
 * - POS에서 배정한 테이블 자동 수신
 * - WebView로 테이블 오더 페이지 표시
 * - 설정 화면 완전 숨김 (매장 직원 노출 차단)
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

const STORAGE_KEY = '@table_order_config';
const DEVICE_ID_KEY = '@device_unique_id';
const TOKEN_KEY = '@device_auth_token';
const HEARTBEAT_INTERVAL = 30000;
const CONFIG_SYNC_INTERVAL = 10000;
const TOKEN_VERIFY_INTERVAL = 60000;

// XOR 기반 난독화 (AsyncStorage는 평문이므로 최소 보호)
const OBFUSCATION_KEY = 'W2P_TBL_SEC_2026';
function obfuscate(plain: string): string {
  let out = '';
  for (let i = 0; i < plain.length; i++) {
    out += String.fromCharCode(plain.charCodeAt(i) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length));
  }
  return btoa(out);
}
function deobfuscate(encoded: string): string {
  try {
    const decoded = atob(encoded);
    let out = '';
    for (let i = 0; i < decoded.length; i++) {
      out += String.fromCharCode(decoded.charCodeAt(i) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length));
    }
    return out;
  } catch { return ''; }
}

interface Config {
  posHost: string;
  storeId: string;
  tableId: string;
  configured: boolean;
  deviceId?: string;
  autoAssigned?: boolean;
  paired?: boolean;
}

const defaultConfig: Config = {
  posHost: '',
  storeId: 'default',
  tableId: '',
  configured: false,
  autoAssigned: false,
  paired: false,
};

const generateUUID = (): string => {
  return 'TABLET-' + 'xxxxxxxx'.replace(/[x]/g, () => {
    return Math.floor(Math.random() * 16).toString(16).toUpperCase();
  });
};

const App = () => {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [deviceId, setDeviceId] = useState<string>('');
  const [authToken, setAuthToken] = useState<string>('');
  const [showSetup, setShowSetup] = useState(true);
  const [showPairing, setShowPairing] = useState(true);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [pairingCode, setPairingCode] = useState('');
  const [posHostInput, setPosHostInput] = useState('');
  const [pairingStatus, setPairingStatus] = useState<'idle' | 'pairing' | 'success' | 'error'>('idle');
  const [pairingError, setPairingError] = useState('');
  const [assignedFromPOS, setAssignedFromPOS] = useState<string | null>(null);
  const [tokenRevoked, setTokenRevoked] = useState(false);

  const webviewRef = useRef<WebView>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const configSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const tokenVerifyIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const appStateRef = useRef(AppState.currentState);
  // 설정 화면 숨김: 5초 롱프레스 + 특정 영역 5회 탭
  const hiddenTapCountRef = useRef(0);
  const hiddenTapTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ==================== 토큰 관리 ====================
  const saveToken = async (token: string) => {
    const encrypted = obfuscate(token);
    await AsyncStorage.setItem(TOKEN_KEY, encrypted);
    setAuthToken(token);
  };

  const loadToken = async (): Promise<string> => {
    try {
      const encrypted = await AsyncStorage.getItem(TOKEN_KEY);
      if (!encrypted) return '';
      return deobfuscate(encrypted);
    } catch { return ''; }
  };

  const clearToken = async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setAuthToken('');
  };

  const getAuthHeaders = (token?: string): Record<string, string> => {
    const t = token || authToken;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (t) headers['Authorization'] = `Bearer ${t}`;
    return headers;
  };

  // ==================== 디바이스 ID 관리 ====================
  const getOrCreateDeviceId = useCallback(async (): Promise<string> => {
    try {
      let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = generateUUID();
        await AsyncStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch (e) {
      return generateUUID();
    }
  }, []);

  // ==================== 페어링 ====================
  const normalizeHost = (input: string): string => {
    let h = input.trim();
    if (h && !h.startsWith('http://') && !h.startsWith('https://')) {
      h = 'http://' + h;
    }
    return h.replace(/\/+$/, '');
  };

  const doPairing = async () => {
    const host = normalizeHost(posHostInput);
    const code = pairingCode.trim();

    if (!host) { setPairingError('Enter POS server address'); return; }
    if (!code) { setPairingError('Enter pairing code'); return; }

    setPairingStatus('pairing');
    setPairingError('');

    try {
      const response = await fetch(`${host}/api/devices/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          pairing_code: code,
          device_name: `Table Tablet ${deviceId.slice(-4)}`,
          device_type: 'table_order',
          app_version: '1.0.0',
          os_version: Platform.OS + ' ' + Platform.Version,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setPairingStatus('error');
        setPairingError(data.error || 'Pairing failed');
        return;
      }

      await saveToken(data.token);

      const newConfig: Config = {
        posHost: host,
        storeId: 'default',
        tableId: '',
        configured: false,
        deviceId,
        paired: true,
        autoAssigned: false,
      };

      if (data.device?.assigned_table_id) {
        newConfig.tableId = data.device.assigned_table_id;
        newConfig.configured = true;
        newConfig.autoAssigned = true;
      }

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
      setConfig(newConfig);
      setPairingStatus('success');
      setShowPairing(false);
      setTokenRevoked(false);

      startHeartbeat(host, deviceId, data.token);
      startConfigSync(host, deviceId, data.token);
      startTokenVerify(host, data.token);

      if (newConfig.configured) {
        setShowSetup(false);
      }
    } catch (e: any) {
      setPairingStatus('error');
      setPairingError(e.message || 'Connection failed');
    }
  };

  // ==================== 토큰 검증 ====================
  const verifyTokenOnServer = useCallback(async (host: string, token: string): Promise<boolean> => {
    if (!host || !token) return false;
    try {
      const response = await fetch(`${host}/api/devices/verify-token`, {
        method: 'POST',
        headers: getAuthHeaders(token),
      });
      const data = await response.json();
      if (!data.success && data.revoked) {
        console.log('[Token] Revoked by server — forcing re-pair');
        setTokenRevoked(true);
        stopAllIntervals();
        await clearToken();
        setShowPairing(true);
        setShowSetup(true);
        setPairingCode('');
        setPairingStatus('idle');
        setPairingError('Pairing code changed. Please enter new code.');
        return false;
      }
      return data.success;
    } catch { return false; }
  }, []);

  const startTokenVerify = useCallback((host: string, token: string) => {
    if (tokenVerifyIntervalRef.current) clearInterval(tokenVerifyIntervalRef.current);
    tokenVerifyIntervalRef.current = setInterval(() => {
      verifyTokenOnServer(host, token);
    }, TOKEN_VERIFY_INTERVAL);
  }, [verifyTokenOnServer]);

  // ==================== POS 등록 및 Heartbeat ====================
  const registerDevice = useCallback(async (host: string, devId: string, token: string) => {
    if (!host || !devId) return;
    try {
      const response = await fetch(`${host}/api/devices/register`, {
        method: 'POST',
        headers: getAuthHeaders(token),
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
        if (data.device?.assigned_table_id) {
          setAssignedFromPOS(data.device.assigned_table_id);
        }
        return data;
      } else if (response.status === 401) {
        const data = await response.json();
        if (data.revoked) {
          setTokenRevoked(true);
          stopAllIntervals();
          await clearToken();
          setShowPairing(true);
          setShowSetup(true);
          setPairingError('Token revoked. Please re-pair.');
        }
      }
    } catch (e) {}
    return null;
  }, []);

  const sendHeartbeat = useCallback(async (host: string, devId: string, token: string) => {
    if (!host || !devId) return;
    try {
      const response = await fetch(`${host}/api/devices/heartbeat`, {
        method: 'POST',
        headers: getAuthHeaders(token),
        body: JSON.stringify({
          device_id: devId,
          battery_level: null,
          is_charging: false,
          app_version: '1.0.0',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.assigned_table_id && data.assigned_table_id !== config.tableId) {
          setAssignedFromPOS(data.assigned_table_id);
        }
      } else if (response.status === 401) {
        const data = await response.json();
        if (data.revoked) {
          setTokenRevoked(true);
          stopAllIntervals();
          await clearToken();
          setShowPairing(true);
          setShowSetup(true);
        }
      }
    } catch (e) {}
  }, [config.tableId]);

  const syncConfigFromPOS = useCallback(async (host: string, devId: string, token: string) => {
    if (!host || !devId) return;
    try {
      const response = await fetch(`${host}/api/devices/${devId}/config`, {
        headers: getAuthHeaders(token),
      });

      if (response.ok) {
        const data = await response.json();
        const posConfig = data.config;

        if (posConfig.assigned_table_id && posConfig.status === 'active') {
          if (posConfig.assigned_table_id !== config.tableId || !config.configured) {
            const newConfig: Config = {
              ...config,
              posHost: host,
              tableId: posConfig.assigned_table_id,
              storeId: posConfig.store_id || 'default',
              configured: true,
              deviceId: devId,
              autoAssigned: true,
              paired: true,
            };
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
            setConfig(newConfig);
            setShowSetup(false);
          }
        }
      } else if (response.status === 401) {
        const data = await response.json();
        if (data.revoked) {
          setTokenRevoked(true);
          stopAllIntervals();
          await clearToken();
          setShowPairing(true);
          setShowSetup(true);
        }
      }
    } catch (e) {}
  }, [config]);

  const startHeartbeat = useCallback((host: string, devId: string, token: string) => {
    if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    sendHeartbeat(host, devId, token);
    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeat(host, devId, token);
    }, HEARTBEAT_INTERVAL);
  }, [sendHeartbeat]);

  const startConfigSync = useCallback((host: string, devId: string, token: string) => {
    if (configSyncIntervalRef.current) clearInterval(configSyncIntervalRef.current);
    configSyncIntervalRef.current = setInterval(() => {
      syncConfigFromPOS(host, devId, token);
    }, CONFIG_SYNC_INTERVAL);
  }, [syncConfigFromPOS]);

  const stopAllIntervals = useCallback(() => {
    if (heartbeatIntervalRef.current) { clearInterval(heartbeatIntervalRef.current); heartbeatIntervalRef.current = null; }
    if (configSyncIntervalRef.current) { clearInterval(configSyncIntervalRef.current); configSyncIntervalRef.current = null; }
    if (tokenVerifyIntervalRef.current) { clearInterval(tokenVerifyIntervalRef.current); tokenVerifyIntervalRef.current = null; }
  }, []);

  // ==================== 앱 생명주기 관리 ====================
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        if (config.posHost && deviceId && authToken) {
          sendHeartbeat(config.posHost, deviceId, authToken);
          syncConfigFromPOS(config.posHost, deviceId, authToken);
          verifyTokenOnServer(config.posHost, authToken);
        }
      }
      appStateRef.current = nextAppState;
    });
    return () => { subscription.remove(); };
  }, [config.posHost, deviceId, authToken, sendHeartbeat, syncConfigFromPOS, verifyTokenOnServer]);

  // ==================== 초기화 ====================
  useEffect(() => {
    const initialize = async () => {
      try {
        const devId = await getOrCreateDeviceId();
        setDeviceId(devId);

        const token = await loadToken();
        const savedConfig = await AsyncStorage.getItem(STORAGE_KEY);

        if (savedConfig && token) {
          const parsed = JSON.parse(savedConfig);
          setConfig({ ...parsed, deviceId: devId });
          setPosHostInput(parsed.posHost || '');
          setAuthToken(token);

          const valid = await verifyTokenOnServer(parsed.posHost, token);
          if (!valid) {
            setShowPairing(true);
            setShowSetup(true);
            setPairingError('Session expired. Please re-enter pairing code.');
          } else {
            setShowPairing(false);

            if (parsed.configured && parsed.posHost && parsed.tableId) {
              await registerDevice(parsed.posHost, devId, token);
              startHeartbeat(parsed.posHost, devId, token);
              startConfigSync(parsed.posHost, devId, token);
              startTokenVerify(parsed.posHost, token);
              setShowSetup(false);
            } else if (parsed.posHost) {
              await registerDevice(parsed.posHost, devId, token);
              startConfigSync(parsed.posHost, devId, token);
              startTokenVerify(parsed.posHost, token);
            }
          }
        } else if (savedConfig) {
          const parsed = JSON.parse(savedConfig);
          setPosHostInput(parsed.posHost || '');
          setShowPairing(true);
          setShowSetup(true);
        } else {
          setShowPairing(true);
          setShowSetup(true);
        }
      } catch (e) {
        console.error('[Init] Failed:', e);
      } finally {
        setLoading(false);
      }
    };

    initialize();
    return () => { stopAllIntervals(); };
  }, []);

  // ==================== 이벤트 핸들러 ====================
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

  // POS에서 배정받은 테이블로 자동 시작
  const useAssignedTable = async () => {
    if (!assignedFromPOS || !config.posHost) return;
    const configToSave: Config = {
      ...config,
      tableId: assignedFromPOS,
      configured: true,
      deviceId,
      autoAssigned: true,
      paired: true,
    };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(configToSave));
      setConfig(configToSave);
      startHeartbeat(config.posHost, deviceId, authToken);
      setShowSetup(false);
      setAssignedFromPOS(null);
    } catch (e) {
      Alert.alert('Error', 'Failed to apply configuration');
    }
  };

  // 태블릿에서 직접 테이블 번호 입력 후 시작
  const [tableInput, setTableInput] = useState('');
  const [tableAssigning, setTableAssigning] = useState(false);
  const [tableError, setTableError] = useState('');

  const assignTableFromTablet = async (forceReplace = false) => {
    const tid = tableInput.trim().toUpperCase();
    if (!tid) { setTableError('Enter a table number'); return; }
    if (!config.posHost || !deviceId) { setTableError('Not paired yet'); return; }

    setTableAssigning(true);
    setTableError('');

    try {
      const response = await fetch(`${config.posHost}/api/devices/${deviceId}/assign`, {
        method: 'PUT',
        headers: getAuthHeaders(authToken),
        body: JSON.stringify({ table_id: tid, table_label: tid, force_replace: forceReplace }),
      });

      const data = await response.json();

      if (response.status === 409 && data.conflict && data.existing_device && !forceReplace) {
        setTableAssigning(false);
        const oldName = data.existing_device.device_name || data.existing_device.device_id;
        Alert.alert(
          'Table Already Assigned',
          `${tid} is assigned to "${oldName}".\nReplace with this device?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Replace', style: 'destructive', onPress: () => assignTableFromTablet(true) },
          ]
        );
        return;
      }

      if (!response.ok || !data.success) {
        setTableError(data.error || 'Failed to assign table');
        setTableAssigning(false);
        return;
      }

      // 서버가 반환한 실제 element_id를 사용 (태블릿에서 "T1" 입력 → 서버가 실제 ID로 변환)
      const realTableId = data.device?.assigned_table_id || tid;

      const configToSave: Config = {
        ...config,
        tableId: realTableId,
        configured: true,
        deviceId,
        autoAssigned: false,
        paired: true,
      };

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(configToSave));
      setConfig(configToSave);
      startHeartbeat(config.posHost, deviceId, authToken);
      setShowSetup(false);
    } catch (e: any) {
      setTableError(e.message || 'Connection error');
    } finally {
      setTableAssigning(false);
    }
  };

  // 설정 화면 접근 (숨겨진 영역 5회 연속 탭 + 5초 내)
  const handleHiddenTap = () => {
    hiddenTapCountRef.current += 1;
    if (hiddenTapTimerRef.current) clearTimeout(hiddenTapTimerRef.current);

    if (hiddenTapCountRef.current >= 5) {
      hiddenTapCountRef.current = 0;
      Alert.alert(
        'Device Settings',
        'Choose an action:',
        [
          {
            text: 'Change Table',
            onPress: () => {
              setShowSetup(true);
              setShowPairing(false);
              setTableInput('');
              setTableError('');
              setConfig(prev => ({ ...prev, configured: false }));
            },
          },
          {
            text: 'Full Reset',
            style: 'destructive',
            onPress: () => {
              setShowSetup(true);
              setShowPairing(true);
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    } else {
      hiddenTapTimerRef.current = setTimeout(() => {
        hiddenTapCountRef.current = 0;
      }, 5000);
    }
  };

  // ==================== 렌더링 ====================
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // Pairing Screen
  if (showSetup && showPairing) {
    return (
      <SafeAreaView style={styles.setupContainer}>
        <StatusBar backgroundColor="#0f172a" barStyle="light-content" />

        <View style={styles.header}>
          <Text style={styles.headerIcon}>🔗</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Table Order Setup</Text>
            <Text style={styles.headerSubtitle}>Enter POS address and pairing code</Text>
          </View>
        </View>

        <View style={styles.form}>
          {pairingError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>⚠️ {pairingError}</Text>
            </View>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>📡 POS Server Address</Text>
            <TextInput
              style={styles.input}
              value={posHostInput}
              onChangeText={setPosHostInput}
              placeholder="http://192.168.1.100:3177"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>🔑 Pairing Code</Text>
            <TextInput
              style={styles.inputLarge}
              value={pairingCode}
              onChangeText={(t) => setPairingCode(t.slice(0, 10))}
              placeholder="Enter pairing code"
              placeholderTextColor="#64748b"
              secureTextEntry
              maxLength={10}
              autoCapitalize="none"
            />
            <Text style={styles.hint}>Provided by your distributor (max 10 characters)</Text>
          </View>

          {pairingStatus === 'success' && (
            <View style={styles.successBanner}>
              <Text style={styles.successBannerText}>✅ Paired successfully!</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.pairButton, pairingStatus === 'pairing' && styles.pairButtonDisabled]}
            onPress={doPairing}
            disabled={pairingStatus === 'pairing'}
          >
            {pairingStatus === 'pairing' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.pairButtonText}>🔗 Pair Device</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>WEB2POS Table Order System</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Table number input (after pairing)
  if (showSetup && !showPairing && config.paired && !config.configured) {
    return (
      <SafeAreaView style={styles.setupContainer}>
        <StatusBar backgroundColor="#0f172a" barStyle="light-content" />

        <View style={styles.header}>
          <Text style={styles.headerIcon}>✅</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Paired Successfully</Text>
            <Text style={styles.headerSubtitle}>Enter the table number for this tablet</Text>
          </View>
        </View>

        {assignedFromPOS && (
          <View style={styles.assignmentBanner}>
            <Text style={styles.assignmentText}>
              ✨ Table <Text style={styles.assignmentTable}>{assignedFromPOS}</Text> assigned from POS
            </Text>
            <TouchableOpacity style={styles.useAssignedButton} onPress={useAssignedTable}>
              <Text style={styles.useAssignedButtonText}>Use This</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.form}>
          {tableError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>⚠️ {tableError}</Text>
            </View>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={styles.label}># Table Number</Text>
            <TextInput
              style={styles.tableNumberInput}
              value={tableInput}
              onChangeText={(t) => setTableInput(t.toUpperCase())}
              placeholder="T1, T2, A1, B3..."
              placeholderTextColor="#64748b"
              autoCapitalize="characters"
              autoFocus
            />
            <Text style={styles.hint}>Enter the table number exactly as shown on the table map</Text>
          </View>

          <TouchableOpacity
            style={[styles.pairButton, (tableAssigning || !tableInput.trim()) && styles.pairButtonDisabled]}
            onPress={() => assignTableFromTablet(false)}
            disabled={tableAssigning || !tableInput.trim()}
          >
            {tableAssigning ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.pairButtonText}>▶ Start Table Order</Text>
            )}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={styles.orHint}>
            You can also assign this tablet from POS → Table Devices
          </Text>
          <Text style={styles.deviceIdSmall}>Device: {deviceId}</Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>WEB2POS Table Order System</Text>
        </View>
      </SafeAreaView>
    );
  }

  // WebView Screen
  const safeHost = config.posHost && !config.posHost.startsWith('http') ? `http://${config.posHost}` : config.posHost;
  const tableOrderUrl = `${safeHost}/table-order/${config.storeId}/${config.tableId}`;

  return (
    <SafeAreaView style={styles.webviewContainer}>
      <StatusBar backgroundColor="#000" barStyle="light-content" />

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
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text style={styles.loadingText}>Loading Table Order...</Text>
          </View>
        )}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          Alert.alert('Error loading page', `URL: ${tableOrderUrl}\n\n${nativeEvent.description}`, [
            { text: 'Retry', onPress: () => webviewRef.current?.reload() },
          ]);
        }}
      />

      {/* 숨겨진 설정 접근: 우상단 투명 영역 5회 연속 탭 */}
      <TouchableOpacity
        style={styles.hiddenSettingsArea}
        onPress={handleHiddenTap}
        activeOpacity={1}
      >
        <View />
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#94a3b8',
  },
  setupContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    backgroundColor: '#1e293b',
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerIcon: {
    fontSize: 36,
    backgroundColor: 'rgba(59,130,246,0.2)',
    padding: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f1f5f9',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
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
    color: '#cbd5e1',
  },
  input: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#f1f5f9',
  },
  inputLarge: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 20,
    fontWeight: '600',
    color: '#f1f5f9',
    letterSpacing: 2,
  },
  hint: {
    color: '#64748b',
    fontSize: 12,
  },
  pairButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  pairButtonDisabled: {
    backgroundColor: '#334155',
  },
  pairButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  errorBanner: {
    backgroundColor: '#7f1d1d',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#991b1b',
  },
  errorBannerText: {
    color: '#fca5a5',
    fontSize: 14,
  },
  successBanner: {
    backgroundColor: '#14532d',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#166534',
  },
  successBannerText: {
    color: '#86efac',
    fontSize: 14,
  },
  assignmentBanner: {
    backgroundColor: '#14532d',
    borderBottomWidth: 1,
    borderBottomColor: '#166534',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  assignmentText: {
    flex: 1,
    color: '#86efac',
    fontSize: 14,
  },
  assignmentTable: {
    fontWeight: 'bold',
    color: '#4ade80',
  },
  useAssignedButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginLeft: 12,
  },
  useAssignedButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  tableNumberInput: {
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#3b82f6',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 18,
    fontSize: 28,
    fontWeight: 'bold',
    color: '#f1f5f9',
    textAlign: 'center',
    letterSpacing: 3,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#334155',
  },
  dividerText: {
    paddingHorizontal: 16,
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
  },
  orHint: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
  },
  deviceIdSmall: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    color: '#475569',
    textAlign: 'center',
    marginTop: 4,
  },
  deviceIdDisplay: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    color: '#475569',
    backgroundColor: '#1e293b',
    padding: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  footer: {
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  footerText: {
    color: '#475569',
    fontSize: 12,
  },
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
    backgroundColor: '#0f172a',
  },
  hiddenSettingsArea: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 50,
    height: 50,
    opacity: 0,
  },
});

export default App;
