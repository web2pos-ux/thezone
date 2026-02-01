import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import ReportIcon from './icons/ReportIcon';
import UserPlusIcon from './icons/UserPlusIcon';
import TableIcon from './icons/TableIcon';
import MenuIcon from './icons/MenuIcon';
import OrderIcon from './icons/OrderIcon';
import { API_URL } from '../config/constants';

const navLinks = [
  { path: '/backoffice/basic-info', label: 'Business Info', icon: 'custom' },
  { path: '/backoffice/menu', label: 'Menu Manager', icon: 'custom' },
];

const tableSubMenus = [
  { path: '/backoffice/tables', label: 'Table Map Manager', icon: 'custom' },
  { path: '/backoffice/tables', label: 'Table Map', icon: '🗺️' },
  { path: '/backoffice/table-reservation-settings', label: 'Reservation', icon: '⚙️' },
];

const orderSubMenus = [
  { path: '/backoffice/order-setup', label: 'Order Screen Setup', icon: '⚙️' },
  { path: '/backoffice/promotions', label: 'Promotions', icon: '🎁' },
];

const employeeSubMenus = [
  { path: '/backoffice/employees', label: 'Employee Manager', icon: 'custom' },
  { path: '/backoffice/employee-info', label: 'Employee Info', icon: '👤' },
  { path: '/backoffice/work-schedule', label: 'Work Schedule', icon: '⏰' },
  { path: '/backoffice/shift-swaps', label: 'Shift Swaps', icon: '🔄' },
  { path: '/backoffice/time-off-request', label: 'Time off Request', icon: '📅' },
  { path: '/backoffice/employee-report', label: 'Employee Report', icon: '📊' },
  { path: '/backoffice/payroll-setting', label: 'Pay Roll Setting', icon: '💰' },
];

const hardwareSubMenus = [
  { path: '/backoffice/hardware', label: 'Hardware Manager', icon: '🖨️' },
  { path: '/backoffice/printer', label: 'Printer', icon: '🖨️' },
  { path: '/backoffice/credit-card-reader', label: 'Credit Card Reader', icon: '💳' },
  { path: '/backoffice/table-devices', label: 'Table Devices', icon: '📱' },
  { path: '/backoffice/qr-code', label: 'QR Code', icon: '📱' },
  { path: '/backoffice/kds', label: 'KDS', icon: '📺' },
  { path: '/backoffice/app-settings', label: 'System Settings', icon: '⚙️' },
];

const reportSubMenus = [
  { path: '/backoffice/reports', label: 'Report Manager', icon: 'custom' },
  { path: '/backoffice/sales-report', label: 'Sales Report', icon: '💰' },
  { path: '/backoffice/inventory-report', label: 'Inventory Report', icon: '📦' },
  { path: '/backoffice/customer-report', label: 'Customer Report', icon: '👥' },
  { path: '/backoffice/employee-performance', label: 'Employee Performance', icon: '📈' },
  { path: '/backoffice/menu-analysis', label: 'Menu Analysis', icon: '🍽️' },
  { path: '/backoffice/payment-report', label: 'Payment Report', icon: '💳' },
  { path: '/backoffice/operational-report', label: 'Operational Report', icon: '⚙️' },
];

const BackOfficeLayout = () => {
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [employeeMenuExpanded, setEmployeeMenuExpanded] = useState(false);
  const [hardwareMenuExpanded, setHardwareMenuExpanded] = useState(false);
  const [reportMenuExpanded, setReportMenuExpanded] = useState(false);
  const [tableMenuExpanded, setTableMenuExpanded] = useState(false);
  const [orderMenuExpanded, setOrderMenuExpanded] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [serviceType, setServiceType] = useState<string | null>(null);

  // Fetch service type on mount
  useEffect(() => {
    const fetchServiceType = async () => {
      try {
        const response = await fetch(`${API_URL}/admin-settings/service-type`);
        if (response.ok) {
          const data = await response.json();
          setServiceType(data.serviceType);
        }
      } catch (error) {
        console.error('Failed to fetch service type:', error);
      }
    };
    fetchServiceType();
  }, []);

  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem('backoffice_sidebar_collapsed', newState ? '1' : '0');
  };

  const toggleEmployeeMenu = () => {
    setEmployeeMenuExpanded(!employeeMenuExpanded);
  };

  const toggleHardwareMenu = () => {
    setHardwareMenuExpanded(!hardwareMenuExpanded);
  };

  const toggleReportMenu = () => {
    setReportMenuExpanded(!reportMenuExpanded);
  };

  const toggleTableMenu = () => {
    setTableMenuExpanded(!tableMenuExpanded);
  };

  const toggleOrderMenu = () => {
    setOrderMenuExpanded(!orderMenuExpanded);
  };

  const renderIcon = (label: string, icon: string, size: number) => {
    if (icon === 'custom') {
      if (label === 'Menu Manager') {
        return <MenuIcon size={size} />;
      } else if (label === 'Employee Manager') {
        return <UserPlusIcon size={size} />;
      } else if (label === 'Table Map Manager') {
        return <TableIcon size={size} />;
      } else if (label === 'Order Screen Manager') {
        return <OrderIcon size={size} />;
      } else if (label === 'Business Info') {
        return <ReportIcon size={size} />;
      } else {
        return <ReportIcon size={size} />;
      }
    } else {
      return (
        <span className={`flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'text-2xl' : 'text-base'}`}>
          {icon}
        </span>
      );
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 font-sans">
      <aside className={`${sidebarCollapsed ? 'w-16' : 'w-64'} bg-gray-800 text-white flex flex-col transition-all duration-300 ease-in-out`}>
        <div className="h-16 flex items-center justify-center px-4 border-b border-gray-700">
          {!sidebarCollapsed && <span className="text-2xl font-bold">The Zone POS</span>}
        </div>
        <nav className="flex-1 px-4 py-4">
          <ul>
            {/* Regular menu items */}
            {navLinks.map(({ path, label, icon }) => (
              <li key={path}>
                <NavLink
                  to={path}
                  className={({ isActive }) =>
                    `flex items-center px-3 py-3 mb-2 rounded-md transition-colors ${
                      isActive ? 'bg-blue-500 text-white' : 'hover:bg-gray-700'
                    } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`
                  }
                  title={sidebarCollapsed ? label : ''}
                >
                  <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                    {renderIcon(label, icon, sidebarCollapsed ? 32 : 16)}
                  </span>
                  <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                    {label}
                  </span>
                </NavLink>
              </li>
            ))}

            {/* Table Map Manager with dropdown */}
            <li className="mb-2">
              <button
                onClick={toggleTableMenu}
                className={`flex items-center px-3 py-3 w-full rounded-md transition-colors ${
                  tableMenuExpanded 
                    ? 'bg-gray-600 text-white hover:bg-gray-500' 
                    : 'hover:bg-gray-700'
                } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`}
                title={sidebarCollapsed ? 'Table Map Manager' : ''}
              >
                <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                  <TableIcon size={sidebarCollapsed ? 32 : 16} />
                </span>
                <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  Table Map Manager
                </span>
                {!sidebarCollapsed && (
                  <span className={`ml-auto transition-transform duration-300 ${tableMenuExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                )}
              </button>
              
              {/* Table submenu */}
              {tableMenuExpanded && !sidebarCollapsed && (
                <ul className="ml-4 space-y-1 bg-gray-700 rounded-md p-2 mt-1">
                  {tableSubMenus.slice(1).map(({ path, label, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center px-3 py-2 rounded-md transition-colors text-sm ${
                            isActive 
                              ? 'bg-gray-500 text-white' 
                              : 'text-gray-200 hover:bg-gray-600'
                          }`
                        }
                      >
                        <span className="mr-3 text-sm">{icon}</span>
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            {/* Order Screen Manager with dropdown */}
            <li className="mb-2">
              <button
                onClick={toggleOrderMenu}
                className={`flex items-center px-3 py-3 w-full rounded-md transition-colors ${
                  orderMenuExpanded 
                    ? 'bg-gray-600 text-white hover:bg-gray-500' 
                    : 'hover:bg-gray-700'
                } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`}
                title={sidebarCollapsed ? 'Order Screen Manager' : ''}
              >
                <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                  <OrderIcon size={sidebarCollapsed ? 32 : 16} />
                </span>
                <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  Order Screen Manager
                </span>
                {!sidebarCollapsed && (
                  <span className={`ml-auto transition-transform duration-300 ${orderMenuExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                )}
              </button>
              
              {/* Order submenu */}
              {orderMenuExpanded && !sidebarCollapsed && (
                <ul className="ml-4 space-y-1 bg-gray-700 rounded-md p-2 mt-1">
                  {orderSubMenus.map(({ path, label, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center px-3 py-2 rounded-md transition-colors text-sm ${
                            isActive 
                              ? 'bg-gray-500 text-white' 
                              : 'text-gray-200 hover:bg-gray-600'
                          }`
                        }
                      >
                        <span className="mr-3 text-sm">{icon}</span>
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            {/* Employee Manager with dropdown */}
            <li className="mb-2">
              <button
                onClick={toggleEmployeeMenu}
                className={`flex items-center px-3 py-3 w-full rounded-md transition-colors ${
                  employeeMenuExpanded 
                    ? 'bg-gray-600 text-white hover:bg-gray-500' 
                    : 'hover:bg-gray-700'
                } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`}
                title={sidebarCollapsed ? 'Employee Manager' : ''}
              >
                <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                  <UserPlusIcon size={sidebarCollapsed ? 32 : 16} />
                </span>
                <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  Employee Manager
                </span>
                {!sidebarCollapsed && (
                  <span className={`ml-auto transition-transform duration-300 ${employeeMenuExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                )}
              </button>
              
              {/* Employee submenu */}
              {employeeMenuExpanded && !sidebarCollapsed && (
                <ul className="ml-4 space-y-1 bg-gray-700 rounded-md p-2 mt-1">
                  {employeeSubMenus.slice(1).map(({ path, label, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center px-3 py-2 rounded-md transition-colors text-sm ${
                            isActive 
                              ? 'bg-gray-500 text-white' 
                              : 'text-gray-200 hover:bg-gray-600'
                          }`
                        }
                      >
                        <span className="mr-3 text-sm">{icon}</span>
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            {/* Hardware Manager with dropdown */}
            <li className="mb-2">
              <button
                onClick={toggleHardwareMenu}
                className={`flex items-center px-3 py-3 w-full rounded-md transition-colors ${
                  hardwareMenuExpanded 
                    ? 'bg-gray-600 text-white hover:bg-gray-500' 
                    : 'hover:bg-gray-700'
                } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`}
                title={sidebarCollapsed ? 'Hardware Manager' : ''}
              >
                <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                  <span className={`flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'text-2xl' : 'text-base'}`}>
                    ��️
                  </span>
                </span>
                <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  Hardware Manager
                </span>
                {!sidebarCollapsed && (
                  <span className={`ml-auto transition-transform duration-300 ${hardwareMenuExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                )}
              </button>
              
              {/* Hardware submenu */}
              {hardwareMenuExpanded && !sidebarCollapsed && (
                <ul className="ml-4 space-y-1 bg-gray-700 rounded-md p-2 mt-1">
                  {hardwareSubMenus.slice(1).map(({ path, label, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center px-3 py-2 rounded-md transition-colors text-sm ${
                            isActive 
                              ? 'bg-gray-500 text-white' 
                              : 'text-gray-200 hover:bg-gray-600'
                          }`
                        }
                      >
                        <span className="mr-3 text-sm">{icon}</span>
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            {/* Report Manager with dropdown */}
            <li className="mb-2">
              <button
                onClick={toggleReportMenu}
                className={`flex items-center px-3 py-3 w-full rounded-md transition-colors ${
                  reportMenuExpanded 
                    ? 'bg-gray-600 text-white hover:bg-gray-500' 
                    : 'hover:bg-gray-700'
                } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`}
                title={sidebarCollapsed ? 'Report Manager' : ''}
              >
                <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                  <ReportIcon size={sidebarCollapsed ? 32 : 16} />
                </span>
                <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  Report Manager
                </span>
                {!sidebarCollapsed && (
                  <span className={`ml-auto transition-transform duration-300 ${reportMenuExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                )}
              </button>
              
              {/* Report submenu */}
              {reportMenuExpanded && !sidebarCollapsed && (
                <ul className="ml-4 space-y-1 bg-gray-700 rounded-md p-2 mt-1">
                  {reportSubMenus.slice(1).map(({ path, label, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center px-3 py-2 rounded-md transition-colors text-sm ${
                            isActive 
                              ? 'bg-gray-500 text-white' 
                              : 'text-gray-200 hover:bg-gray-600'
                          }`
                        }
                      >
                        <span className="mr-3 text-sm">{icon}</span>
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>

          </ul>
          
          {/* Exit Button */}
          <div className="px-4 py-2 border-t border-gray-700">
            <button
              onClick={() => setShowExitModal(true)}
              className={`w-full py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition-colors flex items-center justify-center gap-2 ${sidebarCollapsed ? 'px-2' : 'px-4'}`}
              title="Exit Menu"
            >
              <span className="text-lg">🚪</span>
              {!sidebarCollapsed && <span>Exit</span>}
            </button>
          </div>
          
          {/* Toggle Button */}
          <div className="px-4 py-2 border-t border-gray-700 flex justify-center">
            <button
              onClick={toggleSidebar}
              className={`rounded-lg border-2 border-white hover:bg-gray-700 transition-colors font-bold flex items-center justify-center ${sidebarCollapsed ? 'w-14 h-14 text-xl' : 'w-12 h-12 text-3xl'}`}
              style={{ aspectRatio: '1 / 1' }}
              title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              <span className="flex items-center justify-center w-full h-full">
                {sidebarCollapsed ? '›' : '‹'}
              </span>
            </button>
          </div>
        </nav>
      </aside>
      <main className="flex-1 flex flex-col overflow-auto">
        {/* The Outlet will render the matched child route component */}
        <Outlet />
      </main>
      
      {/* EXIT 모달 */}
      {showExitModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[80]">
          <div className="bg-white rounded-2xl shadow-2xl w-[350px] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-gray-700 to-gray-800 text-white px-6 py-4 text-center">
              <div className="text-2xl font-bold">Exit Menu</div>
              <div className="text-gray-300 mt-1 text-sm">Select an option</div>
            </div>
            
            {/* Buttons */}
            <div className="p-6 space-y-3">
              {/* Go to Sales 버튼 - QSR이면 /qsr, FSR이면 /sales */}
              <button
                onClick={() => {
                  setShowExitModal(false);
                  if (serviceType === 'QSR') {
                    navigate('/qsr');
                  } else {
                    navigate('/sales');
                  }
                }}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white text-lg font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-3"
              >
                <span className="text-2xl">🏪</span>
                {serviceType === 'QSR' ? 'Go to QSR' : 'Go to Sales'}
              </button>
              
              {/* Go to Windows 버튼 (앱 종료) */}
              <button
                onClick={() => {
                  setShowExitModal(false);
                  try {
                    if (window.electron && window.electron.quit) {
                      window.electron.quit();
                    } else {
                      window.close();
                    }
                  } catch (e) {
                    console.error('Quit failed:', e);
                    window.close();
                  }
                }}
                className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white text-lg font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-3"
              >
                <span className="text-2xl">🪟</span>
                Go to Windows
              </button>
            </div>
            
            {/* Cancel */}
            <div className="px-6 pb-6">
              <button
                onClick={() => setShowExitModal(false)}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackOfficeLayout;