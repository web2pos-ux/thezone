import { useState } from 'react';
import { shiftSwapsApi } from '../services/workScheduleApi';
import type { Employee, Schedule, ShiftSwapRequest } from './useWorkScheduleData';

export interface ShiftSwapModal {
  isOpen: boolean;
  step: 1 | 2 | 3;
  firstEmployee: Employee | null;
  firstSchedule: Schedule | null;
  secondEmployee: Employee | null;
  secondSchedule: Schedule | null;
  showPreview?: boolean;
  mode: 'swap' | 'give';
}

export const useShiftSwap = (
  schedules: Schedule[],
  setSchedules: (schedules: Schedule[]) => void,
  shiftSwapRequests: ShiftSwapRequest[],
  setShiftSwapRequests: (requests: ShiftSwapRequest[]) => void
) => {
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

  // Open shift swap modal
  const openShiftSwapModal = () => {
    setShiftSwapModal({
      isOpen: true,
      step: 1,
      firstEmployee: null,
      firstSchedule: null,
      secondEmployee: null,
      secondSchedule: null,
      showPreview: false,
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
      firstEmployee: employee,
      step: 2
    });
  };

  // Select first employee's schedule
  const selectFirstSchedule = (schedule: Schedule) => {
    setShiftSwapModal({
      ...shiftSwapModal,
      firstSchedule: schedule
    });
  };

  // Select second employee
  const selectSecondEmployee = (employee: Employee) => {
    setShiftSwapModal({
      ...shiftSwapModal,
      secondEmployee: employee
    });
  };

  // Select second employee's schedule
  const selectSecondSchedule = (schedule: Schedule) => {
    setShiftSwapModal({
      ...shiftSwapModal,
      secondSchedule: schedule,
      showPreview: true
    });
  };

  // Go back in modal steps
  const goBackSwapStep = () => {
    if (shiftSwapModal.step > 1) {
      setShiftSwapModal({
        ...shiftSwapModal,
        step: (shiftSwapModal.step - 1) as 1 | 2 | 3,
        showPreview: false
      });
    }
  };

  // Execute swap/give and save to backend
  const executeSwap = async (status: 'pending' | 'approved' = 'approved') => {
    if (!shiftSwapModal.firstEmployee || !shiftSwapModal.firstSchedule ||
        !shiftSwapModal.secondEmployee || !shiftSwapModal.secondSchedule) {
      return;
    }

    try {
      // Create request data
      const requestData = {
        id: `SS${Date.now()}`,
        employee1Id: shiftSwapModal.firstEmployee.id,
        employee1Name: shiftSwapModal.firstEmployee.name,
        employee1Date: shiftSwapModal.firstSchedule.date,
        employee1Time: shiftSwapModal.firstSchedule.scheduledStart,
        employee2Id: shiftSwapModal.secondEmployee.id,
        employee2Name: shiftSwapModal.secondEmployee.name,
        employee2Date: shiftSwapModal.secondSchedule.date,
        employee2Time: shiftSwapModal.secondSchedule.scheduledStart,
        status: status,
        mode: shiftSwapModal.mode,
        requestedDate: new Date().toISOString(),
        approver: status === 'approved' ? 'Admin' : undefined,
        approvedDate: status === 'approved' ? new Date().toISOString() : undefined,
        notes: `${shiftSwapModal.mode === 'swap' ? 'Shift Swap' : 'Shift Give'} request`
      };

      // Save to backend
      await shiftSwapsApi.create(requestData);
      console.log('✅ Shift swap/give saved to backend');

      // Update shift swap requests list
      const newRequest: ShiftSwapRequest = {
        id: requestData.id,
        firstEmployeeId: requestData.employee1Id,
        firstEmployeeName: requestData.employee1Name,
        firstScheduleDate: requestData.employee1Date,
        firstScheduleStart: requestData.employee1Time,
        firstScheduleEnd: shiftSwapModal.firstSchedule.scheduledEnd,
        secondEmployeeId: requestData.employee2Id,
        secondEmployeeName: requestData.employee2Name,
        secondScheduleDate: requestData.employee2Date,
        secondScheduleStart: requestData.employee2Time,
        secondScheduleEnd: shiftSwapModal.secondSchedule.scheduledEnd,
        requestDate: requestData.requestedDate,
        status: requestData.status,
        createdBy: 'Admin',
        approvalDate: requestData.approvedDate,
        approver: requestData.approver,
      };
      setShiftSwapRequests([...shiftSwapRequests, newRequest]);

      // If approved, update schedules immediately
      if (status === 'approved') {
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
          localStorage.setItem('workSchedules', JSON.stringify(updatedSchedules));
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
          localStorage.setItem('workSchedules', JSON.stringify(updatedSchedules));
        }
      }

      closeShiftSwapModal();
      alert(`${shiftSwapModal.mode === 'swap' ? 'Shift swap' : 'Shift give'} ${status === 'approved' ? 'completed' : 'request created'} successfully!`);
    } catch (error) {
      console.error('Error executing shift swap/give:', error);
      alert('Failed to save shift swap/give. Please try again.');
    }
  };

  return {
    shiftSwapModal,
    setShiftSwapModal,
    openShiftSwapModal,
    closeShiftSwapModal,
    selectFirstEmployee,
    selectFirstSchedule,
    selectSecondEmployee,
    selectSecondSchedule,
    goBackSwapStep,
    executeSwap
  };
};

