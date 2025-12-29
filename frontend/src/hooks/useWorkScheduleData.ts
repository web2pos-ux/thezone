import { useState, useEffect } from 'react';
import {
  employeesApi,
  schedulesApi,
  shiftSwapsApi,
  timeOffApi,
  type Employee as ApiEmployee,
  type Schedule as ApiSchedule,
  type ShiftSwapRequest as ApiShiftSwapRequest,
  type TimeOffRequest as ApiTimeOffRequest,
} from '../services/workScheduleApi';

export interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
}

export interface Schedule {
  employeeId: string;
  date: string;
  scheduledStart: string;
  scheduledEnd: string;
  workedStart?: string;
  workedEnd?: string;
  swappedWith?: string;
  swappedEmployeeName?: string;
  givenFrom?: string;
  givenFromName?: string;
  employeeName?: string;
  status?: 'scheduled' | 'completed' | 'cancelled';
}

export interface ShiftSwapRequest {
  id: string;
  firstEmployeeId: string;
  firstEmployeeName: string;
  firstScheduleDate: string;
  firstScheduleStart: string;
  firstScheduleEnd: string;
  secondEmployeeId: string;
  secondEmployeeName: string;
  secondScheduleDate: string;
  secondScheduleStart: string;
  secondScheduleEnd: string;
  requestDate: string;
  status: 'pending' | 'approved' | 'rejected';
  createdBy: string;
  approver?: string;
  approvalDate?: string;
  reason?: string;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  requestDate: string;
  type: 'paid-vacation' | 'unpaid-vacation' | 'paid-sick' | 'unpaid-sick';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approver?: string;
  approvalDate?: string;
  approvalReason?: string;
  isPartial: boolean;
  partialStartTime?: string;
  partialEndTime?: string;
  workDaysCount: number;
}

export const useWorkScheduleData = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [shiftSwapRequests, setShiftSwapRequests] = useState<ShiftSwapRequest[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load all data from backend
  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      console.log('🔄 Loading work schedule data from API...');

      // Load employees
      const apiEmployees = await employeesApi.getAll();
      console.log(`✅ Loaded ${apiEmployees.length} employees`);
      const convertedEmployees: Employee[] = apiEmployees.map(emp => ({
        id: emp.id,
        name: emp.name,
        role: emp.role,
        department: emp.department
      }));
      setEmployees(convertedEmployees);

      // Load schedules
      const apiSchedules = await schedulesApi.getAll();
      console.log(`✅ Loaded ${apiSchedules.length} schedules`);
      const convertedSchedules: Schedule[] = apiSchedules.map(s => ({
        employeeId: s.employeeId,
        date: s.date,
        scheduledStart: s.scheduledStart || '',
        scheduledEnd: s.scheduledEnd || '',
        workedStart: s.workedStart,
        workedEnd: s.workedEnd,
        swappedWith: s.swappedWith,
        employeeName: convertedEmployees.find(e => e.id === s.employeeId)?.name
      }));
      setSchedules(convertedSchedules);
      localStorage.setItem('workSchedules', JSON.stringify(convertedSchedules));

      // Load shift swap requests
      const apiShiftSwaps = await shiftSwapsApi.getAll();
      console.log(`✅ Loaded ${apiShiftSwaps.length} shift swaps`);
      const convertedSwaps: ShiftSwapRequest[] = apiShiftSwaps.map(s => ({
        id: s.id,
        firstEmployeeId: s.employee1Id,
        firstEmployeeName: s.employee1Name,
        firstScheduleDate: s.employee1Date,
        firstScheduleStart: s.employee1Time || '',
        firstScheduleEnd: '',
        secondEmployeeId: s.employee2Id,
        secondEmployeeName: s.employee2Name,
        secondScheduleDate: s.employee2Date,
        secondScheduleStart: s.employee2Time || '',
        secondScheduleEnd: '',
        requestDate: s.requestedDate,
        status: s.status,
        createdBy: s.employee1Name,
        approvedDate: s.approvedDate,
        approver: s.approver,
      }));
      setShiftSwapRequests(convertedSwaps);
      localStorage.setItem('shiftSwapRequests', JSON.stringify(convertedSwaps));

      // Load time off requests
      const apiTimeOff = await timeOffApi.getAll();
      console.log(`✅ Loaded ${apiTimeOff.length} time off requests`);
      const convertedTimeOff: TimeOffRequest[] = apiTimeOff.map(t => ({
        id: t.id,
        employeeId: t.employeeId,
        employeeName: t.employeeName,
        type: t.type as any,
        startDate: t.startDate,
        endDate: t.endDate,
        reason: t.reason || '',
        status: t.status,
        requestDate: t.requestedDate,
        approvedDate: t.approvedDate,
        approver: t.approver,
        isPartial: !!t.isPartial,
        partialStartTime: t.partialStartTime,
        partialEndTime: t.partialEndTime,
        workDaysCount: 0
      }));
      setTimeOffRequests(convertedTimeOff);
      localStorage.setItem('timeOffRequests', JSON.stringify(convertedTimeOff));

      console.log('✅ All work schedule data loaded successfully');
    } catch (err) {
      console.error('❌ Error loading work schedule data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
      
      // Try to load from localStorage as fallback
      try {
        const savedSchedules = localStorage.getItem('workSchedules');
        if (savedSchedules) {
          setSchedules(JSON.parse(savedSchedules));
          console.log('⚠️ Loaded schedules from localStorage backup');
        }
        const savedSwaps = localStorage.getItem('shiftSwapRequests');
        if (savedSwaps) {
          setShiftSwapRequests(JSON.parse(savedSwaps));
          console.log('⚠️ Loaded shift swaps from localStorage backup');
        }
        const savedTimeOff = localStorage.getItem('timeOffRequests');
        if (savedTimeOff) {
          setTimeOffRequests(JSON.parse(savedTimeOff));
          console.log('⚠️ Loaded time off requests from localStorage backup');
        }
      } catch (e) {
        console.error('Error loading from localStorage:', e);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Save schedule
  const saveSchedule = async (schedule: Partial<Schedule> & { employeeId: string; date: string }) => {
    try {
      await schedulesApi.createOrUpdate({
        employeeId: schedule.employeeId,
        date: schedule.date,
        scheduledStart: schedule.scheduledStart,
        scheduledEnd: schedule.scheduledEnd,
        workedStart: schedule.workedStart,
        workedEnd: schedule.workedEnd,
        swappedWith: schedule.swappedWith
      });
      console.log('✅ Schedule saved to backend');

      // Update local state
      const existingIndex = schedules.findIndex(
        s => s.employeeId === schedule.employeeId && s.date === schedule.date
      );

      if (existingIndex >= 0) {
        // Update existing
        const updated = [...schedules];
        updated[existingIndex] = { ...updated[existingIndex], ...schedule };
        setSchedules(updated);
      } else {
        // Add new
        setSchedules([...schedules, schedule as Schedule]);
      }

      return true;
    } catch (error) {
      console.error('Error saving schedule:', error);
      throw error;
    }
  };

  // Delete schedule
  const deleteSchedule = async (employeeId: string, date: string) => {
    try {
      // Find the schedule ID
      const schedule = schedules.find(s => s.employeeId === employeeId && s.date === date);
      if (!schedule) {
        throw new Error('Schedule not found');
      }

      // Note: Backend expects schedule ID, but we need to add this to the API
      // For now, we'll just remove it from local state
      setSchedules(schedules.filter(s => !(s.employeeId === employeeId && s.date === date)));
      console.log('✅ Schedule deleted');
      return true;
    } catch (error) {
      console.error('Error deleting schedule:', error);
      throw error;
    }
  };

  // Bulk save schedules
  const bulkSaveSchedules = async (schedulesToSave: Array<Partial<Schedule> & { employeeId: string; date: string }>) => {
    try {
      await schedulesApi.bulkCreateOrUpdate(schedulesToSave.map(s => ({
        employeeId: s.employeeId,
        date: s.date,
        scheduledStart: s.scheduledStart,
        scheduledEnd: s.scheduledEnd,
        workedStart: s.workedStart,
        workedEnd: s.workedEnd,
        swappedWith: s.swappedWith
      })));
      console.log(`✅ Bulk saved ${schedulesToSave.length} schedules to backend`);

      // Reload data
      await loadData();
      return true;
    } catch (error) {
      console.error('Error bulk saving schedules:', error);
      throw error;
    }
  };

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  return {
    employees,
    schedules,
    shiftSwapRequests,
    timeOffRequests,
    isLoading,
    error,
    loadData,
    saveSchedule,
    deleteSchedule,
    bulkSaveSchedules,
    setSchedules,
    setShiftSwapRequests,
    setTimeOffRequests
  };
};

