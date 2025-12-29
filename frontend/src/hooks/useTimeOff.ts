import { useState } from 'react';
import { timeOffApi } from '../services/workScheduleApi';
import type { Employee, TimeOffRequest } from './useWorkScheduleData';

export interface TimeOffModal {
  isOpen: boolean;
  step: 1 | 2;
  selectedEmployee: Employee | null;
  selectedType: 'paid-vacation' | 'unpaid-vacation' | 'paid-sick' | 'unpaid-sick' | null;
}

export const useTimeOff = (
  timeOffRequests: TimeOffRequest[],
  setTimeOffRequests: (requests: TimeOffRequest[]) => void
) => {
  const [timeOffModal, setTimeOffModal] = useState<TimeOffModal>({
    isOpen: false,
    step: 1,
    selectedEmployee: null,
    selectedType: null
  });

  const [timeOffReason, setTimeOffReason] = useState('');
  const [selectedStartDate, setSelectedStartDate] = useState('');
  const [selectedEndDate, setSelectedEndDate] = useState('');
  const [isPartialTimeOff, setIsPartialTimeOff] = useState(false);
  const [partialStartTime, setPartialStartTime] = useState('09:00');
  const [partialEndTime, setPartialEndTime] = useState('13:00');

  // Open time off modal
  const openTimeOffModal = () => {
    setTimeOffModal({
      isOpen: true,
      step: 1,
      selectedEmployee: null,
      selectedType: null
    });
    resetTimeOffForm();
  };

  // Close time off modal
  const closeTimeOffModal = () => {
    setTimeOffModal({
      isOpen: false,
      step: 1,
      selectedEmployee: null,
      selectedType: null
    });
    resetTimeOffForm();
  };

  // Reset time off form
  const resetTimeOffForm = () => {
    setTimeOffReason('');
    setSelectedStartDate('');
    setSelectedEndDate('');
    setIsPartialTimeOff(false);
    setPartialStartTime('09:00');
    setPartialEndTime('13:00');
  };

  // Select employee for time off
  const selectTimeOffEmployee = (employee: Employee) => {
    setTimeOffModal({
      ...timeOffModal,
      selectedEmployee: employee,
      step: 2
    });
  };

  // Select time off type
  const selectTimeOffType = (type: 'paid-vacation' | 'unpaid-vacation' | 'paid-sick' | 'unpaid-sick') => {
    setTimeOffModal({
      ...timeOffModal,
      selectedType: type
    });
  };

  // Go back in modal steps
  const goBackTimeOffStep = () => {
    if (timeOffModal.step > 1) {
      setTimeOffModal({
        ...timeOffModal,
        step: (timeOffModal.step - 1) as 1 | 2
      });
    }
  };

  // Calculate work days between two dates
  const calculateWorkDays = (startDate: string, endDate: string): number => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    let workDays = 0;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        workDays++;
      }
    }

    return workDays;
  };

  // Submit time off request
  const submitTimeOffRequest = async (status: 'pending' | 'approved' = 'pending') => {
    if (!timeOffModal.selectedEmployee || !timeOffModal.selectedType || !selectedStartDate || !selectedEndDate) {
      alert('Please fill in all required fields');
      return;
    }

    try {
      const workDaysCount = isPartialTimeOff ? 0.5 : calculateWorkDays(selectedStartDate, selectedEndDate);

      const requestData = {
        id: `TO${Date.now()}`,
        employeeId: timeOffModal.selectedEmployee.id,
        employeeName: timeOffModal.selectedEmployee.name,
        type: timeOffModal.selectedType,
        startDate: selectedStartDate,
        endDate: selectedEndDate,
        reason: timeOffReason,
        status: status,
        requestedDate: new Date().toISOString(),
        approver: status === 'approved' ? 'Admin' : undefined,
        approvedDate: status === 'approved' ? new Date().toISOString() : undefined,
        isPartial: isPartialTimeOff,
        partialStartTime: isPartialTimeOff ? partialStartTime : undefined,
        partialEndTime: isPartialTimeOff ? partialEndTime : undefined
      };

      // Save to backend
      await timeOffApi.create(requestData);
      console.log('✅ Time off request saved to backend');

      // Update local state
      const newRequest: TimeOffRequest = {
        id: requestData.id,
        employeeId: requestData.employeeId,
        employeeName: requestData.employeeName,
        type: requestData.type,
        startDate: requestData.startDate,
        endDate: requestData.endDate,
        reason: requestData.reason,
        status: requestData.status,
        requestDate: requestData.requestedDate,
        approver: requestData.approver,
        approvalDate: requestData.approvedDate,
        approvalReason: undefined,
        isPartial: requestData.isPartial,
        partialStartTime: requestData.partialStartTime,
        partialEndTime: requestData.partialEndTime,
        workDaysCount
      };
      setTimeOffRequests([...timeOffRequests, newRequest]);
      localStorage.setItem('timeOffRequests', JSON.stringify([...timeOffRequests, newRequest]));

      closeTimeOffModal();
      alert(`Time off request ${status === 'approved' ? 'approved' : 'submitted'} successfully!`);
    } catch (error) {
      console.error('Error submitting time off request:', error);
      alert('Failed to submit time off request. Please try again.');
    }
  };

  return {
    timeOffModal,
    setTimeOffModal,
    timeOffReason,
    setTimeOffReason,
    selectedStartDate,
    setSelectedStartDate,
    selectedEndDate,
    setSelectedEndDate,
    isPartialTimeOff,
    setIsPartialTimeOff,
    partialStartTime,
    setPartialStartTime,
    partialEndTime,
    setPartialEndTime,
    openTimeOffModal,
    closeTimeOffModal,
    selectTimeOffEmployee,
    selectTimeOffType,
    goBackTimeOffStep,
    submitTimeOffRequest,
    calculateWorkDays
  };
};

