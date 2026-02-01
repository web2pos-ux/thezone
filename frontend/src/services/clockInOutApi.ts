import { API_URL } from '../config/constants';
const API_BASE_URL = API_URL;

export interface ClockInResponse {
  message: string;
  recordId: number;
  clockInTime: string;
  hasSchedule: boolean;
}

export interface ClockOutResponse {
  message: string;
  clockOutTime: string;
  totalHours: string;
  earlyOut: boolean;
}

export interface ClockedInEmployee {
  id: number;
  employee_id: string;
  employee_name: string;
  clock_in_time: string;
  role: string;
  department: string;
}

export interface ClockRecord {
  id: number;
  employee_id: string;
  employee_name: string;
  clock_in_time: string;
  clock_out_time: string | null;
  scheduled_shift_id: number | null;
  early_out_approved_by: string | null;
  early_out_reason: string | null;
  total_hours: number | null;
  status: 'clocked_in' | 'clocked_out';
  created_at: string;
  updated_at: string;
}

export interface VerifyPinResponse {
  employee: {
    id: string;
    name: string;
    role: string;
    department: string;
  };
}

const clockInOutApi = {
  // Verify PIN and get employee info
  verifyPin: async (pin: string): Promise<VerifyPinResponse> => {
    const response = await fetch(`${API_BASE_URL}/work-schedule/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to verify PIN');
    }
    
    return response.json();
  },

  // Clock in
  clockIn: async (
    employeeId: string,
    employeeName: string,
    pin: string
  ): Promise<ClockInResponse> => {
    const response = await fetch(`${API_BASE_URL}/work-schedule/clock-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, employeeName, pin }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to clock in');
    }
    
    return response.json();
  },

  // Clock out
  clockOut: async (
    employeeId: string,
    pin: string,
    earlyOut?: boolean,
    earlyOutReason?: string,
    approvedBy?: string
  ): Promise<ClockOutResponse> => {
    const response = await fetch(`${API_BASE_URL}/work-schedule/clock-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId,
        pin,
        earlyOut,
        earlyOutReason,
        approvedBy,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to clock out');
    }
    
    return response.json();
  },

  // Get currently clocked in employees
  getClockedInEmployees: async (): Promise<ClockedInEmployee[]> => {
    const response = await fetch(`${API_BASE_URL}/work-schedule/clocked-in`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch clocked in employees');
    }
    
    return response.json();
  },

  // Get employee's clock history
  getClockHistory: async (
    employeeId: string,
    startDate?: string,
    endDate?: string,
    limit?: number
  ): Promise<ClockRecord[]> => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (limit) params.append('limit', limit.toString());
    
    const url = `${API_BASE_URL}/work-schedule/clock-history/${employeeId}${
      params.toString() ? `?${params.toString()}` : ''
    }`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch clock history');
    }
    
    return response.json();
  },
};

export default clockInOutApi;

