import React, { useState, useEffect } from 'react';
import { API_URL } from '../config/constants';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar, Pie } from 'react-chartjs-2';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

interface ReservationSettings {
  minimum_guests: number;
  maximum_guests: number;
  minimum_time_in_advance: number; // hours
  maximum_time_in_advance: number; // days
  hold_table_for_late_guests: number; // minutes
  max_reservation_table: number; // new field
  reservation_interval: number; // new field
}

const TableReservationSettingsPage = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [reservationSettings, setReservationSettings] = useState<ReservationSettings>({
    minimum_guests: 1,
    maximum_guests: 10,
    minimum_time_in_advance: 1,
    maximum_time_in_advance: 30,
    hold_table_for_late_guests: 15,
    max_reservation_table: 10,
    reservation_interval: 30
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [policy, setPolicy] = useState<any>({ peak_start: '18:00', peak_end: '20:00', peak_max_per_slot: 3, normal_max_per_slot: 5, dwell_minutes: 90 });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch reservation settings (if exists)
      try {
        const settingsResponse = await fetch(`${API_URL}/admin-settings/reservation-settings`);
        if (settingsResponse.ok) {
          const settingsData = await settingsResponse.json();
          if (settingsData.reservation_settings) {
            setReservationSettings(settingsData.reservation_settings);
          }
        }
      } catch (error) {
        console.log('No existing reservation settings found, using defaults');
      }

      // Fetch reservation policy
      try {
        const sres = await fetch(`${API_URL}/reservation-settings/system-settings`);
        if (sres.ok) {
          const js = await sres.json();
          if ((js as any)?.policy) setPolicy((js as any).policy);
        }
      } catch {}

    } catch (error) {
      setError('Failed to load settings');
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      // Save reservation settings
      const settingsResponse = await fetch(`${API_URL}/admin-settings/reservation-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reservation_settings: reservationSettings }),
      });

      if (!settingsResponse.ok) {
        throw new Error('Failed to save reservation settings');
      }

      setSuccess('Settings saved successfully!');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save settings');
      console.error('Error saving settings:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Table Reservation Management</h1>
        <p className="text-gray-600">Manage reservation settings and view reports</p>
        {error && (
          <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
            {success}
          </div>
        )}
      </div>

      {/* Main Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'dashboard'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Settings
            </button>
            <button
              onClick={() => setActiveTab('no-show')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'no-show'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              No-Show History
            </button>
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'settings' && (
        <div className="max-w-2xl">
          {/* Reservation Settings */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Reservation Rules</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Minimum guests:
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={reservationSettings.minimum_guests}
                    onChange={(e) => setReservationSettings(prev => ({
                      ...prev,
                      minimum_guests: parseInt(e.target.value) || 1
                    }))}
                    className="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="1~300"
                  />
                  <span className="absolute right-3 top-2 text-gray-500 text-sm">guests</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">1~10: 1 unit, 11~100: 5 units, 101~300: 20 units recommended</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Maximum guests:
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={reservationSettings.maximum_guests}
                    onChange={(e) => setReservationSettings(prev => ({
                      ...prev,
                      maximum_guests: parseInt(e.target.value) || 1
                    }))}
                    className="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="1~300"
                  />
                  <span className="absolute right-3 top-2 text-gray-500 text-sm">guests</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">1~10: 1 unit, 11~100: 5 units, 101~300: 20 units recommended</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Minimum time in advance (hours):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={reservationSettings.minimum_time_in_advance}
                    onChange={(e) => setReservationSettings(prev => ({
                      ...prev,
                      minimum_time_in_advance: parseInt(e.target.value) || 1
                    }))}
                    className="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="1~24"
                  />
                  <span className="absolute right-3 top-2 text-gray-500 text-sm">hours</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">1~24 hours</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Maximum time in advance (days):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={reservationSettings.maximum_time_in_advance}
                    onChange={(e) => setReservationSettings(prev => ({
                      ...prev,
                      maximum_time_in_advance: parseInt(e.target.value) || 1
                    }))}
                    className="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="1~365"
                  />
                  <span className="absolute right-3 top-2 text-gray-500 text-sm">days</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">1~365 days (1, 7, 10, 15, 30, 60, 90, 180, 365 days recommended)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  When guests are late, hold table for (minutes):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="15"
                    max="120"
                    step="15"
                    value={reservationSettings.hold_table_for_late_guests}
                    onChange={(e) => setReservationSettings(prev => ({
                      ...prev,
                      hold_table_for_late_guests: parseInt(e.target.value) || 15
                    }))}
                    className="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="15~120"
                  />
                  <span className="absolute right-3 top-2 text-gray-500 text-sm">minutes</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">15~120 minutes (15-minute intervals recommended)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Reservation Table:
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={reservationSettings.max_reservation_table}
                    onChange={(e) => setReservationSettings(prev => ({
                      ...prev,
                      max_reservation_table: parseInt(e.target.value) || 1
                    }))}
                    className="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="1~100"
                  />
                  <span className="absolute right-3 top-2 text-gray-500 text-sm">tables</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">1~100 tables</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reservation Interval:
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="30"
                    max="360"
                    step="30"
                    value={reservationSettings.reservation_interval}
                    onChange={(e) => setReservationSettings(prev => ({
                      ...prev,
                      reservation_interval: parseInt(e.target.value) || 30
                    }))}
                    className="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="30~360"
                  />
                  <span className="absolute right-3 top-2 text-gray-500 text-sm">minutes</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">30 minutes~6 hours (30-minute intervals recommended)</p>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          {/* Capacity Policy */}
          <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Capacity Policy</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Peak start (HH:MM)</label>
                <input className="w-full border rounded px-3 py-2" value={(policy as any)?.peak_start || ''} onChange={(e) => setPolicy((p:any) => ({ ...(p||{}), peak_start: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Peak end (HH:MM)</label>
                <input className="w-full border rounded px-3 py-2" value={(policy as any)?.peak_end || ''} onChange={(e) => setPolicy((p:any) => ({ ...(p||{}), peak_end: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max per slot (peak)</label>
                <input className="w-full border rounded px-3 py-2" type="number" value={(policy as any)?.peak_max_per_slot || 0} onChange={(e) => setPolicy((p:any) => ({ ...(p||{}), peak_max_per_slot: Number(e.target.value||0) }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max per slot (normal)</label>
                <input className="w-full border rounded px-3 py-2" type="number" value={(policy as any)?.normal_max_per_slot || 0} onChange={(e) => setPolicy((p:any) => ({ ...(p||{}), normal_max_per_slot: Number(e.target.value||0) }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dwell time (minutes)</label>
                <input className="w-full border rounded px-3 py-2" type="number" value={(policy as any)?.dwell_minutes || 0} onChange={(e) => setPolicy((p:any) => ({ ...(p||{}), dwell_minutes: Number(e.target.value||0) }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Online quota (%)</label>
                <input className="w-full border rounded px-3 py-2" type="number" value={(policy as any)?.online_quota_pct || 0} onChange={(e) => setPolicy((p:any) => ({ ...(p||{}), online_quota_pct: Number(e.target.value||0) }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone quota (%)</label>
                <input className="w-full border rounded px-3 py-2" type="number" value={(policy as any)?.phone_quota_pct || 0} onChange={(e) => setPolicy((p:any) => ({ ...(p||{}), phone_quota_pct: Number(e.target.value||0) }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Walk-in quota (%)</label>
                <input className="w-full border rounded px-3 py-2" type="number" value={(policy as any)?.walkin_quota_pct || 0} onChange={(e) => setPolicy((p:any) => ({ ...(p||{}), walkin_quota_pct: Number(e.target.value||0) }))} />
              </div>
            </div>
            <div className="mt-4">
              <button
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_URL}/reservation-settings/policy`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(policy || {}) });
                    if (!res.ok) throw new Error('Failed to save policy');
                    setSuccess('Policy saved');
                  } catch (e:any) {
                    setError(String(e?.message||'Failed to save policy'));
                  }
                }}
              >
                Save Policy
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'dashboard' && (
        <ReservationDashboard />
      )}

      {activeTab === 'no-show' && (
        <NoShowHistory />
      )}
    </div>
  );
};

// Reservation Dashboard Component
const ReservationDashboard = () => {
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const [selectedRange, setSelectedRange] = useState('today');
  const [showCustomRange, setShowCustomRange] = useState(false);

  useEffect(() => {
    fetchReservations();
  }, [dateRange]);

  // Handle date range selection
  const handleRangeChange = (range: string) => {
    setSelectedRange(range);
    const today = new Date();
    let startDate = new Date();
    let endDate = new Date();

    switch (range) {
      case 'today':
        startDate = today;
        endDate = today;
        setShowCustomRange(false);
        break;
      case 'yesterday':
        startDate.setDate(today.getDate() - 1);
        endDate.setDate(today.getDate() - 1);
        setShowCustomRange(false);
        break;
      case 'last7days':
        startDate.setDate(today.getDate() - 6);
        endDate = today;
        setShowCustomRange(false);
        break;
      case 'last30days':
        startDate.setDate(today.getDate() - 29);
        endDate = today;
        setShowCustomRange(false);
        break;
      case 'custom':
        setShowCustomRange(true);
        // Custom 선택 시 현재 날짜로 초기화
        setDateRange({
          startDate: today.toISOString().split('T')[0],
          endDate: today.toISOString().split('T')[0]
        });
        return;
      default:
        startDate = today;
        endDate = today;
        setShowCustomRange(false);
    }

    setDateRange({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    });
  };

  const fetchReservations = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/reservations?start_date=${dateRange.startDate}&end_date=${dateRange.endDate}`);
      if (response.ok) {
        const data = await response.json();
        setReservations(data);
      }
    } catch (error) {
      console.error('Error fetching reservations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRebook = async (reservationId: number) => {
    try {
      const response = await fetch(`${API_URL}/reservations/${reservationId}/rebook`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        // Refresh reservations list
        fetchReservations();
      } else {
        const errorData = await response.json();
        alert(`복구 실패: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error rebooking reservation:', error);
      alert('예약 복구 중 오류가 발생했습니다.');
    }
  };

  const handleCancel = async (reservationId: number) => {
    try {
      const response = await fetch(`${API_URL}/reservations/${reservationId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'cancelled' })
      });

      if (response.ok) {
        // Refresh reservations list
        fetchReservations();
      } else {
        const errorData = await response.json();
        alert(`취소 실패: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error cancelling reservation:', error);
      alert('예약 취소 중 오류가 발생했습니다.');
    }
  };

  // Calculate statistics
  const calculateStats = () => {
    const total = reservations.length;
    const confirmed = reservations.filter((res: any) => res.status === 'confirmed').length;
    const pending = reservations.filter((res: any) => res.status === 'pending').length;
    const cancelled = reservations.filter((res: any) => res.status === 'cancelled').length;
    const completed = reservations.filter((res: any) => res.status === 'completed').length;
    const noShow = reservations.filter((res: any) => res.status === 'cancelled').length; // 노쇼는 취소된 예약으로 간주
    const totalGuests = reservations.reduce((sum: number, res: any) => sum + (res.party_size || 0), 0);
    const avgPartySize = total > 0 ? (totalGuests / total).toFixed(1) : 0;

    return { total, confirmed, pending, cancelled, completed, noShow, totalGuests, avgPartySize };
  };

  // Get cancelled reservations for separate display
  const cancelledReservations = reservations.filter((res: any) => res.status === 'cancelled');
  const activeReservations = reservations.filter((res: any) => res.status !== 'cancelled');

  // Calculate time slot distribution
  const calculateTimeSlotStats = () => {
    const timeSlots: { [key: string]: number } = {};
    reservations.forEach((res: any) => {
      const time = res.reservation_time;
      timeSlots[time] = (timeSlots[time] || 0) + 1;
    });
    return Object.entries(timeSlots)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 5); // Top 5 time slots
  };

  // Calculate daily trends
  const calculateDailyTrends = () => {
    const dailyStats: { [key: string]: { count: number; guests: number } } = {};
    reservations.forEach((res: any) => {
      const date = res.reservation_date;
      if (!dailyStats[date]) {
        dailyStats[date] = { count: 0, guests: 0 };
      }
      dailyStats[date].count += 1;
      dailyStats[date].guests += res.party_size || 0;
    });
    return Object.entries(dailyStats)
      .sort(([a], [b]) => a.localeCompare(b));
  };

  // Calculate party size distribution
  const calculatePartySizeStats = () => {
    const partySizes: { [key: number]: number } = {};
    reservations.forEach((res: any) => {
      const size = res.party_size;
      partySizes[size] = (partySizes[size] || 0) + 1;
    });
    return Object.entries(partySizes)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .slice(0, 6); // Top 6 party sizes
  };

  const stats = calculateStats();
  const timeSlotStats = calculateTimeSlotStats();
  const dailyTrends = calculateDailyTrends();
  const partySizeStats = calculatePartySizeStats();

  // Chart data preparation
  const prepareDailyTrendChartData = () => {
    const labels = dailyTrends.map(([date]) => date);
    const data = dailyTrends.map(([, data]) => data.count);
    
    return {
      labels,
      datasets: [
        {
          label: 'Reservations',
          data,
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.1,
        },
      ],
    };
  };

  const prepareTimeSlotChartData = () => {
    const labels = timeSlotStats.map(([time]) => time);
    const data = timeSlotStats.map(([, count]) => count);
    
    return {
      labels,
      datasets: [
        {
          label: 'Reservations',
          data,
          backgroundColor: 'rgba(99, 102, 241, 0.8)',
          borderColor: 'rgb(99, 102, 241)',
          borderWidth: 1,
        },
      ],
    };
  };

  const prepareStatusChartData = () => {
    return {
      labels: ['Confirmed', 'Pending', 'No-Show', 'Completed'],
      datasets: [
        {
          data: [stats.confirmed, stats.pending, stats.noShow, stats.completed],
          backgroundColor: [
            'rgba(34, 197, 94, 0.8)',
            'rgba(234, 179, 8, 0.8)',
            'rgba(239, 68, 68, 0.8)',
            'rgba(59, 130, 246, 0.8)',
          ],
          borderColor: [
            'rgb(34, 197, 94)',
            'rgb(234, 179, 8)',
            'rgb(239, 68, 68)',
            'rgb(59, 130, 246)',
          ],
          borderWidth: 2,
        },
      ],
    };
  };

  const exportToCSV = () => {
    const headers = ['Reservation Number', 'Customer Name', 'Phone', 'Date', 'Time', 'Party Size', 'Status'];
    const csvContent = [
      headers.join(','),
      ...reservations.map((res: any) => [
        res.reservation_number,
        res.customer_name,
        res.phone_number,
        res.reservation_date,
        res.reservation_time,
        res.party_size,
        res.status
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reservations_${dateRange.startDate}_${dateRange.endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportToExcel = () => {
    // Prepare data for Excel
    const excelData = reservations.map((res: any) => ({
      'Reservation Number': res.reservation_number,
      'Customer Name': res.customer_name,
      'Phone': res.phone_number,
      'Date': res.reservation_date,
      'Time': res.reservation_time,
      'Party Size': res.party_size,
      'Status': res.status
    }));

    // Create workbook and worksheet
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reservations');

    // Auto-size columns
    const colWidths = [
      { wch: 15 }, // Reservation Number
      { wch: 20 }, // Customer Name
      { wch: 15 }, // Phone
      { wch: 12 }, // Date
      { wch: 10 }, // Time
      { wch: 10 }, // Party Size
      { wch: 12 }  // Status
    ];
    ws['!cols'] = colWidths;

    // Save file
    XLSX.writeFile(wb, `reservations_${dateRange.startDate}_${dateRange.endDate}.xlsx`);
  };

  const exportToPDF = async () => {
    // Create PDF content
    const pdf = new jsPDF();
    
    // Add title
    pdf.setFontSize(16);
    pdf.text('Reservation Report', 20, 20);
    pdf.setFontSize(12);
    pdf.text(`Date Range: ${dateRange.startDate} to ${dateRange.endDate}`, 20, 30);
    pdf.text(`Total Reservations: ${reservations.length}`, 20, 40);

    // Add table headers
    const headers = ['No.', 'Customer', 'Phone', 'Date', 'Time', 'Size', 'Status'];
    const startY = 60;
    let currentY = startY;

    // Add header row
    pdf.setFontSize(10);
    pdf.setFillColor(240, 240, 240);
    pdf.rect(20, currentY - 5, 170, 8, 'F');
    headers.forEach((header, index) => {
      const x = 20 + (index * 24);
      pdf.text(header, x, currentY);
    });

    // Add data rows
    currentY += 10;
    reservations.slice(0, 20).forEach((res: any, index: number) => {
      if (currentY > 270) {
        pdf.addPage();
        currentY = 20;
      }

      const rowData = [
        (index + 1).toString(),
        res.customer_name?.substring(0, 8) || '',
        res.phone_number?.substring(0, 8) || '',
        res.reservation_date || '',
        res.reservation_time || '',
        res.party_size?.toString() || '',
        res.status || ''
      ];

      rowData.forEach((cell, cellIndex) => {
        const x = 20 + (cellIndex * 24);
        pdf.text(cell, x, currentY);
      });

      currentY += 8;
    });

    // Add summary
    if (reservations.length > 20) {
      pdf.addPage();
      pdf.setFontSize(12);
      pdf.text('Summary Statistics', 20, 20);
      pdf.setFontSize(10);
      pdf.text(`Total Reservations: ${stats.total}`, 20, 35);
      pdf.text(`Confirmed: ${stats.confirmed}`, 20, 45);
      pdf.text(`Pending: ${stats.pending}`, 20, 55);
      pdf.text(`Completed: ${stats.completed}`, 20, 65);
      pdf.text(`No-Show: ${stats.noShow}`, 20, 75);
      pdf.text(`Average Party Size: ${stats.avgPartySize}`, 20, 85);
    }

    pdf.save(`reservations_${dateRange.startDate}_${dateRange.endDate}.pdf`);
  };

  const exportToGoogleSheets = () => {
    // Prepare data for Google Sheets
    const sheetData = [
      ['Reservation Number', 'Customer Name', 'Phone', 'Date', 'Time', 'Party Size', 'Status'],
      ...reservations.map((res: any) => [
        res.reservation_number,
        res.customer_name,
        res.phone_number,
        res.reservation_date,
        res.reservation_time,
        res.party_size,
        res.status
      ])
    ];

    // Convert to CSV format for Google Sheets
    const csvContent = sheetData.map(row => 
      row.map(cell => `"${cell || ''}"`).join(',')
    ).join('\n');

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reservations_${dateRange.startDate}_${dateRange.endDate}_for_google_sheets.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    // Show instructions
    alert('CSV file downloaded. To import to Google Sheets:\n1. Go to Google Sheets\n2. File > Import\n3. Upload the downloaded CSV file\n4. Select "Replace current sheet"');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-h-screen overflow-y-auto">
      {/* Date Range Filter */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Date Range</h3>
        <div className="flex space-x-4">
          <div className="w-1/6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Quick Select</label>
            <select
              value={selectedRange}
              onChange={(e) => handleRangeChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7days">Last 7 Days</option>
              <option value="last30days">Last 30 Days</option>
              <option value="custom">Custom Interval</option>
            </select>
          </div>
          
          {showCustomRange && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </>
          )}
        </div>
        
        {!showCustomRange && (
          <div className="mt-3 text-sm text-gray-600">
            Showing data from {dateRange.startDate} to {dateRange.endDate}
          </div>
        )}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                <span className="text-blue-600 text-xs font-semibold">📊</span>
              </div>
            </div>
            <div className="ml-3">
              <p className="text-xs font-medium text-gray-500">Total Reservations</p>
              <p className="text-lg font-bold text-gray-900">{stats.total}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-6 h-6 bg-green-100 rounded-lg flex items-center justify-center">
                <span className="text-green-600 text-xs font-semibold">✅</span>
              </div>
            </div>
            <div className="ml-3">
              <p className="text-xs font-medium text-gray-500">Confirmed</p>
              <p className="text-lg font-bold text-gray-900">{stats.confirmed}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-6 h-6 bg-yellow-100 rounded-lg flex items-center justify-center">
                <span className="text-yellow-600 text-xs font-semibold">⏳</span>
              </div>
            </div>
            <div className="ml-3">
              <p className="text-xs font-medium text-gray-500">Pending</p>
              <p className="text-lg font-bold text-gray-900">{stats.pending}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-6 h-6 bg-red-100 rounded-lg flex items-center justify-center">
                <span className="text-red-600 text-xs font-semibold">❌</span>
              </div>
            </div>
            <div className="ml-3">
              <p className="text-xs font-medium text-gray-500">No-Show</p>
              <p className="text-lg font-bold text-gray-900">{stats.noShow}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-6 h-6 bg-purple-100 rounded-lg flex items-center justify-center">
                <span className="text-purple-600 text-xs font-semibold">👥</span>
              </div>
            </div>
            <div className="ml-3">
              <p className="text-xs font-medium text-gray-500">Avg Party Size</p>
              <p className="text-lg font-bold text-gray-900">{stats.avgPartySize}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Statistics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Reservation Status Distribution</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">Confirmed</span>
              <div className="flex items-center space-x-2">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full" 
                    style={{ width: `${stats.total > 0 ? (stats.confirmed / stats.total) * 100 : 0}%` }}
                  ></div>
                </div>
                <span className="text-xs font-medium text-gray-900">{stats.confirmed}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">Pending</span>
              <div className="flex items-center space-x-2">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-yellow-500 h-2 rounded-full" 
                    style={{ width: `${stats.total > 0 ? (stats.pending / stats.total) * 100 : 0}%` }}
                  ></div>
                </div>
                <span className="text-xs font-medium text-gray-900">{stats.pending}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">No-Show</span>
              <div className="flex items-center space-x-2">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-red-500 h-2 rounded-full" 
                    style={{ width: `${stats.total > 0 ? (stats.noShow / stats.total) * 100 : 0}%` }}
                  ></div>
                </div>
                <span className="text-xs font-medium text-gray-900">{stats.noShow}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">Completed</span>
              <div className="flex items-center space-x-2">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full" 
                    style={{ width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%` }}
                  ></div>
                </div>
                <span className="text-xs font-medium text-gray-900">{stats.completed}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Popular Time Slots */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Popular Time Slots</h3>
          <div className="space-y-3">
            {timeSlotStats.map(([time, count]) => (
              <div key={time} className="flex items-center justify-between">
                <span className="text-xs text-gray-600">{time}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-32 bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-indigo-500 h-2 rounded-full" 
                      style={{ width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-medium text-gray-900">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Daily Trends */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Trends (Selected Period)</h3>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reservations</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Guests</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Party Size</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {dailyTrends.map(([date, data]) => (
                <tr key={date}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{date}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{data.count}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{data.guests}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {data.count > 0 ? (data.guests / data.count).toFixed(1) : 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts Section */}
      <div className="space-y-6">
        {/* Daily Trend Chart */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Reservation Trend</h3>
          <div className="h-64">
            <Line
              data={prepareDailyTrendChartData()}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: false,
                  },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      stepSize: 1,
                    },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* Time Slot Chart */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Popular Time Slots</h3>
          <div className="h-64">
            <Line
              data={prepareTimeSlotChartData()}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: false,
                  },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      stepSize: 1,
                    },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* Status Distribution Chart */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Reservation Status Distribution</h3>
          <div className="flex justify-center">
            <div className="w-80 h-80">
              <Pie
                data={prepareStatusChartData()}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: false,
                    },
                  },
                }}
              />
            </div>
          </div>
          {/* Custom Legend */}
          <div className="flex justify-center mt-4 space-x-6">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-gray-500"></div>
              <span className="text-sm font-semibold text-gray-700">Total: {stats.total}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-sm text-gray-700">Confirmed: {stats.confirmed}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <span className="text-sm text-gray-700">Pending: {stats.pending}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span className="text-sm text-gray-700">No-Show: {stats.noShow}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-sm text-gray-700">Completed: {stats.completed}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Party Size Distribution */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Party Size Distribution</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {partySizeStats.map(([size, count]) => (
            <div key={size} className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-lg font-bold text-gray-900">{size}</div>
              <div className="text-xs text-gray-500">people</div>
              <div className="text-sm font-semibold text-blue-600">{count}</div>
              <div className="text-xs text-gray-400">reservations</div>
            </div>
          ))}
        </div>
      </div>

      {/* Export Buttons */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Export Options</h3>
        <div className="flex space-x-4">
          <button
            onClick={exportToCSV}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Export to CSV
          </button>
          <button
            onClick={exportToExcel}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Export to Excel
          </button>
          <button
            onClick={exportToPDF}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Export to PDF
          </button>
          <button
            onClick={exportToGoogleSheets}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Export to Google Sheets
          </button>
        </div>
      </div>

      {/* Cancelled Reservations List */}
      {cancelledReservations.length > 0 && (
        <div className="bg-red-50 rounded-lg shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-red-900 mb-4">취소된 예약 (복구 가능)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-red-200">
              <thead className="bg-red-100">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-red-700 uppercase tracking-wider">Reservation #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-red-700 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-red-700 uppercase tracking-wider">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-red-700 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-red-700 uppercase tracking-wider">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-red-700 uppercase tracking-wider">Party Size</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-red-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-red-50 divide-y divide-red-200">
                {cancelledReservations.map((res: any) => (
                  <tr key={res.id} className="opacity-75">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-red-900">{res.reservation_number}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-900">{res.customer_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-900">{res.phone_number}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-900">{res.reservation_date}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-900">{res.reservation_time}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-900">{res.party_size}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => handleRebook(res.id)}
                        className="text-green-600 hover:text-green-900 bg-green-100 hover:bg-green-200 px-3 py-1 rounded text-sm font-medium"
                      >
                        Rebook
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active Reservations List */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">활성 예약 목록</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reservation #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Party Size</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {activeReservations.map((res: any) => (
                <tr key={res.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{res.reservation_number}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{res.customer_name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{res.phone_number}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{res.reservation_date}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{res.reservation_time}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{res.party_size}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      res.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                      res.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      res.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {res.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    {res.status === 'cancelled' ? (
                      <button
                        onClick={() => handleRebook(res.id)}
                        className="text-green-600 hover:text-green-900 bg-green-100 hover:bg-green-200 px-3 py-1 rounded text-sm font-medium"
                      >
                        Rebook
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCancel(res.id)}
                        className="text-red-600 hover:text-red-900 bg-red-100 hover:bg-red-200 px-3 py-1 rounded text-sm font-medium"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// No-Show History Component
const NoShowHistory = () => {
  const [noShows, setNoShows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNoShows();
  }, []);

  const fetchNoShows = async () => {
    try {
      setLoading(true);
      // This would be a separate API endpoint for no-show history
      const response = await fetch(`${API_URL}/reservations?status=cancelled`);
      if (response.ok) {
        const data = await response.json();
        // Filter for no-shows (this is a simplified example)
        const noShowData = data.filter((res: any) => res.status === 'cancelled');
        setNoShows(noShowData);
      }
    } catch (error) {
      console.error('Error fetching no-shows:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">No-Show History</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reservation #</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Party Size</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {noShows.map((res: any) => (
              <tr key={res.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{res.reservation_number}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{res.customer_name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{res.phone_number}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{res.reservation_date}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{res.reservation_time}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{res.party_size}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                    No-Show
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TableReservationSettingsPage; 