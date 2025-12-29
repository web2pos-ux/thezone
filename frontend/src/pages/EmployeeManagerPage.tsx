import React, { useState } from 'react';
import { 
  Users, 
  Clock, 
  RefreshCw, 
  Calendar, 
  FileText, 
  DollarSign,
  ChevronRight
} from 'lucide-react';
import EmployeeInfoPage from './EmployeeInfoPage';
import WorkSchedulePage from './WorkSchedulePage';
import ShiftSwapsPage from './ShiftSwapsPage';
import TimeOffRequestsPage from './TimeOffRequestsPage';

type SubMenuType = 
  | 'employee-info' 
  | 'work-schedule' 
  | 'shift-swaps' 
  | 'time-off-request' 
  | 'report' 
  | 'payroll-setting';

interface SubMenuItem {
  id: SubMenuType;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const EmployeeManagerPage = () => {
  const [selectedSubMenu, setSelectedSubMenu] = useState<SubMenuType>('employee-info');

  const subMenuItems: SubMenuItem[] = [
    {
      id: 'employee-info',
      title: 'Employee Info',
      description: 'Manage employee basic information',
      icon: <Users size={24} />,
      color: 'bg-blue-500'
    },
    {
      id: 'work-schedule',
      title: 'Work Schedule & Time',
      description: 'Work schedule and time management',
      icon: <Clock size={24} />,
      color: 'bg-purple-500'
    },
    {
      id: 'shift-swaps',
      title: 'Shift Swaps',
      description: 'Shift change management',
      icon: <RefreshCw size={24} />,
      color: 'bg-orange-500'
    },
    {
      id: 'time-off-request',
      title: 'Time off Request',
      description: 'Vacation and leave request management',
      icon: <Calendar size={24} />,
      color: 'bg-red-500'
    },
    {
      id: 'report',
      title: 'Report',
      description: 'Employee related reports',
      icon: <FileText size={24} />,
      color: 'bg-indigo-500'
    },
    {
      id: 'payroll-setting',
      title: 'Pay Roll Setting',
      description: 'Payroll settings and management',
      icon: <DollarSign size={24} />,
      color: 'bg-yellow-500'
    }
  ];

  const renderSubMenuContent = () => {
    switch (selectedSubMenu) {
      case 'employee-info':
        return (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Employee Information Management</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-700">Basic Information</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                      <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
                      <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
                      <input type="tel" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-700">Employment Information</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Hire Date</label>
                      <input type="date" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                      <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option>Kitchen</option>
                        <option>Service</option>
                        <option>Management</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                      <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option>Active</option>
                        <option>On Leave</option>
                        <option>Terminated</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'work-schedule':
        return <WorkSchedulePage />;

      case 'shift-swaps':
        return <ShiftSwapsPage />;

      case 'time-off-request':
        return (
          <TimeOffRequestsPage />
        );

      case 'report':
        return (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Employee Reports</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h3 className="text-lg font-medium text-blue-700 mb-2">Work Hours Report</h3>
                  <p className="text-sm text-blue-600 mb-3">Monthly/Weekly work time statistics</p>
                  <button className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">
                    View
                  </button>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <h3 className="text-lg font-medium text-green-700 mb-2">Attendance Report</h3>
                  <p className="text-sm text-green-600 mb-3">Clock in/out time records</p>
                  <button className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600">
                    View
                  </button>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <h3 className="text-lg font-medium text-purple-700 mb-2">Leave Usage Report</h3>
                  <p className="text-sm text-purple-600 mb-3">Annual leave and vacation usage</p>
                  <button className="px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600">
                    View
                  </button>
                </div>
                <div className="p-4 bg-orange-50 rounded-lg">
                  <h3 className="text-lg font-medium text-orange-700 mb-2">Performance Report</h3>
                  <p className="text-sm text-orange-600 mb-3">Employee performance and evaluation</p>
                  <button className="px-3 py-1 bg-orange-500 text-white rounded text-sm hover:bg-orange-600">
                    View
                  </button>
                </div>
                <div className="p-4 bg-red-50 rounded-lg">
                  <h3 className="text-lg font-medium text-red-700 mb-2">Turnover Report</h3>
                  <p className="text-sm text-red-600 mb-3">Employee turnover analysis</p>
                  <button className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600">
                    View
                  </button>
                </div>
                <div className="p-4 bg-indigo-50 rounded-lg">
                  <h3 className="text-lg font-medium text-indigo-700 mb-2">Payroll Report</h3>
                  <p className="text-sm text-indigo-600 mb-3">Payroll payment history</p>
                  <button className="px-3 py-1 bg-indigo-500 text-white rounded text-sm hover:bg-indigo-600">
                    View
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      case 'payroll-setting':
        return (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Payroll Settings</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-700">Basic Pay Settings</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Base Hourly Rate</label>
                      <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="10,000" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Overtime Hourly Rate</label>
                      <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="15,000" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Night Shift Allowance</label>
                      <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="2,000" />
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-700">Deduction Settings</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">National Pension (%)</label>
                      <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="4.5" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Health Insurance (%)</label>
                      <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="3.545" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Employment Insurance (%)</label>
                      <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.8" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-lg font-medium text-gray-700 mb-3">Payroll Payment Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                    <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option>25th of each month</option>
                      <option>Last day of each month</option>
                      <option>15th of each month</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payroll Period</label>
                    <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option>1st ~ Last day</option>
                      <option>16th ~ Next month 15th</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
  </div>
);

      default:
        return (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Selected Menu</h2>
            <p className="text-gray-600">Please select a menu.</p>
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white shadow-lg">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-6">Employee Manager</h1>
          <nav className="space-y-2">
            {subMenuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedSubMenu(item.id)}
                className={`w-full flex items-center space-x-3 p-3 rounded-lg transition-all duration-200 ${
                  selectedSubMenu === item.id
                    ? 'bg-blue-50 border-l-4 border-blue-500 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <div className={`p-2 rounded-lg ${item.color} text-white`}>
                  {item.icon}
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium">{item.title}</div>
                  <div className="text-xs text-gray-500">{item.description}</div>
                </div>
                <ChevronRight size={16} className={`transition-transform ${
                  selectedSubMenu === item.id ? 'rotate-90' : ''
                }`} />
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6">
          {renderSubMenuContent()}
        </div>
      </div>
    </div>
  );
};

export default EmployeeManagerPage; 