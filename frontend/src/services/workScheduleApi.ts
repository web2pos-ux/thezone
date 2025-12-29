// Work Schedule API Service
const API_BASE_URL = 'http://localhost:3177/api/work-schedule';

// Types
export interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
  email?: string;
  phone?: string;
  hire_date?: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface Schedule {
  id?: number;
  employeeId: string;
  date: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  workedStart?: string;
  workedEnd?: string;
  swappedWith?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ShiftSwapRequest {
  id: string;
  employee1Id: string;
  employee1Name: string;
  employee1Date: string;
  employee1Time?: string;
  employee2Id: string;
  employee2Name: string;
  employee2Date: string;
  employee2Time?: string;
  status: 'pending' | 'approved' | 'rejected';
  mode: 'swap' | 'give';
  requestedDate: string;
  approvedDate?: string;
  approver?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedDate: string;
  approvedDate?: string;
  approver?: string;
  isPartial?: boolean;
  partialStartTime?: string;
  partialEndTime?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ActivityLog {
  id: string;
  type: string;
  action: string;
  employeeId?: string;
  employeeName?: string;
  details?: string;
  timestamp: string;
  user?: string;
  created_at?: string;
}

// Helper function for API calls
async function apiCall<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API Error: ${response.status}`);
  }

  return response.json();
}

// ======================
// EMPLOYEES API
// ======================

export const employeesApi = {
  getAll: async (): Promise<Employee[]> => {
    return apiCall<Employee[]>('/employees');
  },

  getById: async (id: string): Promise<Employee> => {
    return apiCall<Employee>(`/employees/${id}`);
  },

  create: async (employee: Omit<Employee, 'created_at' | 'updated_at' | 'status'>): Promise<Employee> => {
    return apiCall<Employee>('/employees', {
      method: 'POST',
      body: JSON.stringify(employee),
    });
  },

  update: async (id: string, employee: Partial<Employee>): Promise<Employee> => {
    return apiCall<Employee>(`/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(employee),
    });
  },

  delete: async (id: string): Promise<{ message: string }> => {
    return apiCall<{ message: string }>(`/employees/${id}`, {
      method: 'DELETE',
    });
  },
};

// ======================
// SCHEDULES API
// ======================

export const schedulesApi = {
  getAll: async (params?: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
  }): Promise<Schedule[]> => {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);
    if (params?.employeeId) queryParams.append('employeeId', params.employeeId);

    const query = queryParams.toString();
    return apiCall<Schedule[]>(`/schedules${query ? `?${query}` : ''}`);
  },

  getById: async (id: number): Promise<Schedule> => {
    return apiCall<Schedule>(`/schedules/${id}`);
  },

  createOrUpdate: async (schedule: {
    employeeId: string;
    date: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    workedStart?: string;
    workedEnd?: string;
    swappedWith?: string;
    notes?: string;
  }): Promise<Schedule> => {
    return apiCall<Schedule>('/schedules', {
      method: 'POST',
      body: JSON.stringify(schedule),
    });
  },

  update: async (id: number, schedule: Partial<Schedule>): Promise<Schedule> => {
    return apiCall<Schedule>(`/schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(schedule),
    });
  },

  delete: async (id: number): Promise<{ message: string }> => {
    return apiCall<{ message: string }>(`/schedules/${id}`, {
      method: 'DELETE',
    });
  },

  bulkCreateOrUpdate: async (schedules: Array<{
    employeeId: string;
    date: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    workedStart?: string;
    workedEnd?: string;
    swappedWith?: string;
    notes?: string;
  }>): Promise<{ message: string }> => {
    return apiCall<{ message: string }>('/schedules/bulk', {
      method: 'POST',
      body: JSON.stringify({ schedules }),
    });
  },
};

// ======================
// SHIFT SWAPS API
// ======================

export const shiftSwapsApi = {
  getAll: async (params?: {
    status?: string;
    employeeId?: string;
  }): Promise<ShiftSwapRequest[]> => {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.employeeId) queryParams.append('employeeId', params.employeeId);

    const query = queryParams.toString();
    return apiCall<ShiftSwapRequest[]>(`/shift-swaps${query ? `?${query}` : ''}`);
  },

  getById: async (id: string): Promise<ShiftSwapRequest> => {
    return apiCall<ShiftSwapRequest>(`/shift-swaps/${id}`);
  },

  create: async (request: Omit<ShiftSwapRequest, 'created_at' | 'updated_at'>): Promise<ShiftSwapRequest> => {
    return apiCall<ShiftSwapRequest>('/shift-swaps', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  update: async (id: string, request: Partial<ShiftSwapRequest>): Promise<ShiftSwapRequest> => {
    return apiCall<ShiftSwapRequest>(`/shift-swaps/${id}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    });
  },

  delete: async (id: string): Promise<{ message: string }> => {
    return apiCall<{ message: string }>(`/shift-swaps/${id}`, {
      method: 'DELETE',
    });
  },
};

// ======================
// TIME OFF API
// ======================

export const timeOffApi = {
  getAll: async (params?: {
    status?: string;
    employeeId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<TimeOffRequest[]> => {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.employeeId) queryParams.append('employeeId', params.employeeId);
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);

    const query = queryParams.toString();
    return apiCall<TimeOffRequest[]>(`/time-off${query ? `?${query}` : ''}`);
  },

  getById: async (id: string): Promise<TimeOffRequest> => {
    return apiCall<TimeOffRequest>(`/time-off/${id}`);
  },

  create: async (request: Omit<TimeOffRequest, 'created_at' | 'updated_at'>): Promise<TimeOffRequest> => {
    return apiCall<TimeOffRequest>('/time-off', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  update: async (id: string, request: Partial<TimeOffRequest>): Promise<TimeOffRequest> => {
    return apiCall<TimeOffRequest>(`/time-off/${id}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    });
  },

  delete: async (id: string): Promise<{ message: string }> => {
    return apiCall<{ message: string }>(`/time-off/${id}`, {
      method: 'DELETE',
    });
  },
};

// ======================
// ACTIVITY LOGS API
// ======================

export const activityLogsApi = {
  getAll: async (params?: {
    type?: string;
    employeeId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<ActivityLog[]> => {
    const queryParams = new URLSearchParams();
    if (params?.type) queryParams.append('type', params.type);
    if (params?.employeeId) queryParams.append('employeeId', params.employeeId);
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);
    if (params?.limit) queryParams.append('limit', params.limit.toString());

    const query = queryParams.toString();
    return apiCall<ActivityLog[]>(`/activity-logs${query ? `?${query}` : ''}`);
  },

  create: async (log: Omit<ActivityLog, 'created_at'>): Promise<ActivityLog> => {
    return apiCall<ActivityLog>('/activity-logs', {
      method: 'POST',
      body: JSON.stringify(log),
    });
  },

  delete: async (id: string): Promise<{ message: string }> => {
    return apiCall<{ message: string }>(`/activity-logs/${id}`, {
      method: 'DELETE',
    });
  },
};


