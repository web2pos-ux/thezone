import React, { useState, useEffect, useCallback, useRef } from 'react';
import Notification from '../components/Notification';
import { API_URL } from '../config/constants';
import { INTRO_SCREEN_LOGIN_PERMISSION } from '../constants/introScreenLoginPermission';

// Types
interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  role: string;
  pin: string;
  status: 'Active' | 'Inactive';
  hireDate: string;
  permissionGroup: string;
  contactPhone: string;
  email: string;
  wageType: 'Hourly' | 'Salary';
  hourlyRate?: number;
  defaultServiceArea: string;
  emergencyContact: string;
  notes: string;
}

interface RoleInfo {
  role: string;
  description: string;
  permissions: string;
}

interface PermissionCategory {
  category: string;
  permissions: { name: string; level: number }[];
}

// 자동 생성 Employee ID (EMP5200-EMP8999 범위)
const generateEmployeeId = () => {
  return `EMP${5200 + Math.floor(Math.random() * 3800)}`;
};

const sampleEmployeeTemplates = [
  {
    name: 'Aiden Lee',
    role: 'Server / Cashier',
    pin: '2415',
    phone: '(555) 111-2233',
    email: 'aiden.lee@example.com'
  },
  {
    name: 'Bella Kim',
    role: 'Manager',
    pin: '7722',
    phone: '(555) 222-3344',
    email: 'bella.kim@example.com'
  },
  {
    name: 'Chris Park',
    role: 'Kitchen / Bar',
    pin: '9087',
    phone: '(555) 333-4455',
    email: 'chris.park@example.com'
  }
];

const normalizeName = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();

const formatNameForDisplay = (value?: string) => {
  const normalized = normalizeName(value);
  if (!normalized) return '';
  const first = normalized.charAt(0).toUpperCase();
  const rest = normalized.slice(1).toLowerCase();
  return first + rest;
};

const formatNameWithUserIntent = (value?: string) => formatNameForDisplay(value);

const getRoleLevelDisplay = (role: string): string => {
  switch (role) {
    case 'Owner': return '5 - Owner/Admin';
    case 'Manager': return '4 - Manager';
    case 'Supervisor': return '3 - Supervisor';
    case 'Server': return '2 - Server/Cashier';
    case 'Kitchen': return '1 - Kitchen/Bar';
    default: return `2 - ${role}`;
  }
};

const DAY_CLOSE_MIN_LEVEL_KEY = 'perm_reports_day_close_level';
const PERMISSION_LEVELS_KEY = 'employee_permission_levels_v1';
const clampLevel = (n: any, fallback: number) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(5, Math.max(1, Math.round(v)));
};

const EmployeeInfoPage = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deletedEmployees, setDeletedEmployees] = useState<Employee[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeletedModal, setShowDeletedModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete' | 'permanent';
    employeeId: string;
    employeeName: string;
  } | null>(null);
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [tempPermissions, setTempPermissions] = useState<{ [key: string]: number }>({});
  const [permissionOverrides, setPermissionOverrides] = useState<Record<string, Record<string, number>>>({});
  const [editingPin, setEditingPin] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState<string>(generateEmployeeId());
  const [formData, setFormData] = useState<Partial<Employee>>({
    status: 'Active',
    wageType: 'Hourly',
    role: 'Server',
    defaultServiceArea: 'Hall',
    hireDate: new Date().toISOString().split('T')[0], // Today's date as default
    pin: ''
  });

  const isPinDuplicateForRole = useCallback((pin?: string, role?: string, excludeId?: string) => {
    if (!pin || !role) return false;
    const targetRole = role.trim().toLowerCase();
    const targetPin = pin.trim();
    return employees.some(emp => {
      if (emp.id === excludeId) return false;
      const empRole = (emp.role || '').toLowerCase();
      const empPin = emp.pin || '';
      return empRole === targetRole && empPin === targetPin;
    });
  }, [employees]);

  // Role 설명 데이터
  const roleDefinitions: RoleInfo[] = [
    {
      role: 'Owner / Admin',
      description: '전체 시스템 제어',
      permissions: '메뉴 수정, 보고서, 가격 관리, 직원/권한 관리'
    },
    {
      role: 'Manager',
      description: '운영 관리',
      permissions: 'Void 승인, 할인 승인, 테이블 이동/병합'
    },
    {
      role: 'Supervisor',
      description: '실시간 운영 보조',
      permissions: '캐셔 정산, 재발행, 웨이터 관리'
    },
    {
      role: 'Server / Cashier',
      description: '주문 및 결제',
      permissions: '주문 입력, Split, 결제 (일부 제한)'
    },
    {
      role: 'Kitchen / Bar',
      description: '주방 작업',
      permissions: 'KDS 보기, 상태 변경, Void 요청'
    }
  ];

  // Permission 카테고리 정의
  const permissionCategories: PermissionCategory[] = [
    {
      category: 'Order',
      permissions: [
        { name: 'Create Order', level: 1 },
        { name: 'Edit Order', level: 2 },
        { name: 'Transfer Table', level: 3 },
        { name: 'Merge Table', level: 3 },
        { name: 'Split Order', level: 2 },
        { name: 'Void Order', level: 3 }
      ]
    },
    {
      category: 'Payment',
      permissions: [
        { name: 'Process Payment', level: 1 },
        { name: 'Apply Discount', level: 3 },
        { name: 'Refund', level: 4 },
        { name: 'Adjust Tips', level: 2 },
        { name: 'Reprint Receipt', level: 2 },
        { name: 'Gift Card Sell', level: 4 }
      ]
    },
    {
      category: 'Reports',
      permissions: [
        { name: 'View Reports', level: 2 },
        { name: 'Export Reports', level: 3 },
        { name: 'Day Close', level: 4 }
      ]
    },
    {
      category: 'Menu Settings',
      permissions: [
        { name: 'Edit Price', level: 4 },
        { name: 'Add Items', level: 4 },
        { name: 'Hide Items', level: 3 }
      ]
    },
    {
      category: 'Employee',
      permissions: [
        { name: 'Add/Remove Employee', level: 5 },
        { name: 'Change PIN', level: 4 },
        { name: 'View Labor Reports', level: 3 }
      ]
    },
    {
      category: 'POS Operations',
      permissions: [
        { name: 'Printer Test', level: 3 },
        { name: 'Table Layout Edit', level: 4 },
        { name: 'Reservation Settings', level: 3 },
        { name: INTRO_SCREEN_LOGIN_PERMISSION.name, level: INTRO_SCREEN_LOGIN_PERMISSION.defaultLevel }
      ]
    },
    {
      category: 'Kitchen',
      permissions: [
        { name: 'Mark Complete', level: 1 },
        { name: 'Hold/Fire Item', level: 2 }
      ]
    }
  ];

  // Notification state
  const [notification, setNotification] = useState<{
    show: boolean;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
  }>({
    show: false,
    type: 'info',
    message: ''
  });
  const addFirstNameInputRef = useRef<HTMLInputElement | null>(null);
  const editFirstNameInputRef = useRef<HTMLInputElement | null>(null);

  // Show notification helper
  const showNotification = (type: 'success' | 'error' | 'warning' | 'info', message: string) => {
    setNotification({ show: true, type, message });
  };

  // Close notification helper
  const closeNotification = () => {
    setNotification({ ...notification, show: false });
  };

  // Helper function to format phone number
  const formatPhoneNumber = (value: string) => {
    // Remove all non-digit characters
    const cleaned = value.replace(/\D/g, '');
    
    // Limit to 10 digits
    const limited = cleaned.slice(0, 10);
    
    // Format as (xxx) xxx-xxxx
    if (limited.length <= 3) {
      return limited;
    } else if (limited.length <= 6) {
      return `(${limited.slice(0, 3)}) ${limited.slice(3)}`;
    } else {
      return `(${limited.slice(0, 3)}) ${limited.slice(3, 6)}-${limited.slice(6)}`;
    }
  };

  // Load employees
  useEffect(() => {
    loadEmployees();
  }, []);

  // Load saved permission levels (local persistence)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PERMISSION_LEVELS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      const next: Record<string, Record<string, number>> = {};
      Object.entries(parsed).forEach(([cat, perms]) => {
        if (!cat || typeof perms !== 'object' || perms == null) return;
        const bucket: Record<string, number> = {};
        Object.entries(perms as any).forEach(([permName, lvl]) => {
          if (!permName) return;
          bucket[String(permName)] = clampLevel(lvl, 0);
        });
        next[String(cat)] = bucket;
      });
      setPermissionOverrides(next);
    } catch (e) {
      console.warn('Failed to load saved permissions:', e);
    }
  }, []);

  const getEffectivePermissionLevel = (categoryName: string, permName: string, defaultLevel: number) => {
    try {
      const saved = permissionOverrides?.[categoryName]?.[permName];
      if (typeof saved === 'number' && Number.isFinite(saved) && saved >= 1 && saved <= 5) return saved;
      // Backward-compat: Day Close min level key
      if (categoryName === 'Reports' && permName === 'Day Close') {
        const legacy = clampLevel(localStorage.getItem(DAY_CLOSE_MIN_LEVEL_KEY), defaultLevel);
        return legacy;
      }
    } catch {}
    return defaultLevel;
  };

  useEffect(() => {
    if (showAddModal) {
      setTimeout(() => {
        addFirstNameInputRef.current?.focus();
      }, 0);
    }
  }, [showAddModal]);

  useEffect(() => {
    if (showEditModal) {
      setTimeout(() => {
        editFirstNameInputRef.current?.focus();
      }, 0);
    }
  }, [showEditModal]);

  const loadEmployees = async () => {
    try {
      const response = await fetch(`${API_URL}/work-schedule/employees`);
      if (!response.ok) throw new Error('Failed to load employees');
      const data = await response.json();
      
      // Transform backend data to frontend format
      const transformedEmployees: Employee[] = data.map((emp: any) => ({
        id: emp.id,
        firstName: formatNameForDisplay(emp.name.split(' ')[0] || emp.name || ''),
        lastName: formatNameForDisplay(emp.name.split(' ').slice(1).join(' ')),
        employeeId: emp.id,
        role: emp.role,
        pin: emp.pin || '',
        status: emp.status === 'active' ? 'Active' : 'Inactive',
        hireDate: emp.hire_date || '',
        permissionGroup: emp.role,
        contactPhone: emp.phone || '',
        email: emp.email || '',
        wageType: 'Hourly' as 'Hourly' | 'Salary',
        hourlyRate: undefined,
        defaultServiceArea: emp.department || 'Hall',
        emergencyContact: '',
        notes: ''
      }));
      
      setEmployees(transformedEmployees);
    } catch (error) {
      console.error('Error loading employees:', error);
      showNotification('error', 'Failed to load employees.\nPlease check your server connection.');
    }
  };

  const handleAddEmployee = async () => {
    try {
      const formattedFirstName = formatNameWithUserIntent(formData.firstName);
      const formattedLastName = formatNameWithUserIntent(formData.lastName);
      const fullName = `${formattedFirstName} ${formattedLastName}`.trim();
      
      // Validation
      if (!formattedFirstName) {
        showNotification('warning', 'First Name is required.');
        return;
      }
      if (!formData.pin) {
        showNotification('warning', 'PIN is required.');
        return;
      }
      
      // Use the generated employee ID from state
      const employeeData = {
        id: newEmployeeId,
        name: fullName,
        role: formData.role || 'Server',
        department: formData.defaultServiceArea || 'Hall',
        email: formData.email || '',
        phone: formData.contactPhone || '',
        hire_date: formData.hireDate || new Date().toISOString().split('T')[0],
        pin: formData.pin
      };

      if (isPinDuplicateForRole(employeeData.pin, employeeData.role)) {
        showNotification('warning', '동일한 Role에서 이미 사용 중인 PIN입니다. 다른 PIN을 입력해주세요.');
        return;
      }

      if (isPinDuplicateForRole(formData.pin, employeeData.role)) {
        showNotification('warning', '동일한 Role에서 이미 사용 중인 PIN입니다. 다른 PIN을 입력해주세요.');
        return;
      }

      const response = await fetch(`${API_URL}/work-schedule/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employeeData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to add employee');
      }
      
      await loadEmployees(); // Reload the list
      setShowAddModal(false);
      setFormData({ 
        status: 'Active', 
        wageType: 'Hourly', 
        role: 'Server', 
        defaultServiceArea: 'Hall',
        hireDate: new Date().toISOString().split('T')[0],
        pin: ''
      });
      setNewEmployeeId(generateEmployeeId()); // Generate new ID for next employee
      showNotification('success', 'Employee added successfully.');
    } catch (error) {
      console.error('Error adding employee:', error);
      showNotification('error', `Failed to add employee.\n\n${error instanceof Error ? error.message : 'Please check your server connection.'}`);
    }
  };

  const handleEditEmployee = async () => {
    if (!selectedEmployee) return;
    
    try {
      const formattedFirstName = formatNameWithUserIntent(formData.firstName);
      const formattedLastName = formatNameWithUserIntent(formData.lastName);
      const fullName = `${formattedFirstName} ${formattedLastName}`.trim();
      const sanitizedPin = (formData.pin || '').trim();
      
      if (!sanitizedPin) {
        showNotification('warning', 'PIN is required.');
        return;
      }
      
      const updateData = {
        name: fullName,
        role: formData.role,
        department: formData.defaultServiceArea,
        email: formData.email,
        phone: formData.contactPhone,
        status: formData.status === 'Active' ? 'active' : 'inactive',
        pin: sanitizedPin
      };

      if (isPinDuplicateForRole(sanitizedPin, formData.role, selectedEmployee.id)) {
        showNotification('warning', '동일한 Role에서 이미 사용 중인 PIN입니다. 다른 PIN을 입력해주세요.');
        return;
      }

      const response = await fetch(`${API_URL}/work-schedule/employees/${selectedEmployee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update employee');
      }
      
      await loadEmployees(); // Reload the list
      setShowEditModal(false);
      setSelectedEmployee(null);
      setFormData({ 
        status: 'Active', 
        wageType: 'Hourly', 
        role: 'Server', 
        defaultServiceArea: 'Hall',
        hireDate: new Date().toISOString().split('T')[0],
        pin: ''
      });
      showNotification('success', 'Employee updated successfully.');
    } catch (error) {
      console.error('Error updating employee:', error);
      showNotification('error', `Failed to update employee.\n\n${error instanceof Error ? error.message : 'Please check your server connection.'}`);
    }
  };

  const handleDeleteEmployee = (id: string) => {
    const employeeToDelete = employees.find(emp => emp.id === id);
    if (employeeToDelete) {
      const employeeName = `${employeeToDelete.firstName} ${employeeToDelete.lastName}`;
      setConfirmAction({
        type: 'delete',
        employeeId: id,
        employeeName: employeeName
      });
      setShowConfirmModal(true);
    }
  };

  const handleRestoreEmployee = async (id: string) => {
    const employeeToRestore = deletedEmployees.find(emp => emp.id === id);
    if (employeeToRestore) {
      try {
        // Restore by setting status back to active
        const response = await fetch(`${API_URL}/work-schedule/employees/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to restore employee');
        }
        
        // Move back to active employees
        setEmployees([...employees, employeeToRestore]);
        // Remove from deleted employees
        setDeletedEmployees(deletedEmployees.filter(emp => emp.id !== id));
        showNotification('success', `${employeeToRestore.firstName} ${employeeToRestore.lastName} has been restored successfully.`);
      } catch (error) {
        console.error('Error restoring employee:', error);
        showNotification('error', `Failed to restore employee.\n\n${error instanceof Error ? error.message : 'Please check your server connection.'}`);
      }
    }
  };

  const handlePermanentDelete = (id: string) => {
    const employeeToDelete = deletedEmployees.find(emp => emp.id === id);
    if (employeeToDelete) {
      const employeeName = `${employeeToDelete.firstName} ${employeeToDelete.lastName}`;
      setConfirmAction({
        type: 'permanent',
        employeeId: id,
        employeeName: employeeName
      });
      setShowConfirmModal(true);
    }
  };

  const confirmDelete = async () => {
    if (!confirmAction) return;

    try {
      if (confirmAction.type === 'delete') {
        // Soft delete - mark as inactive in backend
        const response = await fetch(`${API_URL}/work-schedule/employees/${confirmAction.employeeId}`, {
          method: 'DELETE'
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to delete employee');
        }
        
        const employeeToDelete = employees.find(emp => emp.id === confirmAction.employeeId);
        if (employeeToDelete) {
          setDeletedEmployees([...deletedEmployees, employeeToDelete]);
          setEmployees(employees.filter(emp => emp.id !== confirmAction.employeeId));
        }
      } else if (confirmAction.type === 'permanent') {
        // Permanent delete from local state only (backend already soft deleted)
        setDeletedEmployees(deletedEmployees.filter(emp => emp.id !== confirmAction.employeeId));
      }

      setShowConfirmModal(false);
      setConfirmAction(null);
      showNotification('success', 'Employee deleted successfully.');
    } catch (error) {
      console.error('Error deleting employee:', error);
      showNotification('error', `Failed to delete employee.\n\n${error instanceof Error ? error.message : 'Please check your server connection.'}`);
      setShowConfirmModal(false);
      setConfirmAction(null);
    }
  };

  const cancelDelete = () => {
    setShowConfirmModal(false);
    setConfirmAction(null);
  };

  const openEditModal = (employee: Employee) => {
    const normalized = {
      ...employee,
      firstName: formatNameForDisplay(employee.firstName),
      lastName: formatNameForDisplay(employee.lastName)
    };
    setSelectedEmployee(normalized);
    setFormData(normalized);
    setShowEditModal(true);
  };

  const toggleEmployeeDetails = (employee: Employee) => {
    if (expandedEmployeeId === employee.id) {
      setExpandedEmployeeId(null);
      setEditingPin(false);
    } else {
      setExpandedEmployeeId(employee.id);
      setSelectedEmployee(employee);
      setFormData(employee);
      setEditingPin(false);
    }
  };

  const handleUpdatePin = async () => {
    if (!selectedEmployee) return;
    
    const sanitizedPin = (formData.pin || '').trim();
    if (!sanitizedPin) {
      showNotification('warning', 'PIN을 입력해주세요.');
      return;
    }
    
    if (isPinDuplicateForRole(sanitizedPin, selectedEmployee.role, selectedEmployee.id)) {
      showNotification('warning', '동일한 Role에서 이미 사용 중인 PIN입니다. 다른 PIN을 입력해주세요.');
      return;
    }
    
    try {
      const endpoints = [
        {
          url: `${API_URL}/work-schedule/employees/${selectedEmployee.id}/pin`,
          body: { pin: sanitizedPin }
        },
        {
          url: `${API_URL}/work-schedule/employees/${selectedEmployee.id}`,
          body: { pin: sanitizedPin }
        }
      ];
      let updated: any = null;
      let lastError: string | null = null;

      for (let i = 0; i < endpoints.length; i++) {
        const { url, body } = endpoints[i];
        const response = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (response.ok) {
          updated = await response.json();
          break;
        }

        const errorData = await response.json().catch(() => ({}));
        lastError = errorData.error || 'Failed to update PIN';
        // If not 404 or this was the last attempt, throw immediately
        if (response.status !== 404 || i === endpoints.length - 1) {
          throw new Error(lastError || 'Failed to update PIN');
        }
      }

      if (!updated) {
        throw new Error(lastError || 'Failed to update PIN');
      }

      setEmployees(employees.map(emp => 
        emp.id === selectedEmployee.id 
          ? { ...emp, pin: updated.pin || sanitizedPin }
          : emp
      ));
      setSelectedEmployee(prev => prev ? { ...prev, pin: updated.pin || sanitizedPin } : prev);
      setFormData(prev => ({ ...prev, pin: updated.pin || sanitizedPin }));
      setEditingPin(false);
      showNotification('success', 'PIN updated successfully.');
    } catch (error) {
      console.error('Error updating PIN:', error);
      showNotification('error', `Failed to update PIN.\n\n${error instanceof Error ? error.message : 'Please check your server connection.'}`);
    }
  };

  const openPermissionModal = (categoryName: string) => {
    setSelectedCategory(categoryName);
    const category = permissionCategories.find(cat => cat.category === categoryName);
    if (category) {
      const temp: { [key: string]: number } = {};
      category.permissions.forEach(perm => {
        temp[perm.name] = getEffectivePermissionLevel(categoryName, perm.name, perm.level);
      });
      setTempPermissions(temp);
    }
    setShowPermissionModal(true);
  };

  const closePermissionModal = () => {
    setShowPermissionModal(false);
    setSelectedCategory(null);
    setTempPermissions({});
  };

  const handlePermissionChange = (permName: string, level: number) => {
    setTempPermissions(prev => ({
      ...prev,
      [permName]: level
    }));
  };

  const savePermissions = () => {
    try {
      if (!selectedCategory) return;

      const sanitized: Record<string, number> = {};
      Object.entries(tempPermissions || {}).forEach(([permName, lvl]) => {
        sanitized[String(permName)] = clampLevel(lvl, 0);
      });

      const nextAll: Record<string, Record<string, number>> = {
        ...(permissionOverrides || {}),
        [selectedCategory]: sanitized,
      };

      localStorage.setItem(PERMISSION_LEVELS_KEY, JSON.stringify(nextAll));
      setPermissionOverrides(nextAll);

      // Keep legacy key in sync for POS Day Close gate
      if (selectedCategory === 'Reports') {
        const v = clampLevel(sanitized['Day Close'], 4);
        localStorage.setItem(DAY_CLOSE_MIN_LEVEL_KEY, String(v));
      }

      // Sync to backend so permission levels are enforced server-side (e.g., Void authorization).
      // Best-effort: local persistence is still the primary UX storage.
      try {
        fetch(`${API_URL}/voids/settings/permission-levels`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ levels: nextAll }),
        }).catch(() => {});
      } catch {}

      showNotification('success', `Saved: ${selectedCategory} permissions`);
    } catch (e) {
      console.error('Save permissions failed:', e);
      showNotification('error', 'Failed to save permissions.');
    }
    closePermissionModal();
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Notification */}
      {notification.show && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={closeNotification}
          duration={3000}
        />
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex justify-between items-center">
              <div>
            <h1 className="text-2xl font-bold text-gray-800">Employee Information Management</h1>
            <p className="text-sm text-gray-600 mt-1">Employee information management and permission settings</p>
          </div>
          <button
            onClick={() => setShowDeletedModal(true)}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-semibold flex items-center gap-2"
          >
            <span className="text-lg">🗑️</span>
            Deleted Employees
            {deletedEmployees.length > 0 && (
              <span className="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                {deletedEmployees.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="space-y-6">
          
          {/* Section 1: 직원 목록 */}
          <div className="bg-white rounded-lg shadow-md">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-800">Registered Employee List</h2>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold flex items-center gap-2"
              >
                <span className="text-lg">+</span>
                Add Employee
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">First Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Last Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Employee ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">PIN</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {employees.map((employee) => (
                    <React.Fragment key={employee.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{employee.firstName}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{employee.lastName}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{employee.employeeId}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-semibold">
                            {getRoleLevelDisplay(employee.role)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 font-mono">{employee.pin || '-'}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded-md text-xs font-semibold ${
                            employee.status === 'Active' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {employee.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-center">
                          <button
                            onClick={() => handleDeleteEmployee(employee.id)}
                            className="px-2 py-0.5 text-red-600 hover:text-white bg-white hover:bg-red-600 border border-red-300 rounded text-xs mr-2 transition-colors"
                          >
                            Del
                          </button>
                          <button
                            onClick={() => openEditModal(employee)}
                            className="px-5 py-1 text-white bg-blue-600 hover:bg-blue-700 rounded font-medium text-sm mr-2 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => toggleEmployeeDetails(employee)}
                            className="text-gray-600 hover:text-blue-600 font-medium inline-flex items-center"
                          >
                            <svg 
                              className={`w-5 h-5 transition-transform duration-200 ${expandedEmployeeId === employee.id ? 'rotate-180' : ''}`}
                              fill="none" 
                              stroke="currentColor" 
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                      
                      {/* Accordion Details */}
                      {expandedEmployeeId === employee.id && (
                        <tr>
                          <td colSpan={8} className="px-6 py-3 bg-gradient-to-r from-gray-50 to-gray-100 border-t-2 border-blue-200">
                            <div className="grid grid-cols-4 gap-x-8 gap-y-3 text-sm">
                              <div className="flex items-baseline">
                                <span className="font-bold text-gray-700 text-xs uppercase tracking-wide min-w-[110px]">Permission:</span>
                                <span className="ml-2 text-gray-900 font-medium">{employee.permissionGroup}</span>
                              </div>
                              <div className="flex items-baseline">
                                <span className="font-bold text-gray-700 text-xs uppercase tracking-wide min-w-[110px]">Hire Date:</span>
                                <span className="ml-2 text-gray-900 font-medium">{employee.hireDate}</span>
                              </div>
                              <div className="flex items-baseline">
                                <span className="font-bold text-gray-700 text-xs uppercase tracking-wide min-w-[110px]">Phone:</span>
                                <span className="ml-2 text-gray-900 font-medium">{employee.contactPhone || '-'}</span>
                              </div>
                              <div className="flex items-baseline">
                                <span className="font-bold text-gray-700 text-xs uppercase tracking-wide min-w-[110px]">Email:</span>
                                <span className="ml-2 text-gray-900 font-medium">{employee.email || '-'}</span>
                              </div>
                              <div className="flex items-baseline">
                                <span className="font-bold text-gray-700 text-xs uppercase tracking-wide min-w-[110px]">Wage Type:</span>
                                <span className="ml-2 text-gray-900 font-medium">
                                  {employee.wageType}{employee.hourlyRate && ` ($${employee.hourlyRate}/hr)`}
                                </span>
                              </div>
                              <div className="flex items-baseline">
                                <span className="font-bold text-gray-700 text-xs uppercase tracking-wide min-w-[110px]">Service Area:</span>
                                <span className="ml-2 text-gray-900 font-medium">{employee.defaultServiceArea}</span>
                              </div>
                              <div className="flex items-baseline">
                                <span className="font-bold text-gray-700 text-xs uppercase tracking-wide min-w-[110px]">Emergency:</span>
                                <span className="ml-2 text-gray-900 font-medium">{employee.emergencyContact || '-'}</span>
                              </div>
                              <div className="flex items-center">
                                <span className="font-bold text-gray-700 text-xs uppercase tracking-wide min-w-[110px]">PIN:</span>
                                {editingPin ? (
                                  <div className="flex items-center gap-1 ml-2">
                                    <input
                                      type="password"
                                      value={formData.pin || ''}
                                      onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                                      className="w-20 px-2 py-0.5 border border-gray-300 rounded text-xs"
                                      maxLength={6}
                                    />
                                    <button
                                      onClick={handleUpdatePin}
                                      className="px-2 py-0.5 bg-green-600 text-white rounded text-xs font-semibold hover:bg-green-700"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => {
                                        setEditingPin(false);
                                        setFormData({ ...formData, pin: employee.pin });
                                      }}
                                      className="px-2 py-0.5 bg-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-400"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 ml-2">
                                    <span className="text-gray-900 font-medium font-mono">{employee.pin || '-'}</span>
                                    <button
                                      onClick={() => setEditingPin(true)}
                                      className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
                                    >
                                      Edit
                                    </button>
                                  </div>
                                )}
                              </div>
                              {employee.notes && (
                                <div className="col-span-4 flex items-baseline">
                                  <span className="font-bold text-gray-700 text-xs uppercase tracking-wide min-w-[110px]">Notes:</span>
                                  <span className="ml-2 text-gray-900 font-medium">{employee.notes}</span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Role Definition */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">Role Definition</h2>
          <p className="text-sm text-gray-600 mt-1">Permissions and responsibilities by role</p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Permit Level</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Role</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Description</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Main Permissions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr className="hover:bg-purple-50">
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center justify-center w-10 h-10 bg-purple-100 text-purple-700 rounded-full text-lg font-bold">5</span>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-900">Owner / Admin</td>
                <td className="px-4 py-3 text-sm text-gray-700">Full system control</td>
                <td className="px-4 py-3 text-sm text-gray-600">Menu edit, Reports, Price management, Staff/Permission management</td>
              </tr>
              <tr className="hover:bg-orange-50">
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center justify-center w-10 h-10 bg-orange-100 text-orange-700 rounded-full text-lg font-bold">4</span>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-900">Manager</td>
                <td className="px-4 py-3 text-sm text-gray-700">Operation management</td>
                <td className="px-4 py-3 text-sm text-gray-600">Void approval, Discount approval, Table move/merge</td>
              </tr>
              <tr className="hover:bg-green-50">
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center justify-center w-10 h-10 bg-green-100 text-green-700 rounded-full text-lg font-bold">3</span>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-900">Supervisor</td>
                <td className="px-4 py-3 text-sm text-gray-700">Real-time operation support</td>
                <td className="px-4 py-3 text-sm text-gray-600">Cashier settlement, Reprint, Waiter management</td>
              </tr>
              <tr className="hover:bg-blue-50">
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center justify-center w-10 h-10 bg-blue-100 text-blue-700 rounded-full text-lg font-bold">2</span>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-900">Server / Cashier</td>
                <td className="px-4 py-3 text-sm text-gray-700">Order and payment</td>
                <td className="px-4 py-3 text-sm text-gray-600">Order entry, Split, Payment (with restrictions)</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center justify-center w-10 h-10 bg-gray-100 text-gray-700 rounded-full text-lg font-bold">1</span>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-900">Kitchen / Bar</td>
                <td className="px-4 py-3 text-sm text-gray-700">Kitchen operations</td>
                <td className="px-4 py-3 text-sm text-gray-600">KDS view, Status change, Void request</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div className="px-6 py-4 bg-yellow-50 border-t border-yellow-200">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                <strong>Important:</strong> Each function requires "Permit Level X or higher". Example: "Void → Level 3 or higher" means Level 3, 4, 5 are allowed, but Level 1, 2 are not.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Detailed Permissions by Function */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Detailed Permissions by Function</h2>
            <p className="text-sm text-gray-600 mt-1">Minimum permission level required for each function</p>
          </div>
        </div>
        
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {permissionCategories.map((category, idx) => (
            <div key={idx} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                <h3 className="font-semibold text-gray-800 text-base">{category.category}</h3>
                <button
                  onClick={() => openPermissionModal(category.category)}
                  className="px-3 py-1 bg-green-600 text-white rounded text-xs font-semibold hover:bg-green-700 transition-colors"
                >
                  Edit
                </button>
              </div>
              <div className="p-4">
                <div className="space-y-2">
                  {category.permissions.map((perm, pidx) => (
                    <div key={pidx} className="flex justify-between items-center text-sm">
                      <span className="text-gray-700">{perm.name}</span>
                      <span className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded text-xs font-semibold">
                        Level {getEffectivePermissionLevel(category.category, perm.name, perm.level)}+
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 4: Security and Error Prevention Features */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">Security and Error Prevention Features</h2>
          <p className="text-sm text-gray-600 mt-1">Essential features for system security</p>
        </div>
        
        <div className="p-6">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 w-1/3">Feature</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 w-2/3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Admin PIN Re-authentication</td>
                <td className="px-4 py-3 text-sm text-gray-600">Additional security for high-risk operations (Void/Refund, etc.)</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Action Log Recording (Audit Log)</td>
                <td className="px-4 py-3 text-sm text-gray-600">Track causes and determine responsibility when issues occur</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Employee Inactive Processing</td>
                <td className="px-4 py-3 text-sm text-gray-600">Immediately block permissions for terminated employees and maintain security</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Shift-based Permission Control (Optional)</td>
                <td className="px-4 py-3 text-sm text-gray-600">Enhanced security by time period, such as night menu/order restrictions</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
        </div>
      </div>

      {/* Add Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
              <h2 className="text-lg font-bold text-gray-800">Add New Employee</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
            </div>
            
            <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); handleAddEmployee(); }}>
            {/* Hidden fields to prevent browser password save prompt */}
            <input type="text" name="username" autoComplete="username" style={{ display: 'none' }} tabIndex={-1} />
            <input type="password" name="password" autoComplete="new-password" style={{ display: 'none' }} tabIndex={-1} />
            <div className="p-4">
              <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">First Name *</label>
                  <input
                    ref={addFirstNameInputRef}
                    type="text"
                    value={formData.firstName || ''}
                    onChange={(e) => {
                      const next = e.target.value;
                      setFormData(prev => ({ ...prev, firstName: formatNameWithUserIntent(next) }));
                    }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="John"
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Last Name</label>
                  <input
                    type="text"
                    value={formData.lastName || ''}
                    onChange={(e) => {
                      const next = e.target.value;
                      setFormData(prev => ({ ...prev, lastName: formatNameWithUserIntent(next) }));
                    }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Doe"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Employee ID</label>
                  <input
                    type="text"
                    value={newEmployeeId}
                    disabled
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-gray-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Role *</label>
                  <select
                    value={formData.role || 'Server'}
                    onChange={(e) => {
                      const newRole = e.target.value;
                      setFormData({ 
                        ...formData, 
                        role: newRole, 
                        permissionGroup: newRole
                      });
                    }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Owner">5 - Owner/Admin</option>
                    <option value="Manager">4 - Manager</option>
                    <option value="Supervisor">3 - Supervisor</option>
                    <option value="Server">2 - Server/Cashier</option>
                    <option value="Kitchen">1 - Kitchen/Bar</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">PIN *</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={formData.pin || ''}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '');
                      setFormData({ ...formData, pin: value });
                    }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                    placeholder="4-6 digits"
                    maxLength={6}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Status</label>
                  <select
                    value={formData.status || 'Active'}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Active' | 'Inactive' })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Hire Date</label>
                  <input
                    type="date"
                    value={formData.hireDate || ''}
                    onChange={(e) => setFormData({ ...formData, hireDate: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Contact Phone</label>
                  <input
                    type="tel"
                    value={formData.contactPhone || ''}
                    onChange={(e) => setFormData({ ...formData, contactPhone: formatPhoneNumber(e.target.value) })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="(555) 123-4567"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Email</label>
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="employee@example.com"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Wage Type</label>
                  <select
                    value={formData.wageType || 'Hourly'}
                    onChange={(e) => setFormData({ ...formData, wageType: e.target.value as 'Hourly' | 'Salary' })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Hourly">Hourly</option>
                    <option value="Salary">Salary</option>
                  </select>
                </div>

                {formData.wageType === 'Hourly' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-0.5">Hourly Rate ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.hourlyRate || ''}
                      onChange={(e) => setFormData({ ...formData, hourlyRate: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="15.00"
                    />
                  </div>
                )}

              <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Service Area</label>
                  <select
                    value={formData.defaultServiceArea || 'Hall'}
                    onChange={(e) => setFormData({ ...formData, defaultServiceArea: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Hall">Hall</option>
                    <option value="Kitchen">Kitchen</option>
                    <option value="Office Staff">Office Staff</option>
                  </select>
              </div>

              <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Emergency Contact</label>
                  <input
                    type="tel"
                    value={formData.emergencyContact || ''}
                    onChange={(e) => setFormData({ ...formData, emergencyContact: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="555-0001"
                  />
                </div>

                <div className="col-span-3">
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Notes</label>
                  <textarea
                    value={formData.notes || ''}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    rows={2}
                    placeholder="Additional notes..."
                  />
                </div>
              </div>

              <div className="mt-6 bg-gray-50 border border-dashed border-gray-300 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Sample Layout (Not Saved)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {sampleEmployeeTemplates.map((sample, idx) => (
                    <div key={`sample-${idx}`} className="rounded-lg border border-gray-200 bg-white/60 px-3 py-2 text-xs text-gray-500">
                      <div className="font-semibold text-gray-500">{sample.name}</div>
                      <div className="mt-1">Role: {sample.role}</div>
                      <div>PIN: {sample.pin}</div>
                      <div>Phone: {sample.phone}</div>
                      <div>Email: {sample.email}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-wide">Sample only</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-semibold text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold text-sm"
              >
                Add Employee
              </button>
            </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-bold text-gray-800">Edit Employee</h2>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold text-gray-700">Status:</label>
                  <select
                    value={formData.status || 'Active'}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Active' | 'Inactive' })}
                    className="px-3 py-1.5 text-sm font-medium border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
            </div>
            
            <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); handleEditEmployee(); }}>
            {/* Hidden fields to prevent browser password save prompt */}
            <input type="text" name="username" autoComplete="username" style={{ display: 'none' }} tabIndex={-1} />
            <input type="password" name="password" autoComplete="new-password" style={{ display: 'none' }} tabIndex={-1} />
            <div className="p-4">
              <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                <div className="col-span-2 grid grid-cols-2 gap-x-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-0.5">First Name *</label>
                    <input
                      ref={editFirstNameInputRef}
                      type="text"
                      value={formData.firstName || ''}
                      onChange={(e) => {
                        const next = e.target.value;
                        setFormData(prev => ({ ...prev, firstName: formatNameWithUserIntent(next) }));
                      }}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      autoComplete="off"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-0.5">Last Name</label>
                    <input
                      type="text"
                      value={formData.lastName || ''}
                      onChange={(e) => {
                        const next = e.target.value;
                        setFormData(prev => ({ ...prev, lastName: formatNameWithUserIntent(next) }));
                      }}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Employee ID</label>
                  <input
                    type="text"
                    value={formData.employeeId || ''}
                    disabled
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-gray-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Role *</label>
                  <select
                    value={formData.role || 'Server'}
                    onChange={(e) => {
                      const newRole = e.target.value;
                      setFormData({ 
                        ...formData, 
                        role: newRole, 
                        permissionGroup: newRole
                      });
                    }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Owner">5 - Owner/Admin</option>
                    <option value="Manager">4 - Manager</option>
                    <option value="Supervisor">3 - Supervisor</option>
                    <option value="Server">2 - Server/Cashier</option>
                    <option value="Kitchen">1 - Kitchen/Bar</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">PIN *</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={formData.pin || ''}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '');
                      setFormData({ ...formData, pin: value });
                    }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                    maxLength={6}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Hire Date</label>
                  <input
                    type="date"
                    value={formData.hireDate || ''}
                    onChange={(e) => setFormData({ ...formData, hireDate: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Contact Phone</label>
                  <input
                    type="tel"
                    value={formData.contactPhone || ''}
                    onChange={(e) => setFormData({ ...formData, contactPhone: formatPhoneNumber(e.target.value) })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Email</label>
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Emergency Contact</label>
                  <input
                    type="tel"
                    value={formData.emergencyContact || ''}
                    onChange={(e) => setFormData({ ...formData, emergencyContact: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="col-span-2 grid grid-cols-2 gap-x-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-0.5">Wage Type</label>
                    <select
                      value={formData.wageType || 'Hourly'}
                      onChange={(e) => setFormData({ ...formData, wageType: e.target.value as 'Hourly' | 'Salary' })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="Hourly">Hourly</option>
                      <option value="Salary">Salary</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-0.5">Hourly Rate ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.hourlyRate || ''}
                      onChange={(e) => setFormData({ ...formData, hourlyRate: parseFloat(e.target.value) })}
                      disabled={formData.wageType === 'Salary'}
                      className={`w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        formData.wageType === 'Salary' ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''
                      }`}
                      placeholder="Enter hourly rate"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Service Area</label>
                  <select
                    value={formData.defaultServiceArea || 'Hall'}
                    onChange={(e) => setFormData({ ...formData, defaultServiceArea: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Hall">Hall</option>
                    <option value="Kitchen">Kitchen</option>
                    <option value="Office Staff">Office Staff</option>
                  </select>
                </div>

                <div className="col-span-3">
                  <label className="block text-xs font-semibold text-gray-700 mb-0.5">Notes</label>
                  <textarea
                    value={formData.notes || ''}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    rows={2}
                  />
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-semibold text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold text-sm"
              >
                Save Changes
              </button>
            </div>
            </form>
          </div>
        </div>
      )}

      {/* Permission Edit Modal */}
      {showPermissionModal && selectedCategory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-3 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
              <h2 className="text-lg font-bold text-gray-800">Edit {selectedCategory} Permissions</h2>
              <button onClick={closePermissionModal} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
            </div>
            
            <div className="p-4">
              <div className="space-y-3">
                {permissionCategories
                  .find(cat => cat.category === selectedCategory)
                  ?.permissions.map((perm, idx) => {
                    const currentLevel = tempPermissions[perm.name] ?? getEffectivePermissionLevel(selectedCategory, perm.name, perm.level);
                    return (
                      <div key={idx} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded border border-gray-200">
                        <div className="font-medium text-gray-800 text-sm flex-shrink-0 w-40">{perm.name}</div>
                        <div className="flex gap-4">
                          {[1, 2, 3, 4, 5].map((level) => (
                            <label
                              key={level}
                              className="flex items-center gap-1 cursor-pointer"
                              title={
                                level === 1 ? 'Kitchen/Bar' :
                                level === 2 ? 'Server/Cashier' :
                                level === 3 ? 'Supervisor' :
                                level === 4 ? 'Manager' : 'Owner/Admin'
                              }
                            >
                              <input
                                type="radio"
                                name={`perm-${idx}`}
                                value={level}
                                checked={currentLevel === level}
                                onChange={() => handlePermissionChange(perm.name, level)}
                                className="w-4 h-4 text-blue-600"
                              />
                              <span className="text-sm text-gray-700">{level}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
              
              <div className="mt-4 text-xs text-gray-500 bg-blue-50 p-2 rounded">
                <strong>Level Guide:</strong> 1=Kitchen/Bar, 2=Server/Cashier, 3=Supervisor, 4=Manager, 5=Owner/Admin
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-3 sticky bottom-0 bg-white">
              <button
                onClick={closePermissionModal}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-semibold text-sm"
              >
                Cancel
              </button>
              <button 
                onClick={savePermissions}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold text-sm"
              >
                Save Changes
              </button>
          </div>
        </div>
      </div>
      )}

      {/* Deleted Employees Modal */}
      {showDeletedModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Deleted Employees</h2>
                <p className="text-sm text-gray-600 mt-1">You can restore or permanently delete employees here</p>
              </div>
              <button onClick={() => setShowDeletedModal(false)} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
            </div>
            
            <div className="p-6">
              {deletedEmployees.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">✅</div>
                  <p className="text-gray-500 text-lg">No deleted employees</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">First Name</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Last Name</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Employee ID</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Role</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Contact</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Email</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {deletedEmployees.map((employee) => (
                        <tr key={employee.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">{employee.firstName}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{employee.lastName}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{employee.employeeId}</td>
                          <td className="px-4 py-3 text-sm">
                            <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                              {getRoleLevelDisplay(employee.role)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{employee.contactPhone || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{employee.email || '-'}</td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleRestoreEmployee(employee.id)}
                                className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 font-medium text-xs"
                                title="Restore this employee"
                              >
                                ↩️ Restore
                              </button>
                              <button
                                onClick={() => handlePermanentDelete(employee.id)}
                                className="px-2 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 font-medium text-xs"
                                title="Permanently delete (cannot be undone)"
                              >
                                ⚠️ Delete Forever
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end sticky bottom-0 bg-white">
              <button
                onClick={() => setShowDeletedModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && confirmAction && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            {/* Header */}
            <div className={`px-6 py-4 rounded-t-xl ${
              confirmAction.type === 'delete' 
                ? 'bg-yellow-50 border-b-2 border-yellow-200' 
                : 'bg-red-50 border-b-2 border-red-300'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`text-4xl ${
                  confirmAction.type === 'delete' ? 'animate-bounce' : 'animate-pulse'
                }`}>
                  {confirmAction.type === 'delete' ? '⚠️' : '🚨'}
              </div>
              <div>
                  <h3 className={`text-xl font-bold ${
                    confirmAction.type === 'delete' ? 'text-yellow-800' : 'text-red-800'
                  }`}>
                    {confirmAction.type === 'delete' ? 'Delete Employee?' : 'PERMANENT DELETE!'}
                  </h3>
                  <p className={`text-sm ${
                    confirmAction.type === 'delete' ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {confirmAction.type === 'delete' 
                      ? 'This action can be undone' 
                      : 'This action CANNOT be undone'}
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 py-5">
              <div className="mb-4">
                <p className="text-gray-700 mb-2">
                  {confirmAction.type === 'delete' 
                    ? 'Are you sure you want to delete this employee?' 
                    : 'Are you absolutely sure you want to permanently delete this employee?'}
                </p>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <p className="text-sm text-gray-500 mb-1">Employee Name:</p>
                  <p className="text-lg font-bold text-gray-900">{confirmAction.employeeName}</p>
                </div>
              </div>

              {confirmAction.type === 'delete' ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2 text-green-700">
                    <span className="text-lg">✓</span>
                    <span>The employee will be moved to "Deleted Employees"</span>
                  </div>
                  <div className="flex items-start gap-2 text-green-700">
                    <span className="text-lg">✓</span>
                    <span>You can restore them later if needed</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2 text-red-700">
                    <span className="text-lg">⚠️</span>
                    <span className="font-semibold">This action is IRREVERSIBLE</span>
                  </div>
                  <div className="flex items-start gap-2 text-red-700">
                    <span className="text-lg">⚠️</span>
                    <span className="font-semibold">All data will be lost forever</span>
                  </div>
                  <div className="flex items-start gap-2 text-red-700">
                    <span className="text-lg">⚠️</span>
                    <span className="font-semibold">This employee CANNOT be restored</span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 rounded-b-xl flex justify-end gap-3">
              <button
                onClick={cancelDelete}
                className="px-5 py-2.5 bg-white border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className={`px-5 py-2.5 text-white rounded-lg font-semibold transition-colors ${
                  confirmAction.type === 'delete'
                    ? 'bg-yellow-600 hover:bg-yellow-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {confirmAction.type === 'delete' ? 'Yes, Delete' : 'Yes, Delete Forever'}
              </button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};

export default EmployeeInfoPage; 
