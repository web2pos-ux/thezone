import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Edit2, Trash2, X, Calendar, BarChart3 } from 'lucide-react';
import { API_URL } from '../config/constants';
import RequestResultsModal from '../components/RequestResultsModal';
import {
  employeesApi,
  schedulesApi,
  shiftSwapsApi,
  timeOffApi,
  activityLogsApi,
  type Employee as ApiEmployee,
  type Schedule as ApiSchedule,
  type ShiftSwapRequest as ApiShiftSwapRequest,
  type TimeOffRequest as ApiTimeOffRequest,
  type ActivityLog as ApiActivityLog,
} from '../services/workScheduleApi';

interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
}

interface Schedule {
  employeeId: string;
  date: string;
  scheduledStart: string;
  scheduledEnd: string;
  workedStart?: string;
  workedEnd?: string;
  swappedWith?: string; // Employee ID who swapped with
  swappedEmployeeName?: string; // Name for display
  givenFrom?: string; // Employee ID who gave this shift
  givenFromName?: string; // Name for display
  employeeName?: string; // Employee name
  status?: 'scheduled' | 'completed' | 'cancelled'; // Schedule status
}

interface ScheduleEditModal {
  isOpen: boolean;
  employeeId: string;
  employeeName: string;
  date: string;
  schedule: Schedule | null;
}

interface BiWeeklySchedule {
  employeeId: string;
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
  weekNumber: number; // 1 or 2
  startTime: string;
  endTime: string;
  isWorkDay: boolean;
}

interface BiWeeklyScheduleModal {
  isOpen: boolean;
  startDate: Date;
}

interface ShiftSwapModal {
  isOpen: boolean;
  step: 1 | 2 | 3 | 4; // 1: Select first employee, 2: Select their schedule, 3: Select second employee & schedule, 4: Set status
  firstEmployee: Employee | null;
  firstSchedule: Schedule | null;
  secondEmployee: Employee | null;
  secondSchedule: Schedule | null;
  showPreview?: boolean; // Show swap preview after both schedules are selected
  mode: 'swap' | 'give'; // swap: exchange schedules, give: give schedule to employee with off day
}

interface ShiftSwapRequest {
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

interface TimeOffRequest {
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
  workDaysCount: number; // Actual working days affected
}

interface TimeOffModal {
  isOpen: boolean;
  step: 1 | 2; // 1: Select employee, 2: Type/Duration/Reason + Calendar
  selectedEmployee: Employee | null;
  selectedType: 'paid-vacation' | 'unpaid-vacation' | 'paid-sick' | 'unpaid-sick' | null;
}

interface ActivityLog {
  id: string;
  type: 'shift_swap' | 'shift_give' | 'time_off';
  requestor: string;
  requestorId: string;
  requestDate: string;
  status: 'pending' | 'approved' | 'rejected';
  approver?: string;
  approvalDate?: string;
  approvalReason?: string;
  details: any;
}

interface Holiday {
  date: string;
  name: string;
  country: string;
  state?: string;
}

const WorkSchedulePage = () => {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedDepartment, setSelectedDepartment] = useState('All');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedCountry, setSelectedCountry] = useState<string>('CA');
  const [selectedState, setSelectedState] = useState<string>('BC');
  const [businessInfo, setBusinessInfo] = useState<{ country: string; state: string } | null>(null);
  const [editModal, setEditModal] = useState<ScheduleEditModal>({
    isOpen: false,
    employeeId: '',
    employeeName: '',
    date: '',
    schedule: null
  });
  const [scheduleStart, setScheduleStart] = useState('09:00');
  const [scheduleEnd, setScheduleEnd] = useState('17:00');
  const [biWeeklyModal, setBiWeeklyModal] = useState<BiWeeklyScheduleModal>({
    isOpen: false,
    startDate: new Date()
  });
  const [biWeeklySchedules, setBiWeeklySchedules] = useState<BiWeeklySchedule[]>([]);
  const [selectedBiWeeklyStartDate, setSelectedBiWeeklyStartDate] = useState<Date>(new Date());
  const [biWeeklyDepartmentFilter, setBiWeeklyDepartmentFilter] = useState<string>('All');
  const [shiftSwapModal, setShiftSwapModal] = useState<ShiftSwapModal>({
    isOpen: false,
    step: 1,
    firstEmployee: null,
    firstSchedule: null,
    secondEmployee: null,
    secondSchedule: null,
    showPreview: false,
    mode: 'swap'
  });
  const [shiftSwapRequests, setShiftSwapRequests] = useState<ShiftSwapRequest[]>(() => {
    const saved = localStorage.getItem('shiftSwapRequests');
    return saved ? JSON.parse(saved) : [];
  });
  const [timeOffModal, setTimeOffModal] = useState<TimeOffModal>({
    isOpen: false,
    step: 1,
    selectedEmployee: null,
    selectedType: null
  });
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>(() => {
    const saved = localStorage.getItem('timeOffRequests');
    return saved ? JSON.parse(saved) : [];
  });
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(() => {
    const saved = localStorage.getItem('activityLogs');
    return saved ? JSON.parse(saved) : [];
  });
  const [timeOffReason, setTimeOffReason] = useState('');
  const [selectedStartDate, setSelectedStartDate] = useState('');
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [selectedEndDate, setSelectedEndDate] = useState('');
  const [isPartialTimeOff, setIsPartialTimeOff] = useState(false);
  const [partialStartTime, setPartialStartTime] = useState('09:00');
  const [partialEndTime, setPartialEndTime] = useState('13:00');
  const [timeOffCalendarMonth, setTimeOffCalendarMonth] = useState(new Date());
  const [timeOffDepartmentFilter, setTimeOffDepartmentFilter] = useState('All');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Load employees from backend
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const departments = ['All', 'Hall', 'Kitchen', 'Office Staff'];

  // Load and sync data from API
  useEffect(() => {
    const syncDataFromAPI = async () => {
      try {
        setIsLoading(true);
        console.log('🔄 Syncing data from API...');

        // Load employees from API
        const apiEmployees = await employeesApi.getAll();
        if (apiEmployees.length > 0) {
          console.log(`✅ Loaded ${apiEmployees.length} employees from API`);
          const converted: Employee[] = apiEmployees.map(emp => ({
            id: emp.id,
            name: emp.name,
            role: emp.role,
            department: emp.department
          }));
          setEmployees(converted);
        }

        // Load schedules from API
        const apiSchedules = await schedulesApi.getAll();
        console.log(`✅ Loaded ${apiSchedules.length} schedules from API`);
        const convertedSchedules = apiSchedules.map(s => ({
          employeeId: s.employeeId,
          date: s.date,
          scheduledStart: s.scheduledStart || '',
          scheduledEnd: s.scheduledEnd || '',
          workedStart: s.workedStart,
          workedEnd: s.workedEnd,
          swappedWith: s.swappedWith,
        }));
        setSchedules(convertedSchedules);
        localStorage.setItem('workSchedules', JSON.stringify(convertedSchedules));

        // Load shift swap requests
        const apiShiftSwaps = await shiftSwapsApi.getAll();
        console.log(`✅ Loaded ${apiShiftSwaps.length} shift swaps from API`);
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
        console.log(`✅ Loaded ${apiTimeOff.length} time off requests from API`);
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

        console.log('✅ Data sync completed');
      } catch (error) {
        console.error('❌ Error syncing from API:', error);
        // Try to load from localStorage as fallback
        try {
          const savedSchedules = localStorage.getItem('workSchedules');
          if (savedSchedules) {
            setSchedules(JSON.parse(savedSchedules));
          }
          const savedSwaps = localStorage.getItem('shiftSwapRequests');
          if (savedSwaps) {
            setShiftSwapRequests(JSON.parse(savedSwaps));
          }
          const savedTimeOff = localStorage.getItem('timeOffRequests');
          if (savedTimeOff) {
            setTimeOffRequests(JSON.parse(savedTimeOff));
          }
        } catch (e) {
          console.error('Error loading from localStorage:', e);
        }
      } finally {
        setIsLoading(false);
      }
    };

    syncDataFromAPI();
  }, []);

  // Load Business Info from API
  useEffect(() => {
    const fetchBusinessInfo = async () => {
      try {
        const response = await fetch(`${API_URL}/admin-settings/business-profile`);
        const data = await response.json();
        
        if (data && data.country && data.state) {
          setBusinessInfo({ country: data.country, state: data.state });
          setSelectedCountry(data.country);
          setSelectedState(data.state);
        }
      } catch (error) {
        console.error('Failed to load business info:', error);
        // Default to Canada BC if no data
        setSelectedCountry('CA');
        setSelectedState('BC');
      }
    };
    fetchBusinessInfo();
  }, []);

  // Canada National Holidays 2025
  const canadaNationalHolidays: Holiday[] = [
    { date: '2025-01-01', name: "New Year's Day", country: 'CA' },
    { date: '2025-04-18', name: 'Good Friday', country: 'CA' },
    { date: '2025-07-01', name: 'Canada Day', country: 'CA' },
    { date: '2025-09-01', name: 'Labour Day', country: 'CA' },
    { date: '2025-12-25', name: 'Christmas Day', country: 'CA' },
    // 2024
    { date: '2024-01-01', name: "New Year's Day", country: 'CA' },
    { date: '2024-03-29', name: 'Good Friday', country: 'CA' },
    { date: '2024-07-01', name: 'Canada Day', country: 'CA' },
    { date: '2024-09-02', name: 'Labour Day', country: 'CA' },
    { date: '2024-12-25', name: 'Christmas Day', country: 'CA' },
  ];

  // British Columbia Holidays 2025
  const bcHolidays: Holiday[] = [
    { date: '2025-02-17', name: 'Family Day', country: 'CA', state: 'BC' },
    { date: '2025-08-04', name: 'BC Day', country: 'CA', state: 'BC' },
    { date: '2025-09-30', name: 'National Day for Truth and Reconciliation', country: 'CA', state: 'BC' },
    { date: '2025-10-13', name: 'Thanksgiving', country: 'CA', state: 'BC' },
    { date: '2025-11-11', name: 'Remembrance Day', country: 'CA', state: 'BC' },
    // 2024
    { date: '2024-02-19', name: 'Family Day', country: 'CA', state: 'BC' },
    { date: '2024-08-05', name: 'BC Day', country: 'CA', state: 'BC' },
    { date: '2024-09-30', name: 'National Day for Truth and Reconciliation', country: 'CA', state: 'BC' },
    { date: '2024-10-14', name: 'Thanksgiving', country: 'CA', state: 'BC' },
    { date: '2024-11-11', name: 'Remembrance Day', country: 'CA', state: 'BC' },
  ];

  // Ontario Holidays 2025
  const onHolidays: Holiday[] = [
    { date: '2025-02-17', name: 'Family Day', country: 'CA', state: 'ON' },
    { date: '2025-08-04', name: 'Civic Holiday', country: 'CA', state: 'ON' },
    { date: '2025-10-13', name: 'Thanksgiving', country: 'CA', state: 'ON' },
    // 2024
    { date: '2024-02-19', name: 'Family Day', country: 'CA', state: 'ON' },
    { date: '2024-08-05', name: 'Civic Holiday', country: 'CA', state: 'ON' },
    { date: '2024-10-14', name: 'Thanksgiving', country: 'CA', state: 'ON' },
  ];

  // Alberta Holidays 2025
  const abHolidays: Holiday[] = [
    { date: '2025-02-17', name: 'Family Day', country: 'CA', state: 'AB' },
    { date: '2025-08-04', name: 'Heritage Day', country: 'CA', state: 'AB' },
    { date: '2025-10-13', name: 'Thanksgiving', country: 'CA', state: 'AB' },
    { date: '2025-11-11', name: 'Remembrance Day', country: 'CA', state: 'AB' },
    // 2024
    { date: '2024-02-19', name: 'Family Day', country: 'CA', state: 'AB' },
    { date: '2024-08-05', name: 'Heritage Day', country: 'CA', state: 'AB' },
    { date: '2024-10-14', name: 'Thanksgiving', country: 'CA', state: 'AB' },
    { date: '2024-11-11', name: 'Remembrance Day', country: 'CA', state: 'AB' },
  ];

  // US Holidays 2025
  const usHolidays: Holiday[] = [
    { date: '2025-01-01', name: "New Year's Day", country: 'US' },
    { date: '2025-01-20', name: 'Martin Luther King Jr. Day', country: 'US' },
    { date: '2025-02-17', name: "Presidents' Day", country: 'US' },
    { date: '2025-05-26', name: 'Memorial Day', country: 'US' },
    { date: '2025-06-19', name: 'Juneteenth', country: 'US' },
    { date: '2025-07-04', name: 'Independence Day', country: 'US' },
    { date: '2025-09-01', name: 'Labor Day', country: 'US' },
    { date: '2025-10-13', name: 'Columbus Day', country: 'US' },
    { date: '2025-11-11', name: 'Veterans Day', country: 'US' },
    { date: '2025-11-27', name: 'Thanksgiving', country: 'US' },
    { date: '2025-12-25', name: 'Christmas', country: 'US' },
    // 2024
    { date: '2024-01-01', name: "New Year's Day", country: 'US' },
    { date: '2024-01-15', name: 'Martin Luther King Jr. Day', country: 'US' },
    { date: '2024-02-19', name: "Presidents' Day", country: 'US' },
    { date: '2024-05-27', name: 'Memorial Day', country: 'US' },
    { date: '2024-06-19', name: 'Juneteenth', country: 'US' },
    { date: '2024-07-04', name: 'Independence Day', country: 'US' },
    { date: '2024-09-02', name: 'Labor Day', country: 'US' },
    { date: '2024-10-14', name: 'Columbus Day', country: 'US' },
    { date: '2024-11-11', name: 'Veterans Day', country: 'US' },
    { date: '2024-11-28', name: 'Thanksgiving', country: 'US' },
    { date: '2024-12-25', name: 'Christmas', country: 'US' },
  ];

  // Korean Holidays 2025
  const krHolidays: Holiday[] = [
    { date: '2025-01-01', name: '신정', country: 'KR' },
    { date: '2025-01-28', name: '설날 연휴', country: 'KR' },
    { date: '2025-01-29', name: '설날', country: 'KR' },
    { date: '2025-01-30', name: '설날 연휴', country: 'KR' },
    { date: '2025-03-01', name: '삼일절', country: 'KR' },
    { date: '2025-05-05', name: '어린이날', country: 'KR' },
    { date: '2025-05-06', name: '석가탄신일', country: 'KR' },
    { date: '2025-06-06', name: '현충일', country: 'KR' },
    { date: '2025-08-15', name: '광복절', country: 'KR' },
    { date: '2025-10-05', name: '추석 연휴', country: 'KR' },
    { date: '2025-10-06', name: '추석', country: 'KR' },
    { date: '2025-10-07', name: '추석 연휴', country: 'KR' },
    { date: '2025-10-08', name: '대체공휴일', country: 'KR' },
    { date: '2025-10-09', name: '한글날', country: 'KR' },
    { date: '2025-12-25', name: '크리스마스', country: 'KR' },
    // 2024
    { date: '2024-01-01', name: '신정', country: 'KR' },
    { date: '2024-02-09', name: '설날 연휴', country: 'KR' },
    { date: '2024-02-10', name: '설날', country: 'KR' },
    { date: '2024-02-11', name: '설날 연휴', country: 'KR' },
    { date: '2024-02-12', name: '대체공휴일', country: 'KR' },
    { date: '2024-03-01', name: '삼일절', country: 'KR' },
    { date: '2024-04-10', name: '국회의원선거', country: 'KR' },
    { date: '2024-05-05', name: '어린이날', country: 'KR' },
    { date: '2024-05-06', name: '대체공휴일', country: 'KR' },
    { date: '2024-05-15', name: '석가탄신일', country: 'KR' },
    { date: '2024-06-06', name: '현충일', country: 'KR' },
    { date: '2024-08-15', name: '광복절', country: 'KR' },
    { date: '2024-09-16', name: '추석 연휴', country: 'KR' },
    { date: '2024-09-17', name: '추석', country: 'KR' },
    { date: '2024-09-18', name: '추석 연휴', country: 'KR' },
    { date: '2024-10-03', name: '개천절', country: 'KR' },
    { date: '2024-10-09', name: '한글날', country: 'KR' },
    { date: '2024-12-25', name: '크리스마스', country: 'KR' },
  ];

  // Get holidays based on selected country and state
  const getHolidays = (): Holiday[] => {
    let countryHolidays: Holiday[] = [];
    let provinceHolidays: Holiday[] = [];

    if (selectedCountry === 'CA') {
      countryHolidays = canadaNationalHolidays;
      
      // Add province-specific holidays
      if (selectedState === 'BC') {
        provinceHolidays = bcHolidays;
      } else if (selectedState === 'ON') {
        provinceHolidays = onHolidays;
      } else if (selectedState === 'AB') {
        provinceHolidays = abHolidays;
      }
    } else if (selectedCountry === 'US') {
      countryHolidays = usHolidays;
    } else if (selectedCountry === 'KR') {
      countryHolidays = krHolidays;
    }

    return [...countryHolidays, ...provinceHolidays];
  };

  const holidays = getHolidays();

  // Check if date is a holiday
  const isHoliday = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return holidays.find(h => h.date === dateStr);
  };

  // Open edit modal
  const openEditModal = (employeeId: string, employeeName: string, date: string, schedule: Schedule | null) => {
    setEditModal({
      isOpen: true,
      employeeId,
      employeeName,
      date,
      schedule
    });
    
    if (schedule) {
      setScheduleStart(schedule.scheduledStart);
      setScheduleEnd(schedule.scheduledEnd);
    } else {
      setScheduleStart('09:00');
      setScheduleEnd('17:00');
    }
  };

  // Close edit modal
  const closeEditModal = () => {
    setEditModal({
      isOpen: false,
      employeeId: '',
      employeeName: '',
      date: '',
      schedule: null
    });
  };

  // Save schedule
  const saveSchedule = async () => {
    try {
      const scheduleData = {
        employeeId: editModal.employeeId,
        date: editModal.date,
        scheduledStart: scheduleStart,
        scheduledEnd: scheduleEnd
      };

      // Save to backend
      await schedulesApi.createOrUpdate(scheduleData);
      console.log('✅ Schedule saved to backend');

      // Update local state
      if (editModal.schedule) {
        // Update existing schedule
        setSchedules(schedules.map(s => 
          s.employeeId === editModal.employeeId && s.date === editModal.date
            ? { ...s, scheduledStart: scheduleStart, scheduledEnd: scheduleEnd }
            : s
        ));
      } else {
        // Add new schedule
        setSchedules([...schedules, {
          employeeId: editModal.employeeId,
          date: editModal.date,
          scheduledStart: scheduleStart,
          scheduledEnd: scheduleEnd
        }]);
      }
      
      closeEditModal();
    } catch (error) {
      console.error('Error saving schedule:', error);
      alert('Failed to save schedule. Please try again.');
    }
  };

  // Delete schedule
  const deleteSchedule = () => {
    if (window.confirm('Are you sure you want to delete this schedule?')) {
      setSchedules(schedules.filter(s => 
        !(s.employeeId === editModal.employeeId && s.date === editModal.date)
      ));
      closeEditModal();
    }
  };

  // Open bi-weekly schedule modal
  const openBiWeeklyModal = () => {
    // Get the week before the selected start date to use as reference
    const referenceDate = new Date(selectedBiWeeklyStartDate);
    referenceDate.setDate(referenceDate.getDate() - 7); // Go back 1 week
    
    // Adjust to Sunday of that week
    const dayOfWeek = referenceDate.getDay();
    referenceDate.setDate(referenceDate.getDate() - dayOfWeek);
    
    // Initialize bi-weekly schedules for all employees
    const initialSchedules: BiWeeklySchedule[] = [];
    employees.forEach(emp => {
      for (let week = 1; week <= 2; week++) {
        for (let day = 0; day <= 6; day++) {
          // Calculate the reference date for this day of week from previous week
          const refDate = new Date(referenceDate);
          refDate.setDate(refDate.getDate() + day);
          const refDateStr = refDate.toISOString().split('T')[0];
          
          // Find if there's a schedule for this employee on this day of week in previous week
          const previousSchedule = schedules.find(s => 
            s.employeeId === emp.id && s.date === refDateStr
          );
          
          // If previous schedule exists, use those times, otherwise use defaults
          const startTime = previousSchedule ? previousSchedule.scheduledStart : '09:00';
          const endTime = previousSchedule ? previousSchedule.scheduledEnd : '17:00';
          const isWorkDay = previousSchedule ? true : (day >= 1 && day <= 5); // Mon-Fri default if no previous schedule
          
          initialSchedules.push({
            employeeId: emp.id,
            dayOfWeek: day,
            weekNumber: week,
            startTime: startTime,
            endTime: endTime,
            isWorkDay: isWorkDay
          });
        }
      }
    });
    
    setBiWeeklySchedules(initialSchedules);
    setBiWeeklyModal({ isOpen: true, startDate: selectedBiWeeklyStartDate });
  };

  // Close bi-weekly schedule modal
  const closeBiWeeklyModal = () => {
    setBiWeeklyModal({ isOpen: false, startDate: new Date() });
  };

  // Toggle work day for bi-weekly schedule
  const toggleBiWeeklyWorkDay = (employeeId: string, week: number, day: number) => {
    setBiWeeklySchedules(schedules =>
      schedules.map(s =>
        s.employeeId === employeeId && s.weekNumber === week && s.dayOfWeek === day
          ? { ...s, isWorkDay: !s.isWorkDay }
          : s
      )
    );
  };

  // Update bi-weekly schedule time
  const updateBiWeeklyTime = (employeeId: string, week: number, day: number, field: 'startTime' | 'endTime', value: string) => {
    setBiWeeklySchedules(schedules =>
      schedules.map(s =>
        s.employeeId === employeeId && s.weekNumber === week && s.dayOfWeek === day
          ? { ...s, [field]: value }
          : s
      )
    );
  };

  // Copy Sunday's time to all days in the week
  const copySundayTimeToAll = (employeeId: string, week: number) => {
    const sundaySchedule = biWeeklySchedules.find(s => 
      s.employeeId === employeeId && s.weekNumber === week && s.dayOfWeek === 0
    );
    
    if (!sundaySchedule || !sundaySchedule.isWorkDay) {
      alert('Please set Sunday\'s work time first');
      return;
    }

    setBiWeeklySchedules(schedules =>
      schedules.map(s =>
        s.employeeId === employeeId && s.weekNumber === week && s.dayOfWeek !== 0 && s.isWorkDay
          ? { ...s, startTime: sundaySchedule.startTime, endTime: sundaySchedule.endTime }
          : s
      )
    );
  };

  // Apply bi-weekly schedules
  const applyBiWeeklySchedules = () => {
    const startDate = new Date(selectedBiWeeklyStartDate);
    
    // Adjust to the nearest Sunday
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek);
    
    // Create a set of dates to keep (work days)
    const workDayDates = new Set<string>();
    const newSchedules: Schedule[] = [];
    
    biWeeklySchedules.forEach(biWeekly => {
      const weekOffset = (biWeekly.weekNumber - 1) * 7;
      const targetDate = new Date(startDate);
      targetDate.setDate(targetDate.getDate() + weekOffset + biWeekly.dayOfWeek);
      const dateStr = targetDate.toISOString().split('T')[0];
      
      if (biWeekly.isWorkDay) {
        // Add to work day dates set
        workDayDates.add(`${biWeekly.employeeId}-${dateStr}`);
        
        // Check if schedule already exists
        const existingSchedule = schedules.find(s => 
          s.employeeId === biWeekly.employeeId && s.date === dateStr
        );
        
        if (!existingSchedule) {
          newSchedules.push({
            employeeId: biWeekly.employeeId,
            date: dateStr,
            scheduledStart: biWeekly.startTime,
            scheduledEnd: biWeekly.endTime
          });
        } else {
          // Update existing schedule
          newSchedules.push({
            ...existingSchedule,
            scheduledStart: biWeekly.startTime,
            scheduledEnd: biWeekly.endTime
          });
        }
      }
    });
    
    // Filter out schedules that are in the 2-week range but not marked as work days
    const updatedSchedules = schedules.filter(s => {
      const schedDate = new Date(s.date);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 14);
      
      // If schedule is outside the 2-week range, keep it
      if (schedDate < startDate || schedDate >= endDate) {
        return true;
      }
      
      // If schedule is in the 2-week range, only keep if it's a work day
      return workDayDates.has(`${s.employeeId}-${s.date}`);
    });
    
    // Add new schedules
    newSchedules.forEach(newSched => {
      const index = updatedSchedules.findIndex(s => 
        s.employeeId === newSched.employeeId && s.date === newSched.date
      );
      if (index >= 0) {
        updatedSchedules[index] = newSched;
      } else {
        updatedSchedules.push(newSched);
      }
    });
    
    setSchedules(updatedSchedules);
    closeBiWeeklyModal();
  };

  // Open shift swap modal
  const openShiftSwapModal = () => {
    setShiftSwapModal({
      isOpen: true,
      step: 1,
      firstEmployee: null,
      firstSchedule: null,
      secondEmployee: null,
      secondSchedule: null,
      mode: 'swap'
    });
  };

  // Close shift swap modal
  const closeShiftSwapModal = () => {
    setShiftSwapModal({
      isOpen: false,
      step: 1,
      firstEmployee: null,
      firstSchedule: null,
      secondEmployee: null,
      secondSchedule: null,
      showPreview: false,
      mode: 'swap'
    });
  };

  // Select first employee
  const selectFirstEmployee = (employee: Employee) => {
    setShiftSwapModal({
      ...shiftSwapModal,
      step: 2,
      firstEmployee: employee
    });
  };

  // Select first schedule
  const selectFirstSchedule = (schedule: Schedule) => {
    setShiftSwapModal({
      ...shiftSwapModal,
      step: 2,  // Stay in step 2 to select second employee
      firstSchedule: schedule
    });
  };

  // Select second employee and schedule
  const selectSecondEmployeeSchedule = (secondEmployee: Employee, secondSchedule: Schedule) => {
    // Set the second schedule but stay in step 2
    setShiftSwapModal({
      ...shiftSwapModal,
      secondEmployee: secondEmployee,
      secondSchedule: secondSchedule
    });
  };

  // Execute swap with status selection
  const executeSwap = (status: 'pending' | 'approved' = 'approved') => {
    if (!shiftSwapModal.firstEmployee || !shiftSwapModal.firstSchedule || 
        !shiftSwapModal.secondEmployee || !shiftSwapModal.secondSchedule) return;

    // Create shift swap/give request
    const request: ShiftSwapRequest = {
      id: Date.now().toString(),
      firstEmployeeId: shiftSwapModal.firstEmployee.id,
      firstEmployeeName: shiftSwapModal.firstEmployee.name,
      firstScheduleDate: shiftSwapModal.firstSchedule.date,
      firstScheduleStart: shiftSwapModal.firstSchedule.scheduledStart,
      firstScheduleEnd: shiftSwapModal.firstSchedule.scheduledEnd,
      secondEmployeeId: shiftSwapModal.secondEmployee.id,
      secondEmployeeName: shiftSwapModal.secondEmployee.name,
      secondScheduleDate: shiftSwapModal.secondSchedule.date,
      secondScheduleStart: shiftSwapModal.secondSchedule.scheduledStart,
      secondScheduleEnd: shiftSwapModal.secondSchedule.scheduledEnd,
      requestDate: new Date().toISOString(),
      status: status,
      createdBy: 'Admin', // TODO: Get actual admin name
    };

    // If approved, execute the swap/give immediately
    if (status === 'approved') {
      request.approver = 'Admin';
      request.approvalDate = new Date().toISOString();

      if (shiftSwapModal.mode === 'give') {
        // GIVE mode: Remove first employee's shift and add to second employee
        const updatedSchedules = schedules
          .filter(s => !(s.employeeId === shiftSwapModal.firstEmployee!.id && s.date === shiftSwapModal.firstSchedule!.date))
          .concat([{
            ...shiftSwapModal.firstSchedule!,
            employeeId: shiftSwapModal.secondEmployee!.id,
            employeeName: shiftSwapModal.secondEmployee!.name,
            givenFrom: shiftSwapModal.firstEmployee!.id,
            givenFromName: shiftSwapModal.firstEmployee!.name,
            date: shiftSwapModal.secondSchedule!.date
          }]);
        
        setSchedules(updatedSchedules);
      } else {
        // SWAP mode: Exchange schedules
    const updatedSchedules = schedules.map(s => {
      // Update first employee's schedule
      if (s.employeeId === shiftSwapModal.firstEmployee!.id && s.date === shiftSwapModal.firstSchedule!.date) {
        return {
            ...shiftSwapModal.secondSchedule!,
          employeeId: shiftSwapModal.firstEmployee!.id,
            swappedWith: shiftSwapModal.secondEmployee!.id,
            swappedEmployeeName: shiftSwapModal.secondEmployee!.name
        };
      }
      // Update second employee's schedule
        if (s.employeeId === shiftSwapModal.secondEmployee!.id && s.date === shiftSwapModal.secondSchedule!.date) {
        return {
          ...shiftSwapModal.firstSchedule!,
            employeeId: shiftSwapModal.secondEmployee!.id,
          swappedWith: shiftSwapModal.firstEmployee!.id,
          swappedEmployeeName: shiftSwapModal.firstEmployee!.name
        };
      }
      return s;
    });

    setSchedules(updatedSchedules);
      }
    }

    setShiftSwapRequests([...shiftSwapRequests, request]);
    closeShiftSwapModal();

    // Log activity
    const log: ActivityLog = {
      id: Date.now().toString(),
      type: shiftSwapModal.mode === 'give' ? 'shift_give' : 'shift_swap',
      requestor: 'Admin',
      requestorId: 'admin',
      requestDate: new Date().toISOString(),
      status: status,
      approver: status === 'approved' ? 'Admin' : undefined,
      approvalDate: status === 'approved' ? new Date().toISOString() : undefined,
      details: {
        firstEmployee: shiftSwapModal.firstEmployee!.name,
        firstSchedule: shiftSwapModal.firstSchedule!.date,
        secondEmployee: shiftSwapModal.secondEmployee!.name,
        secondSchedule: shiftSwapModal.secondSchedule!.date,
        mode: shiftSwapModal.mode
      }
    };
    setActivityLogs([...activityLogs, log]);
  };

  // Go back in swap modal
  const goBackSwapStep = () => {
    if (shiftSwapModal.step === 2) {
      setShiftSwapModal({
        ...shiftSwapModal,
        step: 1,
        firstEmployee: null,
        firstSchedule: null,
        secondEmployee: null,
        secondSchedule: null
      });
    } else if (shiftSwapModal.step === 3) {
      setShiftSwapModal({
        ...shiftSwapModal,
        step: 2,
        secondSchedule: null
      });
    }
  };

  // Time Off Request functions
  const openTimeOffModal = () => {
    setTimeOffModal({
      isOpen: true,
      step: 1,
      selectedEmployee: null,
      selectedType: null
    });
    setTimeOffReason('');
    setSelectedStartDate('');
    setSelectedEndDate('');
    setIsPartialTimeOff(false);
    setPartialStartTime('09:00');
    setPartialEndTime('13:00');
  };

  const closeTimeOffModal = () => {
    setTimeOffModal({
      isOpen: false,
      step: 1,
      selectedEmployee: null,
      selectedType: null
    });
    setTimeOffReason('');
    setSelectedStartDate('');
    setSelectedEndDate('');
    setIsPartialTimeOff(false);
    setPartialStartTime('09:00');
    setPartialEndTime('13:00');
  };

  const selectEmployeeForTimeOff = (employee: Employee) => {
    setTimeOffModal({
      ...timeOffModal,
      step: 2,
      selectedEmployee: employee
    });
  };

  const selectTimeOffType = (type: 'paid-vacation' | 'unpaid-vacation' | 'paid-sick' | 'unpaid-sick') => {
    setTimeOffModal({
      ...timeOffModal,
      selectedType: type
    });
    // Clear reason when changing type
    if (type.startsWith('paid')) {
      setTimeOffReason('');
    }
  };

  // Calculate working days count in date range
  const calculateWorkDaysInRange = (employeeId: string, startDate: string, endDate: string) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    let workDaysCount = 0;
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      // Check if there's a schedule for this date
      const hasSchedule = schedules.some(s => s.employeeId === employeeId && s.date === dateStr);
      // Check if there's already a time off for this date
      const hasTimeOff = timeOffRequests.some(
        r => r.employeeId === employeeId && 
            r.startDate <= dateStr && 
            r.endDate >= dateStr && 
            r.status !== 'rejected'
      );
      
      if (hasSchedule && !hasTimeOff) {
        workDaysCount++;
      }
    }
    
    return workDaysCount;
  };

  const submitTimeOffRequest = (status: 'pending' | 'approved' | 'rejected' = 'pending') => {
    if (!timeOffModal.selectedEmployee || !selectedStartDate || !selectedEndDate || !timeOffModal.selectedType) return;

    // For unpaid types, reason is required
    const isUnpaid = timeOffModal.selectedType.startsWith('unpaid');
    if (isUnpaid && !timeOffReason.trim()) {
      alert('사유를 입력해주세요 (무급 휴가/병가는 사유 필수)');
      return;
    }

    // Validate partial time
    if (isPartialTimeOff && partialStartTime >= partialEndTime) {
      alert('종료 시간은 시작 시간보다 늦어야 합니다');
      return;
    }

    const workDaysCount = calculateWorkDaysInRange(timeOffModal.selectedEmployee.id, selectedStartDate, selectedEndDate);
    
    if (workDaysCount === 0) {
      alert('선택한 기간에 근무일이 없습니다');
      return;
    }

    const request: TimeOffRequest = {
      id: Date.now().toString(),
      employeeId: timeOffModal.selectedEmployee.id,
      employeeName: timeOffModal.selectedEmployee.name,
      startDate: selectedStartDate,
      endDate: selectedEndDate,
      requestDate: new Date().toISOString(),
      type: timeOffModal.selectedType,
      reason: timeOffReason,
      status: status,
      approver: status !== 'pending' ? 'Admin' : undefined,
      approvalDate: status !== 'pending' ? new Date().toISOString() : undefined,
      isPartial: isPartialTimeOff,
      partialStartTime: isPartialTimeOff ? partialStartTime : undefined,
      partialEndTime: isPartialTimeOff ? partialEndTime : undefined,
      workDaysCount: workDaysCount
    };

    setTimeOffRequests([...timeOffRequests, request]);

    // Log activity
    const log: ActivityLog = {
      id: Date.now().toString(),
      type: 'time_off',
      requestor: timeOffModal.selectedEmployee.name,
      requestorId: timeOffModal.selectedEmployee.id,
      requestDate: new Date().toISOString(),
      status: status,
      approver: status !== 'pending' ? 'Admin' : undefined,
      approvalDate: status !== 'pending' ? new Date().toISOString() : undefined,
      details: {
        startDate: selectedStartDate,
        endDate: selectedEndDate,
        type: timeOffModal.selectedType,
        reason: timeOffReason,
        isPartial: isPartialTimeOff,
        workDaysCount: workDaysCount
      }
    };
    setActivityLogs([...activityLogs, log]);

    closeTimeOffModal();
  };

  const goBackTimeOffStep = () => {
    if (timeOffModal.step === 2) {
      setTimeOffModal({
        ...timeOffModal,
        step: 1,
        selectedEmployee: null,
        selectedType: null
      });
      setSelectedStartDate('');
      setSelectedEndDate('');
      setTimeOffReason('');
      setIsPartialTimeOff(false);
    }
  };

  // Calculate duration between two times
  const calculateDuration = (start: string, end: string) => {
    const [startHour, startMin] = start.split(':').map(Number);
    const [endHour, endMin] = end.split(':').map(Number);
    
    let duration = (endHour * 60 + endMin) - (startHour * 60 + startMin);
    
    // Handle overnight shifts
    if (duration < 0) {
      duration += 24 * 60;
    }
    
    // Round to nearest 15 minutes (0.25 hours)
    const roundedDuration = Math.round(duration / 15) * 15;
    
    return (roundedDuration / 60).toFixed(2);
  };

  // Get week dates starting from selected date
  const getWeekDates = (date: Date) => {
    const day = date.getDay();
    const diff = date.getDate() - day;
    const sunday = new Date(date.setDate(diff));
    
    const week = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      week.push(d);
    }
    return week;
  };

  const weekDates = getWeekDates(new Date(selectedDate));

  // Calendar generation
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const monthDays = getDaysInMonth(currentMonth);
  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const isSameDay = (date1: Date, date2: Date) => {
    return date1.getDate() === date2.getDate() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getFullYear() === date2.getFullYear();
  };

  const isInSelectedWeek = (date: Date) => {
    return weekDates.some(weekDate => isSameDay(weekDate, date));
  };

  const isPastDate = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);
    return compareDate < today;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Calculate hours
  const calculateHours = (start: string, end: string) => {
    const [startHour, startMin] = start.split(':').map(Number);
    const [endHour, endMin] = end.split(':').map(Number);
    
    // Convert to total minutes
    let startTotalMinutes = startHour * 60 + startMin;
    let endTotalMinutes = endHour * 60 + endMin;
    
    // Handle overnight shifts (e.g., 17:00 to 01:00 next day)
    if (endTotalMinutes <= startTotalMinutes) {
      endTotalMinutes += 24 * 60; // Add 24 hours in minutes
    }
    
    const totalMinutes = endTotalMinutes - startTotalMinutes;
    
    // Round to nearest 15 minutes (0.25 hours)
    const roundedMinutes = Math.round(totalMinutes / 15) * 15;
    
    return roundedMinutes / 60; // Convert back to hours
  };

  const getWeeklyHours = (employeeId: string) => {
    let total = 0;
    weekDates.forEach(date => {
      const dateStr = date.toISOString().split('T')[0];
      
      // Check if there's an approved time off request for this date
      const timeOffRequest = timeOffRequests.find(
        r => r.employeeId === employeeId && 
             r.startDate <= dateStr && 
             r.endDate >= dateStr && 
             r.status === 'approved'
      );
      
      // Don't count hours if employee has approved time off
      if (timeOffRequest) {
        return;
      }
      
      const schedule = schedules.find(s => s.employeeId === employeeId && s.date === dateStr);
      if (schedule) {
        const isPast = isPastDate(date);
        
        if (isPast) {
          // For past dates, ONLY count if there's actual worked hours
          // No clock-in data = no hours counted (absence/no-show)
          if (schedule.workedStart && schedule.workedEnd) {
          total += calculateHours(schedule.workedStart, schedule.workedEnd);
          }
          // If no worked hours, don't count anything (0 hours)
        } else {
          // For future dates and today, use scheduled hours
          if (schedule.scheduledStart && schedule.scheduledEnd) {
          total += calculateHours(schedule.scheduledStart, schedule.scheduledEnd);
          }
        }
      }
    });
    
    // Round total to nearest 0.25 (15 minutes)
    const roundedTotal = Math.round(total * 4) / 4;
    
    return roundedTotal.toFixed(2);
  };

  // Filter employees
  const filteredEmployees = selectedDepartment === 'All'
    ? employees
    : employees.filter(emp => emp.department === selectedDepartment);

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  return (
    <div className="h-full flex gap-2 p-2 bg-gray-50">
      {/* Left Side - Calendar (Collapsible) */}
      <div className={`bg-white rounded-lg shadow-md transition-all duration-300 ${isSidebarCollapsed ? 'w-12' : 'w-56'} overflow-hidden flex-shrink-0`}>
        <div className={`h-full flex flex-col ${isSidebarCollapsed ? 'p-1' : 'p-3'}`}>
        {!isSidebarCollapsed ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded">
                <ChevronLeft size={18} />
              </button>
              <h3 className="font-semibold text-gray-800 text-sm">{monthName}</h3>
              <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded">
                <ChevronRight size={18} />
              </button>
            </div>

        <div className="grid grid-cols-7 gap-1 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center text-xs font-semibold text-gray-600 py-1">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {monthDays.map((day, index) => {
            const holiday = day ? isHoliday(day) : null;
            const dateStr = day ? day.toISOString().split('T')[0] : '';
            const hasSwappedSchedule = day ? schedules.some(s => s.date === dateStr && s.swappedWith) : false;
            
            return (
              <button
                key={index}
                onClick={() => day && setSelectedDate(new Date(day))}
                disabled={!day}
                className={`
                  aspect-square flex flex-col items-center justify-center text-sm rounded relative
                  ${!day ? 'invisible' : ''}
                  ${day && isSameDay(day, selectedDate) ? 'bg-blue-600 text-white font-bold' : ''}
                  ${day && isInSelectedWeek(day) && !isSameDay(day, selectedDate) ? 'bg-blue-100 text-blue-800 font-medium' : ''}
                  ${day && !isInSelectedWeek(day) && !holiday ? 'hover:bg-gray-100' : ''}
                  ${day && isSameDay(day, new Date()) && !isSameDay(day, selectedDate) ? 'border-2 border-blue-600' : ''}
                  ${holiday && day && !isSameDay(day, selectedDate) ? 'bg-red-50 text-red-700 font-semibold' : ''}
                  ${holiday && day && !isSameDay(day, selectedDate) ? 'hover:bg-red-100' : ''}
                `}
                title={holiday ? holiday.name : ''}
              >
                {day && (
                  <>
                    <span className={holiday && !isSameDay(day, selectedDate) ? 'text-red-600' : ''}>
                      {day.getDate()}
                    </span>
                    {holiday && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-red-500 rounded-full"></span>
                    )}
                    {hasSwappedSchedule && (
                      <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-purple-500 rounded-full" title="Has swapped schedule"></span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Holiday Legend */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs font-semibold text-gray-700 mb-1.5">
            This Month's Holidays
          </div>
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {holidays
              .filter(h => {
                const holidayDate = new Date(h.date);
                return holidayDate.getMonth() === currentMonth.getMonth() && 
                       holidayDate.getFullYear() === currentMonth.getFullYear();
              })
              .map((holiday, idx) => {
                const holidayDate = new Date(holiday.date);
                return (
                  <div 
                    key={idx}
                    className="text-xs text-gray-600 flex items-start gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded"
                    onClick={() => setSelectedDate(holidayDate)}
                  >
                    <span className="font-semibold text-red-600 min-w-[20px]">
                      {holidayDate.getDate()}
                    </span>
                    <span className="flex-1">{holiday.name}</span>
                  </div>
                );
              })}
            {holidays.filter(h => {
              const holidayDate = new Date(h.date);
              return holidayDate.getMonth() === currentMonth.getMonth() && 
                     holidayDate.getFullYear() === currentMonth.getFullYear();
            }).length === 0 && (
              <div className="text-xs text-gray-400 italic">
                No holidays this month
              </div>
            )}
          </div>
        </div>

        {/* Calendar Legend */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs font-semibold text-gray-700 mb-1.5">
            Legend
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-2 h-2 bg-red-500 rounded-full"></span>
              <span>Holiday</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
              <span>Swapped Shift</span>
            </div>
          </div>
        </div>

        {/* Bi-Weekly Schedule Button */}
        <div className="mt-4">
          <button
            onClick={openBiWeeklyModal}
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Calendar size={16} />
            Set 2-Week Schedule
          </button>
        </div>

        {/* Shift Swaps Button */}
        <div className="mt-2">
          <button
            onClick={openShiftSwapModal}
            className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 2.1l4 4-4 4"/>
              <path d="M3 12.2l4 4 4-4"/>
              <path d="M21 6.1h-14"/>
              <path d="M7 16.2h14"/>
            </svg>
            Shift Swaps
          </button>
        </div>

        {/* Time Off Request Button */}
        <div className="mt-2">
          <button
            onClick={openTimeOffModal}
            className="w-full px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
              <path d="M8 14h.01"/>
              <path d="M12 14h.01"/>
              <path d="M16 14h.01"/>
              <path d="M8 18h.01"/>
              <path d="M12 18h.01"/>
              <path d="M16 18h.01"/>
            </svg>
            Time Off Request
          </button>
        </div>

        {/* View Results Button */}
        <div className="mt-2">
          <button
            onClick={() => setShowResultsModal(true)}
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
          >
            <BarChart3 size={16} />
            View Results
          </button>
        </div>
        </>
        ) : null}

        {/* Toggle Sidebar Button - Always at the same position */}
        <div className="mt-auto pt-3 border-t border-gray-200">
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className={`w-full ${isSidebarCollapsed ? 'px-1 py-2' : 'px-3 py-1.5'} bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors flex items-center justify-center`}
            title={isSidebarCollapsed ? '펼치기' : '접기'}
          >
            {isSidebarCollapsed ? (
              <ChevronRight size={18} />
            ) : (
              <ChevronLeft size={16} />
            )}
          </button>
        </div>
        </div>
      </div>

      {/* Right Side - Schedule Table */}
      <div className="flex-1 bg-white rounded-lg shadow-md p-3 overflow-hidden">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Weekly Schedule</h2>
            <p className="text-xs text-gray-600 mt-0.5">
              {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          {/* Department Filter */}
          <div className="flex gap-1.5">
            {departments.map(dept => (
              <button
                key={dept}
                onClick={() => setSelectedDepartment(dept)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedDepartment === dept
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {dept}
              </button>
            ))}
          </div>
                </div>

        {/* Schedule Table */}
        <div className="overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b-2 border-gray-200">
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10" style={{ minWidth: '80px', width: '80px' }}>
                  Employee
                </th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 bg-gray-50" style={{ minWidth: '55px', width: '55px' }}>
                  Role
                </th>
                {weekDates.map((date, index) => (
                  <th key={index} className="px-2 py-1.5 text-center text-sm font-semibold text-gray-700 min-w-[130px] bg-gray-100">
                    <div>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index]}</div>
                    <div className="text-xs font-normal text-gray-500">
                      {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </th>
                ))}
                <th className="px-2 py-1.5 text-center text-xs font-semibold text-gray-700 bg-gray-50" style={{ minWidth: '75px', width: '75px' }}>
                  Weekly Hours
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredEmployees.map(employee => (
                <tr key={employee.id} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 sticky left-0 bg-white z-10" style={{ width: '80px' }}>
                    <div className="font-medium text-sm text-gray-900 leading-tight">
                      {(() => {
                        const nameParts = employee.name.split(' ');
                        const firstName = nameParts[0];
                        const lastName = nameParts.slice(1).join(' ');
                        return (
                          <>
                            <div>{firstName}</div>
                            {lastName && <div>{lastName}</div>}
                          </>
                        );
                      })()}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 bg-white" style={{ width: '55px' }}>
                    <div className="text-xs text-gray-600">{employee.role}</div>
                  </td>
                  {weekDates.map((date, index) => {
                    const dateStr = date.toISOString().split('T')[0];
                    const schedule = schedules.find(s => s.employeeId === employee.id && s.date === dateStr);
                    const timeOffRequest = timeOffRequests.find(
                      r => r.employeeId === employee.id && 
                           r.startDate <= dateStr && 
                           r.endDate >= dateStr &&
                           r.status !== 'rejected'
                    );
                    const isPast = isPastDate(date);

                    return (
                      <td 
                        key={index} 
                        className="px-2 py-1.5 text-center cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"
                        onClick={() => !isPast && !timeOffRequest && openEditModal(employee.id, employee.name, dateStr, schedule || null)}
                      >
                        {timeOffRequest ? (
                          <div className="space-y-1">
                            <div className={`text-sm font-medium rounded px-2 py-1 ${
                              timeOffRequest.status === 'pending' ? 'bg-yellow-50 text-yellow-700' :
                              timeOffRequest.status === 'approved' ? 'bg-gray-200 text-gray-600' :
                              'bg-red-50 text-red-700'
                            }`}>
                              {timeOffRequest.status === 'pending' && '⏳ Pending'}
                              {timeOffRequest.status === 'approved' && '✓ Time Off'}
                              {timeOffRequest.status === 'rejected' && '✗ Rejected'}
                            </div>
                            {timeOffRequest.reason && (
                              <div className="text-xs text-gray-500 truncate" title={timeOffRequest.reason}>
                                {timeOffRequest.reason}
                              </div>
                            )}
                          </div>
                        ) : schedule ? (
                          <div className="space-y-0.5 relative group">
                            {isPast ? (
                              <>
                                {schedule.workedStart && schedule.workedEnd ? (
                              <>
                                <div className="text-sm font-medium text-green-700">
                                      {schedule.workedStart}–{schedule.workedEnd} ({calculateDuration(schedule.workedStart, schedule.workedEnd)}h)
                                </div>
                                <div className="text-xs text-gray-400">
                                      <span className="opacity-25">⏱️</span> {schedule.scheduledStart}–{schedule.scheduledEnd} ({calculateDuration(schedule.scheduledStart, schedule.scheduledEnd)}h)
                                </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="text-sm font-medium text-orange-700">
                                      Not Worked
                                    </div>
                                    <div className="text-xs text-gray-400">
                                      <span className="opacity-25">⏱️</span> {schedule.scheduledStart}–{schedule.scheduledEnd} ({calculateDuration(schedule.scheduledStart, schedule.scheduledEnd)}h)
                                    </div>
                                  </>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="text-sm font-medium text-blue-700">
                                  ⏱️ {schedule.scheduledStart}–{schedule.scheduledEnd} ({calculateDuration(schedule.scheduledStart, schedule.scheduledEnd)}h)
                                </div>
                                {schedule.swappedWith && schedule.swappedEmployeeName && (
                                  <div className="text-sm text-purple-600 font-semibold flex items-center justify-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M17 2.1l4 4-4 4"/>
                                      <path d="M3 12.2l4 4 4-4"/>
                                      <path d="M21 6.1h-14"/>
                                      <path d="M7 16.2h14"/>
                                    </svg>
                                    {schedule.swappedEmployeeName.split(' ')[0]}
                                  </div>
                                )}
                                <div className="text-xs text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Edit2 size={12} className="inline" /> Click to edit
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="group">
                            {!isPast ? (
                              <>
                                <div className="text-xs text-gray-400 group-hover:text-blue-600 transition-colors">
                                  Off
                                </div>
                                <div className="text-xs text-gray-400 group-hover:text-blue-600 transition-colors mt-1">
                                  <Plus size={12} className="inline" /> Add
                                </div>
                              </>
                            ) : (
                              <div className="text-xs text-gray-400">
                                Off
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center bg-gray-50" style={{ width: '75px' }}>
                    <div className="font-bold text-blue-700 text-sm">
                      {getWeeklyHours(employee.id)}h
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="text-sm text-blue-600 font-medium">Total Employees</div>
            <div className="text-2xl font-bold text-blue-700 mt-1">{filteredEmployees.length}</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <div className="text-sm text-green-600 font-medium">Total Scheduled Hours</div>
            <div className="text-2xl font-bold text-green-700 mt-1">
              {(() => {
                const total = filteredEmployees.reduce((sum, emp) => sum + parseFloat(getWeeklyHours(emp.id)), 0);
                const roundedTotal = Math.round(total * 4) / 4;
                return roundedTotal.toFixed(2);
              })()}h
            </div>
          </div>
          <div className="bg-purple-50 rounded-lg p-4">
            <div className="text-sm text-purple-600 font-medium">Average Hours/Employee</div>
            <div className="text-2xl font-bold text-purple-700 mt-1">
              {(() => {
                if (filteredEmployees.length === 0) return '0.00';
                const total = filteredEmployees.reduce((sum, emp) => sum + parseFloat(getWeeklyHours(emp.id)), 0);
                const average = total / filteredEmployees.length;
                const roundedAverage = Math.round(average * 4) / 4;
                return roundedAverage.toFixed(2);
              })()}h
            </div>
          </div>
        </div>
      </div>

      {/* Schedule Edit Modal */}
      {editModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editModal.schedule ? 'Edit Schedule' : 'Add Schedule'}
              </h3>
              <button 
                onClick={closeEditModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Employee
                </label>
                <div className="text-base text-gray-900 font-medium">
                  {editModal.employeeName}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Date
                </label>
                <div className="text-base text-gray-900 font-medium">
                  {new Date(editModal.date).toLocaleDateString('en-US', { 
                    weekday: 'short', 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={scheduleStart}
                    onChange={(e) => setScheduleStart(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

          <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={scheduleEnd}
                    onChange={(e) => setScheduleEnd(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="pt-2 text-xs text-gray-500">
                Duration: {calculateDuration(scheduleStart, scheduleEnd)} hours
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex items-center justify-between">
              <div>
                {editModal.schedule && (
                  <button
                    onClick={deleteSchedule}
                    className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors flex items-center gap-1"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={closeEditModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSchedule}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bi-Weekly Schedule Modal */}
      {biWeeklyModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">
                  Set 2-Week Schedule
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Configure recurring schedules for 2 weeks
                </p>
              </div>
              
              {/* Department Filter */}
              <div className="flex gap-2 items-center">
                {['All', 'Hall', 'Kitchen', 'Office Staff'].map((dept) => (
                  <button
                    key={dept}
                    onClick={() => setBiWeeklyDepartmentFilter(dept)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      biWeeklyDepartmentFilter === dept
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                    }`}
                  >
                    {dept}
                  </button>
                ))}
              </div>

              <button 
                onClick={closeBiWeeklyModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-2">
              {/* Date Picker Section */}
              <div className="mb-3 p-3 bg-blue-50 border-2 border-blue-200 rounded-lg">
                <label className="block text-base font-semibold text-gray-900 mb-2">
                  📅 Select Start Date for 2-Week Schedule
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={selectedBiWeeklyStartDate.toISOString().split('T')[0]}
                    onChange={(e) => setSelectedBiWeeklyStartDate(new Date(e.target.value))}
                    onClick={(e) => {
                      const input = e.target as HTMLInputElement;
                      try {
                        input.showPicker();
                      } catch (error) {
                        // Fallback for browsers that don't support showPicker
                        input.focus();
                      }
                    }}
                    className="w-full px-6 py-2 border-2 border-gray-300 rounded-lg text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer hover:border-blue-400 transition-colors bg-white"
                    style={{ colorScheme: 'light', fontSize: '1.125rem' }}
                  />
                </div>
                <p className="text-sm text-gray-600 mt-2 font-medium">
                  Starting from <span className="font-semibold text-blue-700">
                    {selectedBiWeeklyStartDate.toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </span> (2 weeks period)
                </p>
              </div>

              {/* Employee Schedules */}
              {employees
                .filter(emp => biWeeklyDepartmentFilter === 'All' || emp.department === biWeeklyDepartmentFilter)
                .map(employee => {
                const employeeSchedules = biWeeklySchedules.filter(s => s.employeeId === employee.id);
                
                return (
                  <div key={employee.id} className="mb-2 border-2 border-gray-400 rounded-lg overflow-hidden shadow-sm">
                    <div className="bg-gray-100 px-3 py-2 border-b border-gray-200 flex items-center gap-3">
                      <h4 className="font-bold text-gray-900 text-base">{employee.name}</h4>
                      <p className="text-sm text-gray-600">{employee.role} - {employee.department}</p>
                    </div>
                    
                    {[1, 2].map(week => {
                      // Calculate weekly hours for this week
                      const weekSchedules = employeeSchedules.filter(s => s.weekNumber === week && s.isWorkDay);
                      const weeklyHours = weekSchedules.reduce((total, s) => {
                        if (s.startTime && s.endTime) {
                          const duration = calculateDuration(s.startTime, s.endTime);
                          return total + (typeof duration === 'number' ? duration : parseFloat(duration) || 0);
                        }
                        return total;
                      }, 0);

                      return (
                        <div key={week} className="p-3 border-b border-gray-200 last:border-b-0">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="font-semibold text-gray-800 text-base">
                              Week {week} <span className="text-blue-700 font-bold ml-2">({weeklyHours}h)</span>
                            </div>
                            <button
                              onClick={() => copySundayTimeToAll(employee.id, week)}
                              className="px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded transition-colors flex items-center gap-1"
                              title="Copy Sunday's time to all work days"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                              </svg>
                              Copy Sun to All
                            </button>
                          </div>
                          <div className="grid grid-cols-7 gap-1.5">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName, dayIndex) => {
                            const schedule = employeeSchedules.find(s => 
                              s.weekNumber === week && s.dayOfWeek === dayIndex
                            );
                            
                            if (!schedule) return null;
                            
                            return (
                              <div 
                                key={dayIndex}
                                className={`border rounded-lg p-1.5 ${
                                  schedule.isWorkDay 
                                    ? 'bg-blue-50 border-blue-300' 
                                    : 'bg-gray-50 border-gray-200'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-semibold text-gray-700">
                                    {dayName}
                                    {schedule.isWorkDay && schedule.startTime && schedule.endTime && (
                                      <span className="text-sm font-medium text-blue-600 ml-1">
                                        ({calculateDuration(schedule.startTime, schedule.endTime)}h)
                                      </span>
                                    )}
                                  </span>
                                  <input
                                    type="checkbox"
                                    checked={schedule.isWorkDay}
                                    onChange={() => toggleBiWeeklyWorkDay(employee.id, week, dayIndex)}
                                    className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                                
                                {schedule.isWorkDay && (
                                  <div className="space-y-1">
                                    <input
                                      type="time"
                                      value={schedule.startTime}
                                      onChange={(e) => updateBiWeeklyTime(employee.id, week, dayIndex, 'startTime', e.target.value)}
                                      className="w-full px-1.5 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                                      placeholder="00:00"
                                    />
                                    <input
                                      type="time"
                                      value={schedule.endTime}
                                      onChange={(e) => updateBiWeeklyTime(employee.id, week, dayIndex, 'endTime', e.target.value)}
                                      className="w-full px-1.5 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                                      placeholder="00:00"
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={closeBiWeeklyModal}
                className="px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={applyBiWeeklySchedules}
                className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
              >
                Apply Schedules
              </button>
          </div>
        </div>
      </div>
      )}

      {/* Shift Swap Modal */}
      {shiftSwapModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className={`bg-white rounded-lg shadow-xl w-full overflow-hidden flex flex-col ${
            shiftSwapModal.step === 1 ? 'max-w-4xl h-[80vh]' : 'max-w-4xl max-h-[90vh]'
          }`}>
            <div className="px-6 py-4 border-b border-gray-200 bg-purple-50">
              <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-600">
                  <path d="M17 2.1l4 4-4 4"/>
                  <path d="M3 12.2l4 4 4-4"/>
                  <path d="M21 6.1h-14"/>
                  <path d="M7 16.2h14"/>
                </svg>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">
                      Shift {shiftSwapModal.mode === 'swap' ? 'Swap' : 'Give'}
                  </h3>
                  <p className="text-sm text-gray-600 mt-0.5">
                    {shiftSwapModal.step === 1 && "Step 1: Select first employee"}
                      {shiftSwapModal.step === 2 && shiftSwapModal.mode === 'swap' && "Step 2: Select schedules for both employees"}
                      {shiftSwapModal.step === 2 && shiftSwapModal.mode === 'give' && "Step 2: Select schedule to give and recipient"}
                      {shiftSwapModal.step === 3 && "Step 3: Review and choose approval status"}
                  </p>
                </div>
              </div>
              <button 
                onClick={closeShiftSwapModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} />
              </button>
              </div>
              
              {/* Mode Selection Buttons */}
              {shiftSwapModal.step === 1 && (
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => setShiftSwapModal({ ...shiftSwapModal, mode: 'swap' })}
                    className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                      shiftSwapModal.mode === 'swap'
                        ? 'bg-purple-600 text-white'
                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    🔄 Shift Swap
                    <div className="text-xs mt-0.5 opacity-80">Exchange schedules</div>
                  </button>
                  <button
                    onClick={() => setShiftSwapModal({ ...shiftSwapModal, mode: 'give' })}
                    className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                      shiftSwapModal.mode === 'give'
                        ? 'bg-purple-600 text-white'
                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    🎁 Shift Give
                    <div className="text-xs mt-0.5 opacity-80">Give to off-day employee</div>
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* Step 1: Select First Employee */}
              {shiftSwapModal.step === 1 && (
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 mb-4">Select the first employee</h4>
                  <div className="grid grid-cols-5 gap-3">
                    {employees.map(emp => {
                      const empSchedules = schedules.filter(s => s.employeeId === emp.id);
                      return (
                        <button
                          key={emp.id}
                          onClick={() => selectFirstEmployee(emp)}
                          className="p-2 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-center group"
                        >
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                              {emp.name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div>
                              <div className="font-semibold text-xs text-gray-900 group-hover:text-purple-600 leading-tight">{emp.name}</div>
                              <div className="text-xs text-gray-600 mt-0.5">{emp.role}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{empSchedules.length} shifts</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 2: Select Both Schedules - Combined View */}
              {shiftSwapModal.step === 2 && shiftSwapModal.firstEmployee && (() => {
                const firstEmployeeSchedules = schedules
                      .filter(s => s.employeeId === shiftSwapModal.firstEmployee!.id)
                  .filter(s => !isPastDate(new Date(s.date)));
                
                const secondEmployeeSchedules = shiftSwapModal.secondEmployee
                  ? schedules
                      .filter(s => s.employeeId === shiftSwapModal.secondEmployee!.id)
                      .filter(s => !isPastDate(new Date(s.date)))
                  : [];

                const today = new Date();
                const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
                const year = currentMonth.getFullYear();
                const month = currentMonth.getMonth();
                const firstDay = new Date(year, month, 1);
                const lastDay = new Date(year, month + 1, 0);
                const daysInMonth = lastDay.getDate();
                const startingDayOfWeek = firstDay.getDay();
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

                        return (
                            <div>
                    <div className="grid grid-cols-2 gap-4">
                    {/* Left Side - First Employee Schedule */}
                    <div className="flex flex-col">
                      {/* Fixed Height Employee Info Card */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2 h-32 flex flex-col">
                        <div className="text-sm text-blue-800 font-semibold">Shift Swap Requester</div>
                        <div className="text-lg font-bold text-gray-900">{shiftSwapModal.firstEmployee.name}</div>
                        <div className="text-sm text-gray-600">{shiftSwapModal.firstEmployee.role}</div>
                        {shiftSwapModal.firstSchedule && (
                          <div className="mt-auto pt-1.5 border-t border-blue-200">
                            <div className="text-xs text-gray-900">
                              {formatDate(new Date(shiftSwapModal.firstSchedule.date))} | {shiftSwapModal.firstSchedule.scheduledStart}~{shiftSwapModal.firstSchedule.scheduledEnd}
                              </div>
                              </div>
                        )}
                            </div>

                      {/* Calendar Title */}
                      <h4 className="text-base font-semibold text-gray-800 mb-1.5 text-center h-6">
                        {shiftSwapModal.firstSchedule ? 'Selected' : 'Select'}
                      </h4>

                      {/* First Employee Calendar */}
                      <div className="bg-white rounded-lg border border-gray-200 p-2.5">
                        <div className="text-center mb-1.5">
                          <h3 className="text-lg font-bold text-gray-900">{monthNames[month]} {year}</h3>
                        </div>
                        <div className="grid grid-cols-7 gap-1 mb-1">
                          {dayNames.map(day => (
                            <div key={day} className="text-center text-xs font-semibold text-gray-600 py-1">
                              {day}
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {Array.from({ length: startingDayOfWeek }).map((_, index) => (
                            <div key={`empty-${index}`} className="h-14"></div>
                          ))}
                          {Array.from({ length: daysInMonth }).map((_, dayIndex) => {
                            const day = dayIndex + 1;
                            const date = new Date(year, month, day);
                            const dateString = date.toISOString().split('T')[0];
                            const daySchedule = firstEmployeeSchedules.find(s => s.date === dateString);
                            const isToday = date.toDateString() === today.toDateString();
                            const isPast = date < today && !isToday;
                            const isSelected = shiftSwapModal.firstSchedule?.date === dateString;
                            
                            // Show preview: If this is the second employee's selected date, show it with light lime green
                            // But NOT in GIVE mode (because the first employee's shift is being removed, not swapped)
                            const isSwapPreview = shiftSwapModal.mode === 'swap' && 
                                                  shiftSwapModal.showPreview && 
                                                  shiftSwapModal.secondSchedule?.date === dateString;

                              return (
                              <button
                                key={day}
                                disabled={!daySchedule || isPast}
                                onClick={() => daySchedule && selectFirstSchedule(daySchedule)}
                                className={`h-14 p-1 rounded border transition-all ${
                                  isPast
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200'
                                    : isSwapPreview
                                    ? 'border-lime-400 bg-lime-100 ring-1 ring-lime-300'
                                    : isSelected
                                    ? 'border-blue-600 bg-blue-200 ring-1 ring-blue-400'
                                    : daySchedule
                                    ? 'border-blue-400 bg-blue-100 hover:bg-blue-200 hover:border-blue-600 cursor-pointer'
                                    : 'border-gray-200 bg-white cursor-default'
                                } ${isToday && !isSelected && !isSwapPreview ? 'ring-1 ring-orange-400' : ''}`}
                              >
                                <div className={`text-xs font-bold mb-0.5 ${
                                  isPast ? 'text-gray-400' : isSwapPreview ? 'text-lime-900' : daySchedule ? 'text-blue-900' : 'text-gray-600'
                                }`}>
                                  {day}
                                </div>
                                {!isPast && (
                                  <div className={`text-[10px] font-semibold leading-tight ${
                                    isSwapPreview ? 'text-lime-800' : 'text-blue-800'
                                  }`}>
                                    {isSwapPreview && shiftSwapModal.secondSchedule ? (
                                      <>
                                        {shiftSwapModal.secondSchedule.scheduledStart}
                                        <br />
                                        {shiftSwapModal.secondSchedule.scheduledEnd}
                                      </>
                                    ) : daySchedule ? (
                                      <>
                                        {daySchedule.scheduledStart}
                                        <br />
                                        {daySchedule.scheduledEnd}
                                      </>
                                    ) : null}
                              </div>
                            )}
                          </button>
                        );
                      })}
                  </div>
                </div>
                    </div>

                    {/* Right Side - Second Employee Selection & Schedule */}
                    <div className="flex flex-col">
                      {/* Fixed Height Employee Selection Card */}
                      <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 mb-2 h-32 flex flex-col">
                        <div className="text-sm text-green-800 font-semibold mb-1">
                          {shiftSwapModal.mode === 'swap' ? 'Shift Swap Recipient' : 'Shift Give Recipient'}
                    </div>
                        
                        {!shiftSwapModal.firstSchedule ? (
                          <div className="flex-1 flex items-center justify-center">
                            <div className="text-center text-gray-400">
                              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto opacity-30">
                                <path d="M12 2v20M2 12h20"/>
                              </svg>
                              <p className="text-xs font-medium">먼저 왼쪽에서 스케줄 선택</p>
                  </div>
                          </div>
                        ) : (
                          <>
                            {/* Employee Dropdown Selection */}
                            <select
                              value={shiftSwapModal.secondEmployee?.id || ''}
                              onChange={(e) => {
                                const emp = employees.find(emp => emp.id === e.target.value);
                                if (emp) {
                                  setShiftSwapModal({
                                    ...shiftSwapModal,
                                    secondEmployee: emp,
                                    secondSchedule: null
                                  });
                                }
                              }}
                              className="w-full px-2 py-1.5 text-sm border border-green-300 rounded bg-white text-gray-900 font-medium focus:outline-none focus:ring-1 focus:ring-green-400 mb-1"
                            >
                              <option value="">직원 선택...</option>
                              {employees
                                .filter(emp => emp.id !== shiftSwapModal.firstEmployee!.id)
                                .map(emp => (
                                  <option key={emp.id} value={emp.id}>
                                    {emp.name} - {emp.role}
                                  </option>
                                ))}
                            </select>

                            {shiftSwapModal.secondEmployee && (
                              <>
                                <div className="text-xs text-gray-600 mb-1">
                                  {shiftSwapModal.secondEmployee.role}
                                </div>
                                {shiftSwapModal.secondSchedule && (
                                  <div className="mt-auto pt-1.5 border-t border-green-200">
                                    <div className="text-xs text-gray-900">
                                      {formatDate(new Date(shiftSwapModal.secondSchedule.date))} | {shiftSwapModal.secondSchedule.scheduledStart}~{shiftSwapModal.secondSchedule.scheduledEnd}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>

                      {/* Calendar Title - Same position as left */}
                      <h4 className="text-base font-semibold text-gray-800 mb-1.5 text-center h-6">
                        {shiftSwapModal.secondSchedule ? 'Selected' : shiftSwapModal.secondEmployee ? 'Select' : '\u00A0'}
                  </h4>

                      {/* Second Employee Calendar - Same position as left */}
                      {shiftSwapModal.firstSchedule && shiftSwapModal.secondEmployee ? (
                        <div className="bg-white rounded-lg border border-gray-200 p-2.5">
                          <div className="text-center mb-1.5">
                            <h3 className="text-lg font-bold text-gray-900">{monthNames[month]} {year}</h3>
                          </div>
                          <div className="grid grid-cols-7 gap-1 mb-1">
                            {dayNames.map(day => (
                              <div key={day} className="text-center text-xs font-semibold text-gray-600 py-1">
                                {day}
                              </div>
                            ))}
                          </div>
                          <div className="grid grid-cols-7 gap-1">
                            {Array.from({ length: startingDayOfWeek }).map((_, index) => (
                              <div key={`empty-${index}`} className="h-14"></div>
                            ))}
                            {Array.from({ length: daysInMonth }).map((_, dayIndex) => {
                              const day = dayIndex + 1;
                              const date = new Date(year, month, day);
                              const dateString = date.toISOString().split('T')[0];
                              const daySchedule = secondEmployeeSchedules.find(s => s.date === dateString);
                              const isToday = date.toDateString() === today.toDateString();
                              const isPast = date < today && !isToday;
                              const isSelected = shiftSwapModal.secondSchedule?.date === dateString;
                              
                              // In GIVE mode, off days are clickable and highlighted
                              const isOffDay = !daySchedule && !isPast;
                              const isGiveMode = shiftSwapModal.mode === 'give';
                              
                              // Show preview: If this is the first employee's selected date, show it with light sky blue
                              const isSwapPreview = shiftSwapModal.showPreview && 
                                                    shiftSwapModal.firstSchedule?.date === dateString;

                              return (
                                <button
                                  key={day}
                                  disabled={isGiveMode ? !isOffDay : (!daySchedule || isPast)}
                                  onClick={() => {
                                    if (isGiveMode && isOffDay && shiftSwapModal.firstSchedule) {
                                      // In GIVE mode, create a virtual schedule for the off day
                                      const virtualSchedule: Schedule = {
                                        employeeId: shiftSwapModal.secondEmployee!.id,
                                        employeeName: shiftSwapModal.secondEmployee!.name,
                                        date: dateString,
                                        scheduledStart: shiftSwapModal.firstSchedule.scheduledStart,
                                        scheduledEnd: shiftSwapModal.firstSchedule.scheduledEnd,
                                        status: 'scheduled' as const
                                      };
                                      
                                      // Update second schedule
                                      const newModal = {
                                        ...shiftSwapModal,
                                        secondSchedule: virtualSchedule
                                      };
                                      setShiftSwapModal(newModal);
                                      
                                      // Show preview after 100ms
                                      setTimeout(() => {
                                        setShiftSwapModal(prev => ({
                                          ...prev,
                                          showPreview: true
                                        }));
                                      }, 100);
                                    } else if (!isGiveMode && daySchedule && shiftSwapModal.secondEmployee) {
                                      // SWAP mode: Update second schedule
                                      const newModal = {
                                        ...shiftSwapModal,
                                        secondSchedule: daySchedule
                                      };
                                      setShiftSwapModal(newModal);
                                      
                                      // Show preview after 0.1 second
                                      setTimeout(() => {
                                        setShiftSwapModal(prev => ({
                                          ...prev,
                                          showPreview: true
                                        }));
                                      }, 100);
                                    }
                                  }}
                                  className={`h-14 p-1 rounded border transition-all ${
                                    isPast
                                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200'
                                      : isSwapPreview
                                      ? 'border-sky-400 bg-sky-100 ring-1 ring-sky-300'
                                      : isSelected
                                      ? isGiveMode
                                        ? 'border-green-600 bg-green-200 ring-1 ring-green-400'
                                        : 'border-green-600 bg-green-200 ring-1 ring-green-400'
                                      : isGiveMode && isOffDay
                                      ? 'border-green-400 bg-green-50 hover:bg-green-100 hover:border-green-600 cursor-pointer'
                                      : !isGiveMode && daySchedule
                                      ? 'border-green-400 bg-green-100 hover:bg-green-200 hover:border-green-600 cursor-pointer'
                                      : 'border-gray-200 bg-white cursor-default'
                                  } ${isToday && !isSelected && !isSwapPreview ? 'ring-1 ring-orange-400' : ''}`}
                                >
                                  <div className={`text-xs font-bold mb-0.5 ${
                                    isPast ? 'text-gray-400' : isSwapPreview ? 'text-sky-900' : isGiveMode && isOffDay ? 'text-green-700' : daySchedule ? 'text-green-900' : 'text-gray-600'
                                  }`}>
                                    {day}
                                    </div>
                                  {!isPast && (
                                    <div className={`text-[10px] font-semibold leading-tight ${
                                      isSwapPreview ? 'text-sky-800' : isGiveMode && isOffDay ? 'text-green-700' : 'text-green-800'
                                    }`}>
                                      {isSwapPreview && shiftSwapModal.firstSchedule ? (
                                        <>
                                          {shiftSwapModal.firstSchedule.scheduledStart}
                                          <br />
                                          {shiftSwapModal.firstSchedule.scheduledEnd}
                                        </>
                                      ) : isGiveMode && isOffDay ? (
                                        <span className="text-[9px]">OFF</span>
                                      ) : daySchedule ? (
                                        <>
                                          {daySchedule.scheduledStart}
                                          <br />
                                          {daySchedule.scheduledEnd}
                                        </>
                                      ) : null}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white rounded-lg border border-gray-200 p-2.5 opacity-30">
                          <div className="text-center mb-1.5">
                            <h3 className="text-lg font-bold text-gray-400">{monthNames[month]} {year}</h3>
                          </div>
                          <div className="grid grid-cols-7 gap-1 mb-1">
                            {dayNames.map(day => (
                              <div key={day} className="text-center text-xs font-semibold text-gray-400 py-1">
                                {day}
                              </div>
                            ))}
                          </div>
                          <div className="grid grid-cols-7 gap-1">
                            {Array.from({ length: startingDayOfWeek }).map((_, index) => (
                              <div key={`empty-${index}`} className="h-14"></div>
                            ))}
                            {Array.from({ length: daysInMonth }).map((_, dayIndex) => {
                              const day = dayIndex + 1;
                              return (
                                <div
                                  key={day}
                                  className="h-14 p-1 rounded border border-gray-200 bg-white"
                                >
                                  <div className="text-xs font-bold text-gray-400">
                                    {day}
                          </div>
                        </div>
                      );
                    })}
                          </div>
                </div>
              )}
                    </div>
                  </div>
                  
                  {/* Action Buttons - Show when both schedules are selected and preview is visible */}
                  {shiftSwapModal.showPreview && shiftSwapModal.firstSchedule && shiftSwapModal.secondSchedule && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-center gap-3">
                        <button
                          onClick={() => {
                            executeSwap('approved');
                            closeShiftSwapModal();
                          }}
                          className="flex items-center gap-2 px-6 py-3 bg-green-500 text-white rounded hover:bg-green-600 transition-colors text-base font-medium shadow-sm hover:shadow"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            executeSwap('pending');
                            closeShiftSwapModal();
                          }}
                          className="flex items-center gap-2 px-6 py-3 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors text-base font-medium shadow-sm hover:shadow"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                          </svg>
                          Pending
                        </button>
                        <button
                          onClick={() => {
                            // Just save as rejected without executing swap
                            if (!shiftSwapModal.firstEmployee || !shiftSwapModal.firstSchedule || 
                                !shiftSwapModal.secondEmployee || !shiftSwapModal.secondSchedule) return;

                            const request: ShiftSwapRequest = {
                              id: Date.now().toString(),
                              firstEmployeeId: shiftSwapModal.firstEmployee.id,
                              firstEmployeeName: shiftSwapModal.firstEmployee.name,
                              firstScheduleDate: shiftSwapModal.firstSchedule.date,
                              firstScheduleStart: shiftSwapModal.firstSchedule.scheduledStart,
                              firstScheduleEnd: shiftSwapModal.firstSchedule.scheduledEnd,
                              secondEmployeeId: shiftSwapModal.secondEmployee.id,
                              secondEmployeeName: shiftSwapModal.secondEmployee.name,
                              secondScheduleDate: shiftSwapModal.secondSchedule.date,
                              secondScheduleStart: shiftSwapModal.secondSchedule.scheduledStart,
                              secondScheduleEnd: shiftSwapModal.secondSchedule.scheduledEnd,
                              requestDate: new Date().toISOString(),
                              status: 'rejected',
                              createdBy: 'Admin',
                              approver: 'Admin',
                              approvalDate: new Date().toISOString()
                            };

                            // Save to localStorage
                            const existingRequests = JSON.parse(localStorage.getItem('shiftSwapRequests') || '[]');
                            localStorage.setItem('shiftSwapRequests', JSON.stringify([...existingRequests, request]));

                            closeShiftSwapModal();
                          }}
                          className="flex items-center gap-2 px-6 py-3 bg-red-500 text-white rounded hover:bg-red-600 transition-colors text-base font-medium shadow-sm hover:shadow"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                  </div>
                );
              })()}

              {/* Step 3: Review and Choose Status - Calendar View */}
              {shiftSwapModal.step === 3 && shiftSwapModal.firstEmployee && shiftSwapModal.firstSchedule && 
               shiftSwapModal.secondEmployee && shiftSwapModal.secondSchedule && (() => {
                const today = new Date();
                const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
                const year = currentMonth.getFullYear();
                const month = currentMonth.getMonth();
                const firstDay = new Date(year, month, 1);
                const lastDay = new Date(year, month + 1, 0);
                const daysInMonth = lastDay.getDate();
                const startingDayOfWeek = firstDay.getDay();
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

                const firstScheduleDate = shiftSwapModal.firstSchedule.date;
                const secondScheduleDate = shiftSwapModal.secondSchedule.date;

                return (
                <div>
                    <h4 className="text-lg font-semibold text-gray-800 mb-4">
                      {shiftSwapModal.mode === 'swap' ? 'Review and Choose Status' : 'Review Shift Give'}
                    </h4>
                    
                    {/* Calendar Header */}
                    <div className="mb-4 text-center">
                      <h3 className="text-xl font-bold text-gray-900">{monthNames[month]} {year}</h3>
                    </div>

                    {/* Calendar Grid */}
                    <div className="bg-white rounded-lg border border-gray-200 p-3 mb-6">
                      {/* Day Headers */}
                      <div className="grid grid-cols-7 gap-1 mb-1">
                        {dayNames.map(day => (
                          <div key={day} className="text-center text-xs font-semibold text-gray-600 py-1">
                            {day}
                          </div>
                        ))}
                      </div>

                      {/* Calendar Days */}
                      <div className="grid grid-cols-7 gap-1">
                        {/* Empty cells for days before month starts */}
                        {Array.from({ length: startingDayOfWeek }).map((_, index) => (
                          <div key={`empty-${index}`} className="h-16"></div>
                        ))}

                        {/* Days of the month */}
                        {Array.from({ length: daysInMonth }).map((_, dayIndex) => {
                          const day = dayIndex + 1;
                          const date = new Date(year, month, day);
                          const dateString = date.toISOString().split('T')[0];
                          const isFirstSchedule = dateString === firstScheduleDate;
                          const isSecondSchedule = dateString === secondScheduleDate;
                          const isToday = date.toDateString() === today.toDateString();

                          return (
                            <div
                              key={day}
                              className={`h-16 p-1 rounded-lg border-2 transition-all ${
                                isFirstSchedule
                                  ? 'border-blue-500 bg-blue-100'
                                  : isSecondSchedule
                                  ? 'border-green-500 bg-green-100'
                                  : 'border-gray-200 bg-white'
                              } ${isToday ? 'ring-2 ring-orange-400' : ''}`}
                            >
                              <div className={`text-xs font-bold mb-0.5 ${
                                isFirstSchedule ? 'text-blue-900' : isSecondSchedule ? 'text-green-900' : 'text-gray-600'
                              }`}>
                                {day}
                              </div>
                              {isFirstSchedule && shiftSwapModal.firstEmployee && shiftSwapModal.firstSchedule && (
                                <div className="text-[9px] font-bold text-blue-900 leading-tight">
                                  <div className="truncate">{shiftSwapModal.firstEmployee.name}</div>
                                  <div className="text-[8px] font-semibold mt-0.5">
                                    {shiftSwapModal.mode === 'give' ? 'REMOVED' : (
                                      <>
                                        {shiftSwapModal.firstSchedule.scheduledStart}
                                        <br />
                                        {shiftSwapModal.firstSchedule.scheduledEnd}
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                              {isSecondSchedule && shiftSwapModal.secondEmployee && shiftSwapModal.secondSchedule && (
                                <div className="text-[9px] font-bold text-green-900 leading-tight">
                                  <div className="truncate">{shiftSwapModal.secondEmployee.name}</div>
                                  <div className="text-[8px] font-semibold mt-0.5">
                                    {shiftSwapModal.secondSchedule.scheduledStart}
                                    <br />
                                    {shiftSwapModal.secondSchedule.scheduledEnd}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Swap/Give Details */}
                  <div className="space-y-4 mb-6">
                    {/* First Employee */}
                      <div className="bg-blue-50 border-2 border-blue-400 rounded-lg p-4">
                        <div className="text-sm text-blue-800 font-semibold mb-1">
                          {shiftSwapModal.mode === 'swap' ? 'Employee 1:' : 'Giving Employee:'}
                        </div>
                      <div className="text-lg font-bold text-gray-900">{shiftSwapModal.firstEmployee.name}</div>
                        <div className="text-sm text-gray-700 font-semibold">
                        {new Date(shiftSwapModal.firstSchedule.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                        {' '}•{' '}
                          {shiftSwapModal.mode === 'give' 
                            ? 'Shift will be removed' 
                            : `${shiftSwapModal.firstSchedule.scheduledStart} ~ ${shiftSwapModal.firstSchedule.scheduledEnd}`
                          }
                      </div>
                    </div>

                    {/* Swap Arrow */}
                    <div className="flex justify-center">
                        {shiftSwapModal.mode === 'swap' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-600">
                        <path d="M17 2.1l4 4-4 4"/>
                        <path d="M3 12.2l4 4 4-4"/>
                        <path d="M21 6.1h-14"/>
                        <path d="M7 16.2h14"/>
                      </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-600">
                            <path d="M7 17L17 7M17 7H8M17 7v9"/>
                          </svg>
                        )}
                    </div>

                    {/* Second Employee */}
                      <div className="bg-green-50 border-2 border-green-400 rounded-lg p-4">
                        <div className="text-sm text-green-800 font-semibold mb-1">
                          {shiftSwapModal.mode === 'swap' ? 'Employee 2:' : 'Receiving Employee:'}
                        </div>
                      <div className="text-lg font-bold text-gray-900">{shiftSwapModal.secondEmployee.name}</div>
                        <div className="text-sm text-gray-700 font-semibold">
                        {new Date(shiftSwapModal.secondSchedule.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                        {' '}•{' '}
                        {shiftSwapModal.secondSchedule.scheduledStart} ~ {shiftSwapModal.secondSchedule.scheduledEnd}
                      </div>
                    </div>
                  </div>

                  <h5 className="text-md font-semibold text-gray-800 mb-3">Choose approval status:</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => executeSwap('approved')}
                      className="p-6 border-2 border-green-400 rounded-lg bg-green-50 hover:bg-green-100 transition-all text-left"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white">✓</div>
                        <div className="font-bold text-gray-900 text-lg">Approved</div>
                      </div>
                      <div className="text-sm text-gray-600">
                          {shiftSwapModal.mode === 'swap' 
                            ? 'The shift swap will be executed immediately and both employees will be notified.'
                            : 'The shift will be given immediately and both employees will be notified.'
                          }
                      </div>
                      <div className="mt-3 text-xs text-green-700 font-semibold">⭐ DEFAULT OPTION</div>
                    </button>
                    
                    <button
                      onClick={() => executeSwap('pending')}
                      className="p-6 border-2 border-yellow-400 rounded-lg bg-yellow-50 hover:bg-yellow-100 transition-all text-left"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center text-white">⏱</div>
                        <div className="font-bold text-gray-900 text-lg">Pending</div>
                      </div>
                      <div className="text-sm text-gray-600">
                        Save the request for later review. You can approve or reject it from the Shift Swaps menu.
                      </div>
                    </button>
                  </div>
                </div>
                );
              })()}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-between">
              <button
                onClick={shiftSwapModal.step === 1 ? closeShiftSwapModal : goBackSwapStep}
                className="px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded transition-colors"
              >
                {shiftSwapModal.step === 1 ? 'Cancel' : 'Back'}
              </button>
              <div className="text-sm text-gray-500">
                Step {shiftSwapModal.step} of 3
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Time Off Request Modal */}
      {timeOffModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className={`bg-white rounded-lg shadow-xl w-full overflow-hidden flex flex-col ${
            timeOffModal.step === 1 ? 'max-w-4xl h-[80vh]' : 'max-w-4xl max-h-[90vh]'
          }`}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-orange-50">
              <div className="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-600">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <h3 className="text-xl font-semibold text-gray-900">
                  Time Off Request
                </h3>
              </div>
              <button 
                onClick={closeTimeOffModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Step 1: Employee Selection */}
            {timeOffModal.step === 1 && (
              <div className="flex-1 overflow-y-auto p-6">
                {/* Department Filter */}
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-700">Department:</span>
                  {['All', 'Hall', 'Kitchen', 'Office Staff'].map(dept => (
                    <button
                      key={dept}
                      onClick={() => setTimeOffDepartmentFilter(dept)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        timeOffDepartmentFilter === dept
                          ? 'bg-orange-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {dept}
                    </button>
                  ))}
                </div>

                {/* Employee Cards */}
                <div className="grid grid-cols-5 gap-3">
                  {employees
                    .filter(emp => timeOffDepartmentFilter === 'All' || emp.department === timeOffDepartmentFilter)
                    .map(emp => (
                      <button
                        key={emp.id}
                        onClick={() => selectEmployeeForTimeOff(emp)}
                        className="p-2 border-2 border-gray-200 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition-all text-center group"
                      >
                        <div className="flex flex-col items-center gap-1">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold text-sm">
                            {emp.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div>
                            <div className="font-semibold text-xs text-gray-900 group-hover:text-orange-600 leading-tight">{emp.name}</div>
                            <div className="text-xs text-gray-600 mt-0.5">{emp.role}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Step 2: 2-Column Layout (Type/Duration/Reason + Calendar) */}
            {timeOffModal.step === 2 && (
              <div className="flex-1 overflow-hidden flex">
              {/* Left Column - Form */}
              <div className="w-1/2 border-r border-gray-200 overflow-y-auto p-6">
                <div className="space-y-6">
                  {/* Selected Employee Display */}
                  {timeOffModal.selectedEmployee && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold">
                        {timeOffModal.selectedEmployee.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{timeOffModal.selectedEmployee.name}</div>
                        <div className="text-sm text-gray-600">{timeOffModal.selectedEmployee.role} · {timeOffModal.selectedEmployee.department}</div>
                      </div>
                    </div>
                  )}

                  {/* Type Selection */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Time Off Type</label>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Paid Vacation */}
                      <button
                        onClick={() => {
                          setTimeOffModal({ ...timeOffModal, selectedType: 'paid-vacation' });
                          setTimeOffReason('');
                        }}
                        className={`p-3 border-2 rounded-lg text-left transition-all ${
                          timeOffModal.selectedType === 'paid-vacation'
                            ? 'border-green-500 bg-green-50'
                            : 'border-gray-200 hover:border-green-300 hover:bg-green-50'
                        }`}
                      >
                        <span className="font-semibold text-sm">Paid Vacation</span>
                      </button>

                      {/* Unpaid Vacation */}
                      <button
                        onClick={() => setTimeOffModal({ ...timeOffModal, selectedType: 'unpaid-vacation' })}
                        className={`p-3 border-2 rounded-lg text-left transition-all ${
                          timeOffModal.selectedType === 'unpaid-vacation'
                            ? 'border-yellow-500 bg-yellow-50'
                            : 'border-gray-200 hover:border-yellow-300 hover:bg-yellow-50'
                        }`}
                      >
                        <span className="font-semibold text-sm">Unpaid Vacation</span>
                      </button>

                      {/* Paid Sick Leave */}
                      <button
                        onClick={() => {
                          setTimeOffModal({ ...timeOffModal, selectedType: 'paid-sick' });
                          setTimeOffReason('');
                        }}
                        className={`p-3 border-2 rounded-lg text-left transition-all ${
                          timeOffModal.selectedType === 'paid-sick'
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        <span className="font-semibold text-sm">Paid Sick Leave</span>
                      </button>

                      {/* Unpaid Sick Leave */}
                      <button
                        onClick={() => setTimeOffModal({ ...timeOffModal, selectedType: 'unpaid-sick' })}
                        className={`p-3 border-2 rounded-lg text-left transition-all ${
                          timeOffModal.selectedType === 'unpaid-sick'
                            ? 'border-red-500 bg-red-50'
                            : 'border-gray-200 hover:border-red-300 hover:bg-red-50'
                        }`}
                      >
                        <span className="font-semibold text-sm">Unpaid Sick Leave</span>
                      </button>
                    </div>
                  </div>

                  {/* Full Day / Partial Toggle */}
                  {timeOffModal.selectedType && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">⏰ Time Off Duration</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => setIsPartialTimeOff(false)}
                          className={`p-3 border-2 rounded-lg text-left transition-all ${
                            !isPartialTimeOff
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              !isPartialTimeOff ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                            }`}>
                              {!isPartialTimeOff && (
                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              )}
                            </div>
                            <span className="font-semibold text-sm">Full Day Off</span>
                          </div>
                        </button>

                        <button
                          onClick={() => setIsPartialTimeOff(true)}
                          className={`p-3 border-2 rounded-lg text-left transition-all ${
                            isPartialTimeOff
                              ? 'border-orange-500 bg-orange-50'
                              : 'border-gray-200 hover:border-orange-300 hover:bg-orange-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              isPartialTimeOff ? 'border-orange-500 bg-orange-500' : 'border-gray-300'
                            }`}>
                              {isPartialTimeOff && (
                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              )}
                            </div>
                            <span className="font-semibold text-sm">Partial Day Off</span>
                          </div>
                        </button>
                      </div>

                      {/* Partial Time Selection */}
                      {isPartialTimeOff && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">
                                Off Start Time
                              </label>
                              <input
                                type="time"
                                value={partialStartTime}
                                onChange={(e) => setPartialStartTime(e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">
                                Off End Time
                              </label>
                              <input
                                type="time"
                                value={partialEndTime}
                                onChange={(e) => setPartialEndTime(e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Reason */}
                  {timeOffModal.selectedType && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        {(timeOffModal.selectedType === 'unpaid-vacation' || timeOffModal.selectedType === 'unpaid-sick') 
                          ? 'Reason (Required) ⚠️' 
                          : 'Reason (Optional)'}
                      </label>
                      <textarea
                        value={timeOffReason}
                        onChange={(e) => setTimeOffReason(e.target.value)}
                        placeholder={
                          (timeOffModal.selectedType === 'unpaid-vacation' || timeOffModal.selectedType === 'unpaid-sick')
                            ? 'Please enter the reason (required for unpaid time off)...'
                            : 'Enter reason for time off request (optional)...'
                        }
                        rows={4}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-sm ${
                          (timeOffModal.selectedType === 'unpaid-vacation' || timeOffModal.selectedType === 'unpaid-sick')
                            ? 'border-red-300 focus:ring-red-500'
                            : 'border-gray-300 focus:ring-orange-500'
                        }`}
                      />
                      {(timeOffModal.selectedType === 'unpaid-vacation' || timeOffModal.selectedType === 'unpaid-sick') && (
                        <p className="text-xs text-red-600 mt-1">* Reason is required for unpaid time off</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column - Calendar */}
              <div className="w-1/2 overflow-y-auto p-6 bg-gray-50">
                {timeOffModal.selectedEmployee && timeOffModal.selectedType ? (
                  <div>
                    {/* Calendar - Date Range Selector */}
                    <div className="border border-gray-300 rounded-lg p-3 bg-white">
                      {/* Calendar Header */}
                      <div className="flex items-center justify-between mb-3">
                        <button 
                          onClick={() => setTimeOffCalendarMonth(new Date(timeOffCalendarMonth.getFullYear(), timeOffCalendarMonth.getMonth() - 1))}
                          className="p-0.5 hover:bg-gray-100 rounded"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <h3 className="text-sm font-semibold text-gray-800">
                          {timeOffCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                        </h3>
                        <button 
                          onClick={() => setTimeOffCalendarMonth(new Date(timeOffCalendarMonth.getFullYear(), timeOffCalendarMonth.getMonth() + 1))}
                          className="p-0.5 hover:bg-gray-100 rounded"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>

                      {/* Calendar Grid */}
                      <div className="grid grid-cols-7 gap-0.5 mb-1">
                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                          <div key={`${day}-${idx}`} className="text-center text-xs font-semibold text-gray-600 py-1">
                            {day}
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-7 gap-0.5">
                        {(() => {
                          const year = timeOffCalendarMonth.getFullYear();
                          const month = timeOffCalendarMonth.getMonth();
                          const firstDay = new Date(year, month, 1);
                          const lastDay = new Date(year, month + 1, 0);
                          const startPadding = firstDay.getDay();
                          const days: (Date | null)[] = [];
                          
                          // Add padding for days before month starts
                          for (let i = 0; i < startPadding; i++) {
                            days.push(null);
                          }
                          
                          // Add all days in month
                          for (let day = 1; day <= lastDay.getDate(); day++) {
                            days.push(new Date(year, month, day));
                          }
                          
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          
                          return days.map((day, index) => {
                            if (!day) {
                              return <div key={`empty-${index}`} className="w-full aspect-square" />;
                            }
                            
                            const dateStr = day.toISOString().split('T')[0];
                            const isPast = day < today;
                            const isStartDate = selectedStartDate === dateStr;
                            const isEndDate = selectedEndDate === dateStr;
                            const isInRange = selectedStartDate && selectedEndDate && 
                              dateStr >= selectedStartDate && dateStr <= selectedEndDate;
                            
                            // Find schedule for this date
                            const daySchedule = timeOffModal.selectedEmployee 
                              ? schedules.find(s => s.employeeId === timeOffModal.selectedEmployee!.id && s.date === dateStr)
                              : null;
                            
                            return (
                              <button
                                key={dateStr}
                                onClick={() => {
                                  if (isPast) return;
                                  
                                  // If no start date or both are set, set as new start date
                                  if (!selectedStartDate || (selectedStartDate && selectedEndDate)) {
                                    setSelectedStartDate(dateStr);
                                    setSelectedEndDate('');
                                  } 
                                  // If start date is set but no end date
                                  else if (selectedStartDate && !selectedEndDate) {
                                    if (dateStr >= selectedStartDate) {
                                      setSelectedEndDate(dateStr);
                                    } else {
                                      // If selected date is before start, swap them
                                      setSelectedEndDate(selectedStartDate);
                                      setSelectedStartDate(dateStr);
                                    }
                                  }
                                }}
                                disabled={isPast}
                                className={`
                                  w-full aspect-square flex flex-col items-center justify-center text-xs rounded relative p-1
                                  ${isPast ? 'text-gray-300 cursor-not-allowed bg-gray-50' : 'cursor-pointer'}
                                  ${isStartDate || isEndDate ? 'bg-orange-600 text-white font-bold' : ''}
                                  ${isInRange && !isStartDate && !isEndDate ? 'bg-orange-100 text-orange-800' : ''}
                                  ${!isPast && !isInRange && daySchedule ? 'bg-blue-50 hover:bg-blue-100' : ''}
                                  ${!isPast && !isInRange && !daySchedule ? 'hover:bg-gray-100' : ''}
                                  ${daySchedule && !isStartDate && !isEndDate ? 'border border-blue-300' : ''}
                                `}
                              >
                                <div className="font-semibold">{day.getDate()}</div>
                                {daySchedule && !isStartDate && !isEndDate && (
                                  <div className={`text-xs leading-tight ${isPast ? 'text-gray-400' : 'text-blue-700 font-medium'}`}>
                                    <div>{daySchedule.scheduledStart.substring(0, 5)}</div>
                                    <div>{daySchedule.scheduledEnd.substring(0, 5)}</div>
                                  </div>
                                )}
                              </button>
                            );
                          });
                        })()}
                      </div>

                      {/* Selected Period Display */}
                      {selectedStartDate && selectedEndDate && timeOffModal.selectedEmployee && (
                        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-xs text-blue-800 font-semibold">Selected Period:</div>
                              <div className="text-xs font-medium text-gray-900 mt-0.5">
                                {new Date(selectedStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                {' ~ '}
                                {new Date(selectedEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-blue-800 font-semibold">Working Days:</div>
                              <div className="text-xl font-bold text-blue-700">
                                {calculateWorkDaysInRange(timeOffModal.selectedEmployee.id, selectedStartDate, selectedEndDate)} days
                              </div>
                    </div>
                  </div>
                </div>
              )}

                      {/* Instruction */}
                      {!selectedStartDate && (
                        <div className="mt-2 text-xs text-gray-500 text-center">
                          Click a date to select start date
                        </div>
                      )}
                      {selectedStartDate && !selectedEndDate && (
                        <div className="mt-2 text-xs text-gray-500 text-center">
                          Click another date to select end date
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                    <div className="text-center">
                      <Calendar size={48} className="mx-auto mb-3 opacity-30" />
                      <p>Select employee and type to choose dates</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-between">
              {timeOffModal.step === 1 ? (
                <>
                  <div></div>
                  <button
                    onClick={closeTimeOffModal}
                    className="px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setTimeOffModal({ ...timeOffModal, step: 1 })}
                    className="px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded transition-colors"
                  >
                    Back
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        submitTimeOffRequest('rejected');
                      }}
                      disabled={!timeOffModal.selectedEmployee || !timeOffModal.selectedType || !selectedStartDate || !selectedEndDate || 
                        ((timeOffModal.selectedType === 'unpaid-vacation' || timeOffModal.selectedType === 'unpaid-sick') && !timeOffReason.trim())}
                      className="px-6 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded transition-colors"
                    >
                      Reject
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        submitTimeOffRequest('pending');
                      }}
                      disabled={!timeOffModal.selectedEmployee || !timeOffModal.selectedType || !selectedStartDate || !selectedEndDate || 
                        ((timeOffModal.selectedType === 'unpaid-vacation' || timeOffModal.selectedType === 'unpaid-sick') && !timeOffReason.trim())}
                      className="px-6 py-2 text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded transition-colors"
                    >
                      Pending
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        submitTimeOffRequest('approved');
                      }}
                      disabled={!timeOffModal.selectedEmployee || !timeOffModal.selectedType || !selectedStartDate || !selectedEndDate || 
                        ((timeOffModal.selectedType === 'unpaid-vacation' || timeOffModal.selectedType === 'unpaid-sick') && !timeOffReason.trim())}
                      className="px-6 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded transition-colors"
                    >
                      Approve
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Request Results Modal */}
      {showResultsModal && (
        <RequestResultsModal onClose={() => setShowResultsModal(false)} />
      )}
    </div>
  );
};

export default WorkSchedulePage; 
